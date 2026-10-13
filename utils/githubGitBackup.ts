/**
 * GitHub 备份的另一种存法：Git 数据接口（EM 独有，utils/githubClient.ts 的 [EM: github-git-backup] 接线）。
 *
 * 为什么要有：原来的备份是 Release + 附件，附件只能传到 uploads.github.com。这个域名不回浏览器的
 * 跨域预检（OPTIONS 直接 400，没有任何 Access-Control 头），所以**网页 / PWA 直连永远传不上去**，
 * 只能靠 Cloudflare 中转；而 Cloudflare 到 GitHub 这段实测约 4 成 522。2026-09-12 上游把中转改成
 * 默认关闭后，网页上的 GitHub 备份就一直失败。
 *
 * Git 数据接口全在 api.github.com 上，浏览器可以直接调，不经过任何中转：
 *   1. 每片（24 MB）建一个 blob：POST /git/blobs，base64 内容（实测 30 MB 原始数据一次就能建好）
 *   2. 一棵树装下所有分片 + manifest.json，再建一个没有父提交的孤立提交
 *   3. 最后建分支 refs/heads/sully-backups/<文件名>，备份这才「出现」
 * 中途失败时什么分支都没建，传了一半的 blob 没有任何引用，GitHub 之后会自己回收，不留半截备份。
 * 每份备份是独立的孤立提交，删分支就能把它从仓库里摘掉，不会像普通提交那样永远堆在历史里。
 *
 * 请求统一走调用方传进来的 request（githubClient 的 ghRequest），所以中转 / 原生 / 直连三种线路都能
 * 列出、恢复、删除这种备份；只有「上传」这一步在网页直连时才选它（见 shouldUseGitDataUpload）。
 */
import type { CloudBackupFile } from '../types';

export const GIT_BACKUP_BRANCH_PREFIX = 'sully-backups/';
export const GIT_BACKUP_HREF_PREFIX = 'git:';
/** base64 之后约 32 MB 一个请求，离实测成功的 40 MB 留出余量，也压低手机上的内存峰值。 */
export const GIT_BACKUP_PART_SIZE = 24 * 1024 * 1024;
const MANIFEST_FORMAT = 'sully-git-backup-v1';
const MAX_ATTEMPTS = 3;

export interface GitBackupPart { sha: string; size: number }
export interface GitBackupManifest {
    format: typeof MANIFEST_FORMAT;
    name: string;
    size: number;
    createdAt: number;
    parts: GitBackupPart[];
}

export interface GitResponse {
    status: number;
    headers: Record<string, string>;
    text: () => Promise<string>;
    json: () => Promise<any>;
    arrayBuffer: (onProgress?: (loadedBytes: number) => void) => Promise<ArrayBuffer>;
}

export type GitRequest = (
    url: string,
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    opts?: { headers?: Record<string, string>; body?: string; binary?: boolean },
) => Promise<GitResponse>;

export interface GitBackupContext {
    owner: string;
    repo: string;
    token: string;
    request: GitRequest;
    /** 401 / 403 / 404 等的报错沿用 githubClient 的说法，别两套文案。 */
    describeError: (stage: string, response: GitResponse) => Promise<Error>;
    partSize?: number;
    sleep?: (ms: number) => Promise<void>;
}

/** 只有网页直连才需要换路：原生 App 没有跨域限制，开着中转的也照旧走 Release。 */
export function shouldUseGitDataUpload(proxyOn: boolean, native: boolean): boolean {
    return !proxyOn && !native;
}

export function isGitBackupHref(href: string): boolean {
    return href.startsWith(GIT_BACKUP_HREF_PREFIX);
}

const API = 'https://api.github.com';
const headersFor = (token: string, extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
});

const branchNameFor = (filename: string) =>
    `${GIT_BACKUP_BRANCH_PREFIX}${filename.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]/g, '_')}`;

/** href = git:<提交 sha>:<分支名>，恢复按提交读，删除按分支删。 */
const hrefFor = (commitSha: string, branch: string) => `${GIT_BACKUP_HREF_PREFIX}${commitSha}:${branch}`;
const parseHref = (href: string) => {
    const rest = href.slice(GIT_BACKUP_HREF_PREFIX.length);
    const sep = rest.indexOf(':');
    return sep > 0 ? { commitSha: rest.slice(0, sep), branch: rest.slice(sep + 1) } : null;
};

/**
 * 分段转 base64，Node 和浏览器都能跑。每段长度是 3 的倍数，拼起来跟整体编码一致；
 * 不用 String.fromCharCode(...整个数组)，那样大文件会爆栈。
 */
export async function blobToBase64Chunked(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const CHUNK = 3 * 10922;
    const pieces: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, i + CHUNK);
        let bin = '';
        for (let j = 0; j < slice.length; j += 4096) {
            bin += String.fromCharCode.apply(null, slice.subarray(j, j + 4096) as unknown as number[]);
        }
        pieces.push(btoa(bin));
    }
    return pieces.join('');
}

const isRetryable = (status: number, headers: Record<string, string>) =>
    status === 408 || status === 429 || status >= 500
    || (status === 403 && (Boolean(headers['retry-after']) || headers['x-ratelimit-remaining'] === '0'));

const looksLikeNetworkError = (error: unknown) =>
    error instanceof TypeError || /network|fetch|load failed|连接|超时/i.test(String((error as Error)?.message || ''));

/** 网络错误和 5xx / 429 / 限流重试，其余状态码原样交回调用方判断。 */
async function requestWithRetry(
    ctx: GitBackupContext,
    url: string,
    method: 'GET' | 'POST' | 'DELETE',
    opts: { headers?: Record<string, string>; body?: string; binary?: boolean } = {},
): Promise<GitResponse> {
    const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            const res = await ctx.request(url, method, opts);
            if (attempt < MAX_ATTEMPTS - 1 && isRetryable(res.status, res.headers)) {
                const retryAfter = Number(res.headers['retry-after']);
                await sleep(Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(30_000, retryAfter * 1000) : 750 * 2 ** attempt);
                continue;
            }
            return res;
        } catch (error) {
            lastError = error;
            if (attempt >= MAX_ATTEMPTS - 1 || !looksLikeNetworkError(error)) break;
            await sleep(750 * 2 ** attempt);
        }
    }
    throw lastError instanceof Error ? lastError : new Error('网络请求未完成');
}

async function postJson(ctx: GitBackupContext, path: string, body: unknown, stage: string, okStatus = 201): Promise<any> {
    const res = await requestWithRetry(ctx, `${API}/repos/${ctx.owner}/${ctx.repo}${path}`, 'POST', {
        headers: headersFor(ctx.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    });
    if (res.status !== okStatus) throw await ctx.describeError(stage, res);
    return res.json();
}

export async function uploadGitBackup(
    ctx: GitBackupContext,
    blob: Blob,
    filename: string,
    onProgress?: (percent: number) => void,
    now: () => number = Date.now,
): Promise<{ ok: boolean; message: string }> {
    const partSize = ctx.partSize ?? GIT_BACKUP_PART_SIZE;
    const total = Math.max(1, Math.ceil(blob.size / partSize));
    try {
        onProgress?.(2);
        const parts: GitBackupPart[] = [];
        for (let i = 0; i < total; i++) {
            const slice = blob.slice(i * partSize, Math.min(blob.size, (i + 1) * partSize));
            const content = await blobToBase64Chunked(slice);
            const created = await postJson(ctx, '/git/blobs', { content, encoding: 'base64' },
                total > 1 ? `上传第 ${i + 1}/${total} 片` : '上传备份');
            if (!created?.sha) throw new Error('GitHub 没有返回分片编号');
            parts.push({ sha: created.sha, size: slice.size });
            onProgress?.(Math.min(90, Math.floor(2 + ((i + 1) / total) * 88)));
        }

        const manifest: GitBackupManifest = {
            format: MANIFEST_FORMAT, name: filename, size: blob.size, createdAt: now(), parts,
        };
        const manifestJson = JSON.stringify(manifest);
        const width = String(total).length;
        const tree = await postJson(ctx, '/git/trees', {
            tree: [
                ...parts.map((p, i) => ({
                    path: total > 1 ? `${filename}.part${String(i + 1).padStart(width, '0')}of${total}` : filename,
                    mode: '100644', type: 'blob', sha: p.sha,
                })),
                { path: 'manifest.json', mode: '100644', type: 'blob', content: manifestJson },
            ],
        }, '整理备份文件');
        onProgress?.(94);

        const commit = await postJson(ctx, '/git/commits', {
            message: `Sully Backup ${filename}\n\n${manifestJson}`,
            tree: tree.sha,
            parents: [],
        }, '保存备份');
        onProgress?.(97);

        await postJson(ctx, '/git/refs', { ref: `refs/heads/${branchNameFor(filename)}`, sha: commit.sha }, '登记备份');
        onProgress?.(100);
        return { ok: true, message: '上传成功' };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            message: looksLikeNetworkError(error) ? `上传失败：连不上 api.github.com（${message}），请检查网络后重试。` : message,
        };
    }
}

export function parseManifestFromCommitMessage(message: string): GitBackupManifest | null {
    const start = message.indexOf('{');
    if (start < 0) return null;
    try {
        const parsed = JSON.parse(message.slice(start));
        if (parsed?.format !== MANIFEST_FORMAT || !Array.isArray(parsed.parts) || !parsed.parts.length) return null;
        if (!parsed.parts.every((p: any) => typeof p?.sha === 'string' && Number(p?.size) > 0)) return null;
        return parsed as GitBackupManifest;
    } catch {
        return null;
    }
}

async function readManifest(ctx: GitBackupContext, commitSha: string): Promise<GitBackupManifest | null> {
    const res = await requestWithRetry(ctx, `${API}/repos/${ctx.owner}/${ctx.repo}/git/commits/${commitSha}`, 'GET', {
        headers: headersFor(ctx.token),
    });
    if (res.status !== 200) throw await ctx.describeError('读取备份信息', res);
    const data = await res.json();
    return parseManifestFromCommitMessage(String(data?.message || ''));
}

export async function listGitBackups(ctx: GitBackupContext): Promise<CloudBackupFile[]> {
    const res = await requestWithRetry(
        ctx,
        `${API}/repos/${ctx.owner}/${ctx.repo}/git/matching-refs/heads/${GIT_BACKUP_BRANCH_PREFIX}`,
        'GET',
        { headers: headersFor(ctx.token) },
    );
    // 空仓库（还没有任何提交）时 GitHub 回 409：当作没有这种备份。
    if (res.status === 409) return [];
    if (res.status !== 200) throw await ctx.describeError('读取 GitHub 备份列表', res);
    const refs: Array<{ ref: string; object?: { sha?: string; type?: string } }> = await res.json();
    const files = await Promise.all(refs.map(async (ref): Promise<CloudBackupFile | null> => {
        const sha = ref.object?.sha;
        if (!sha || ref.object?.type !== 'commit') return null;
        const manifest = await readManifest(ctx, sha);
        if (!manifest) return null; // 不是我们写的格式（或者被人手动改过），不认
        return {
            name: manifest.name,
            size: manifest.size,
            lastModified: new Date(manifest.createdAt).toISOString(),
            href: hrefFor(sha, ref.ref.replace(/^refs\/heads\//, '')),
            status: 'ready',
            partSizes: manifest.parts.map(p => p.size),
        };
    }));
    return files.filter((f): f is CloudBackupFile => Boolean(f));
}

export async function downloadGitBackup(
    ctx: GitBackupContext,
    file: CloudBackupFile,
    onProgress?: (percent: number) => void,
): Promise<Blob> {
    const parsed = parseHref(file.href);
    if (!parsed) throw new Error('这个备份缺少有效的 GitHub 标识，请刷新备份列表后重试。');
    onProgress?.(2);
    const manifest = await readManifest(ctx, parsed.commitSha);
    if (!manifest) throw new Error('这个 GitHub 备份的信息读不出来，可能已被改动。');

    const buffers: ArrayBuffer[] = [];
    let done = 0;
    for (const [i, part] of manifest.parts.entries()) {
        const before = done;
        const res = await requestWithRetry(ctx, `${API}/repos/${ctx.owner}/${ctx.repo}/git/blobs/${part.sha}`, 'GET', {
            headers: headersFor(ctx.token, { Accept: 'application/vnd.github.raw' }),
            binary: true,
        });
        if (res.status !== 200) throw await ctx.describeError(`下载第 ${i + 1}/${manifest.parts.length} 片`, res);
        const buffer = await res.arrayBuffer(loaded => {
            onProgress?.(Math.min(98, Math.floor(2 + ((before + loaded) / manifest.size) * 96)));
        });
        if (buffer.byteLength !== part.size) {
            throw new Error(`GitHub 备份分片大小不符（应为 ${part.size} 字节，实际 ${buffer.byteLength} 字节）。`);
        }
        buffers.push(buffer);
        done += buffer.byteLength;
        onProgress?.(Math.min(98, Math.floor(2 + (done / manifest.size) * 96)));
    }
    onProgress?.(100);
    return new Blob(buffers, { type: 'application/zip' });
}

export async function deleteGitBackup(ctx: GitBackupContext, file: CloudBackupFile): Promise<boolean> {
    const parsed = parseHref(file.href);
    if (!parsed) return false;
    try {
        const res = await requestWithRetry(
            ctx,
            `${API}/repos/${ctx.owner}/${ctx.repo}/git/refs/heads/${parsed.branch.split('/').map(encodeURIComponent).join('/')}`,
            'DELETE',
            { headers: headersFor(ctx.token) },
        );
        // 422 = 分支已经不在了，结果一样
        return res.status === 204 || res.status === 404 || res.status === 422;
    } catch {
        return false;
    }
}
