import { describe, expect, it, vi } from 'vitest';
import {
    blobToBase64Chunked,
    deleteGitBackup,
    downloadGitBackup,
    isGitBackupHref,
    listGitBackups,
    parseManifestFromCommitMessage,
    shouldUseGitDataUpload,
    uploadGitBackup,
    type GitBackupContext,
    type GitResponse,
} from './githubGitBackup';

const API = 'https://api.github.com/repos/owner/sully-backup';

const respond = (status: number, body: unknown = {}, headers: Record<string, string> = {}): GitResponse => {
    const isBinary = body instanceof Uint8Array;
    return {
        status,
        headers,
        text: async () => (isBinary ? '' : JSON.stringify(body)),
        json: async () => body,
        arrayBuffer: async (onProgress) => {
            const bytes = isBinary ? body as Uint8Array : new Uint8Array();
            onProgress?.(bytes.byteLength);
            return bytes.slice().buffer;
        },
    };
};

/** 只实现用得到的几个 Git 数据接口，够跑通上传 → 列表 → 下载 → 删除。 */
class FakeGitHub {
    blobs = new Map<string, Uint8Array>();
    trees = new Map<string, any[]>();
    commits = new Map<string, { message: string; tree: string; parents: string[] }>();
    refs = new Map<string, string>();
    calls: string[] = [];
    seq = 0;
    failNext: Array<(method: string, path: string) => GitResponse | Error | null> = [];

    request = vi.fn(async (url: string, method: string, opts: { body?: string; headers?: Record<string, string> } = {}) => {
        const path = url.replace(API, '');
        this.calls.push(`${method} ${path}`);
        for (let i = 0; i < this.failNext.length; i++) {
            const injected = this.failNext[i](method, path);
            if (injected) {
                this.failNext.splice(i, 1);
                if (injected instanceof Error) throw injected;
                return injected;
            }
        }
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        const id = () => `sha${++this.seq}`;
        if (method === 'POST' && path === '/git/blobs') {
            const sha = id();
            this.blobs.set(sha, new Uint8Array(Buffer.from(body.content, 'base64')));
            return respond(201, { sha });
        }
        if (method === 'POST' && path === '/git/trees') {
            const sha = id();
            this.trees.set(sha, body.tree);
            return respond(201, { sha });
        }
        if (method === 'POST' && path === '/git/commits') {
            const sha = id();
            this.commits.set(sha, body);
            return respond(201, { sha });
        }
        if (method === 'POST' && path === '/git/refs') {
            if (this.refs.has(body.ref)) return respond(422, { message: 'Reference already exists' });
            this.refs.set(body.ref, body.sha);
            return respond(201, { ref: body.ref });
        }
        if (method === 'GET' && path.startsWith('/git/matching-refs/heads/sully-backups/')) {
            return respond(200, [...this.refs.entries()]
                .filter(([ref]) => ref.startsWith('refs/heads/sully-backups/'))
                .map(([ref, sha]) => ({ ref, object: { sha, type: 'commit' } })));
        }
        const commit = /^\/git\/commits\/(\w+)$/.exec(path);
        if (method === 'GET' && commit) {
            const c = this.commits.get(commit[1]);
            return c ? respond(200, { sha: commit[1], message: c.message }) : respond(404, { message: 'Not Found' });
        }
        const blob = /^\/git\/blobs\/(\w+)$/.exec(path);
        if (method === 'GET' && blob) {
            expect(opts.headers?.Accept).toBe('application/vnd.github.raw');
            const b = this.blobs.get(blob[1]);
            return b ? respond(200, b) : respond(404, { message: 'Not Found' });
        }
        const ref = /^\/git\/refs\/heads\/(.+)$/.exec(path);
        if (method === 'DELETE' && ref) {
            const name = `refs/heads/${decodeURIComponent(ref[1])}`;
            return this.refs.delete(name) ? respond(204) : respond(422, { message: 'Reference does not exist' });
        }
        throw new Error(`unexpected request: ${method} ${path}`);
    });

    ctx(partSize = 10): GitBackupContext {
        return {
            owner: 'owner', repo: 'sully-backup', token: 't',
            request: this.request as unknown as GitBackupContext['request'],
            describeError: async (stage, res) => new Error(`${stage}失败（HTTP ${res.status}）`),
            partSize,
            sleep: async () => {},
        };
    }
}

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256);

describe('路由', () => {
    it('只有网页直连才走 Git 数据接口', () => {
        expect(shouldUseGitDataUpload(false, false)).toBe(true);
        expect(shouldUseGitDataUpload(true, false)).toBe(false);
        expect(shouldUseGitDataUpload(false, true)).toBe(false);
        expect(isGitBackupHref('git:abc:sully-backups/x')).toBe(true);
        expect(isGitBackupHref('123:456')).toBe(false);
    });
});

describe('blobToBase64Chunked', () => {
    it('分段编码跟整体编码一致（含不整除 3 的长度）', async () => {
        for (const n of [0, 1, 2, 3, 32766, 32767, 100_001]) {
            const data = bytes(n, n);
            expect(await blobToBase64Chunked(new Blob([data]))).toBe(Buffer.from(data).toString('base64'));
        }
    });
});

describe('上传 → 列表 → 下载 → 删除', () => {
    it('多分片备份往返后字节完全一致，只建一个分支', async () => {
        const gh = new FakeGitHub();
        const data = bytes(25);
        const progress: number[] = [];
        const result = await uploadGitBackup(gh.ctx(10), new Blob([data]), 'Sully_Backup_full_1760000000000.zip', p => progress.push(p), () => 1760000000000);
        expect(result).toEqual({ ok: true, message: '上传成功' });
        expect(gh.calls.filter(c => c === 'POST /git/blobs')).toHaveLength(3);
        expect([...gh.refs.keys()]).toEqual(['refs/heads/sully-backups/Sully_Backup_full_1760000000000']);
        expect(progress.at(-1)).toBe(100);

        const commit = [...gh.commits.values()][0];
        expect(commit.parents).toEqual([]); // 孤立提交，删分支就能摘掉
        expect([...gh.trees.values()][0].map((e: any) => e.path)).toEqual([
            'Sully_Backup_full_1760000000000.zip.part1of3',
            'Sully_Backup_full_1760000000000.zip.part2of3',
            'Sully_Backup_full_1760000000000.zip.part3of3',
            'manifest.json',
        ]);

        const files = await listGitBackups(gh.ctx());
        expect(files).toHaveLength(1);
        expect(files[0]).toMatchObject({
            name: 'Sully_Backup_full_1760000000000.zip',
            size: 25,
            status: 'ready',
            partSizes: [10, 10, 5],
            lastModified: new Date(1760000000000).toISOString(),
        });

        const blob = await downloadGitBackup(gh.ctx(), files[0]);
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data);

        expect(await deleteGitBackup(gh.ctx(), files[0])).toBe(true);
        expect(await listGitBackups(gh.ctx())).toEqual([]);
    });

    it('单片备份的文件名不带分片后缀', async () => {
        const gh = new FakeGitHub();
        await uploadGitBackup(gh.ctx(100), new Blob([bytes(5)]), 'Sully_Backup_auto_text_only_1.zip');
        expect([...gh.trees.values()][0].map((e: any) => e.path)).toEqual(['Sully_Backup_auto_text_only_1.zip', 'manifest.json']);
    });

    it('中途失败不建分支，列表里不会出现半截备份', async () => {
        const gh = new FakeGitHub();
        gh.failNext.push((m, p) => (m === 'POST' && p === '/git/blobs' && gh.blobs.size === 1 ? respond(422, { message: 'bad' }) : null));
        const result = await uploadGitBackup(gh.ctx(10), new Blob([bytes(25)]), 'Sully_Backup_full_2.zip');
        expect(result.ok).toBe(false);
        expect(result.message).toContain('上传第 2/3 片失败');
        expect(gh.refs.size).toBe(0);
        expect(await listGitBackups(gh.ctx())).toEqual([]);
    });

    it('502 和网络错误会重试，最后成功', async () => {
        const gh = new FakeGitHub();
        gh.failNext.push((m, p) => (m === 'POST' && p === '/git/blobs' ? respond(502, {}) : null));
        gh.failNext.push((m, p) => (m === 'POST' && p === '/git/trees' ? new TypeError('Load failed') : null));
        const result = await uploadGitBackup(gh.ctx(100), new Blob([bytes(5)]), 'Sully_Backup_full_3.zip');
        expect(result.ok).toBe(true);
        expect(gh.calls.filter(c => c === 'POST /git/blobs')).toHaveLength(2);
    });

    it('一直连不上时说清楚是连不上 api.github.com，不扯梯子', async () => {
        const gh = new FakeGitHub();
        for (let i = 0; i < 3; i++) gh.failNext.push((m, p) => (p === '/git/blobs' ? new TypeError('Load failed') : null));
        const result = await uploadGitBackup(gh.ctx(100), new Blob([bytes(5)]), 'Sully_Backup_full_4.zip');
        expect(result.ok).toBe(false);
        expect(result.message).toContain('连不上 api.github.com');
    });

    it('下载时分片大小不符就报错，不拼出坏文件', async () => {
        const gh = new FakeGitHub();
        await uploadGitBackup(gh.ctx(10), new Blob([bytes(15)]), 'Sully_Backup_full_5.zip');
        const [file] = await listGitBackups(gh.ctx());
        const firstSha = [...gh.blobs.keys()][0];
        gh.blobs.set(firstSha, bytes(3));
        await expect(downloadGitBackup(gh.ctx(), file)).rejects.toThrow('分片大小不符');
    });

    it('不认识的提交（被手动改过）不出现在列表里；空仓库 409 当作没有', async () => {
        const gh = new FakeGitHub();
        gh.commits.set('manual', { message: 'hand-made commit', tree: 'x', parents: [] });
        gh.refs.set('refs/heads/sully-backups/manual', 'manual');
        expect(await listGitBackups(gh.ctx())).toEqual([]);

        const empty = new FakeGitHub();
        empty.failNext.push(() => respond(409, { message: 'Git Repository is empty.' }));
        expect(await listGitBackups(empty.ctx())).toEqual([]);
    });

    it('删除已经不在的备份也算成功', async () => {
        const gh = new FakeGitHub();
        expect(await deleteGitBackup(gh.ctx(), {
            name: 'x.zip', size: 1, lastModified: '', href: 'git:sha1:sully-backups/x',
        })).toBe(true);
    });
});

describe('parseManifestFromCommitMessage', () => {
    it('只认我们自己的格式', () => {
        expect(parseManifestFromCommitMessage('Sully Backup a.zip\n\n{"format":"sully-git-backup-v1","name":"a.zip","size":1,"createdAt":1,"parts":[{"sha":"s","size":1}]}'))
            .toMatchObject({ name: 'a.zip' });
        expect(parseManifestFromCommitMessage('{"format":"other","parts":[]}')).toBeNull();
        expect(parseManifestFromCommitMessage('{"format":"sully-git-backup-v1","parts":[]}')).toBeNull();
        expect(parseManifestFromCommitMessage('not json {')).toBeNull();
    });
});
