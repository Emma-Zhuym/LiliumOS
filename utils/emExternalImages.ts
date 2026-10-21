// [EM-START: external-images-rescue]
/**
 * 外链图片存本机：表情包、头像里那些「其实挂在别人图床上」的图，下载下来存进手机。
 *
 * 起因 2026-10-21：阿萌的表情包是从别人的世界书里整批导入的链接——sharkpan 那批两个月前整站
 * 下线（Cloudflare 522），catbox 那批今天也连不上了，表情面板和两个角色的头像全变问号。
 * 字段里存的只是网址，图床一挂就没了；完整备份也只带网址，救不回来。
 *
 * 做法：
 * 1. 扫出所有外链图（表情包 url、角色头像、我的头像 / 分角色头像），同一个网址合并成一条；
 * 2. 逐张下载：先让浏览器直接拿，拿不到（跨域、http 混合内容）就请 mini 代为下载
 *    （server/agent-backend/imageVault.mjs，顺手在 mini 上存一份底）；
 * 3. 存成 blobref 令牌，把字段和聊天记录里发过的表情一起改成令牌——表情消息的 content 就是
 *    当初的网址，只改表情库不改记录，角色那边按网址反查表情名（stickerNameFromUrl）就对不上了；
 * 4. 浏览器自己下下来的，再传一份到 mini 的图片仓库：每天的自动备份只带文字，存进手机的图
 *    不在里面，mini 那份是兜底。
 *
 * 角色和我的头像通过 OSContext 的更新函数改（调用方传进来），不直接写库——直接写库的话，
 * 内存里那份还是旧网址，之后随便一次 updateCharacter 就把它写回去了。
 */

import type { CharacterProfile, Emoji, UserProfile } from '../types';

export type ExternalImageKind = 'emoji' | 'charAvatar' | 'userAvatar' | 'userCharAvatar';

export interface ExternalImageUse {
    kind: ExternalImageKind;
    /** 给人看的：「表情包：乖乖当狗」「狐狐的头像」 */
    label: string;
    emojiName?: string;
    charId?: string;
}

export interface ExternalImage {
    url: string;
    host: string;
    uses: ExternalImageUse[];
}

export const isExternalImageUrl = (value: unknown): value is string =>
    typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());

export const hostOf = (url: string): string => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '未知网址'; }
};

export interface ExternalImageSources {
    emojis: Emoji[];
    characters: Pick<CharacterProfile, 'id' | 'name' | 'avatar'>[];
    user: Pick<UserProfile, 'avatar' | 'perCharAvatars'> | null;
}

/** 扫出所有外链图。同一个网址被好几处用到时合并成一条，按图床、再按名字排。 */
export const collectExternalImages = ({ emojis, characters, user }: ExternalImageSources): ExternalImage[] => {
    const byUrl = new Map<string, ExternalImage>();
    const add = (raw: unknown, use: ExternalImageUse) => {
        if (!isExternalImageUrl(raw)) return;
        const url = raw.trim();
        const entry = byUrl.get(url) ?? { url, host: hostOf(url), uses: [] };
        entry.uses.push(use);
        byUrl.set(url, entry);
    };
    const nameOf = new Map(characters.map(c => [c.id, c.name]));

    for (const emoji of emojis) add(emoji.url, { kind: 'emoji', label: `表情包：${emoji.name}`, emojiName: emoji.name });
    for (const char of characters) add(char.avatar, { kind: 'charAvatar', label: `${char.name}的头像`, charId: char.id });
    if (user) {
        add(user.avatar, { kind: 'userAvatar', label: '我的头像' });
        for (const [charId, avatar] of Object.entries(user.perCharAvatars ?? {})) {
            const name = nameOf.get(charId);
            if (name) add(avatar, { kind: 'userCharAvatar', label: `我在${name}那边的头像`, charId });
        }
    }
    return [...byUrl.values()].sort((a, b) => a.host.localeCompare(b.host) || a.uses[0].label.localeCompare(b.uses[0].label, 'zh'));
};

// ── 下载 ───────────────────────────────────────────────────────

/** 按文件头认图。图床挂了常常回一张 200 的网页，不能光看状态码。 */
export const looksLikeImage = (bytes: Uint8Array): boolean => {
    if (bytes.length < 12) return false;
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
    return (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        || ascii(0, 4) === 'GIF8'
        || (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
        || (bytes[0] === 0x42 && bytes[1] === 0x4d)
        || ascii(4, 8) === 'ftyp';
};

const blobIsImage = async (blob: Blob): Promise<boolean> =>
    looksLikeImage(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));

export type DownloadResult =
    | { status: 'ok'; blob: Blob; via: 'direct' | 'mini' }
    /** 图床明确说没有了 / 挂了 */
    | { status: 'dead'; reason: string }
    /** 没能判断：浏览器下不了、mini 也没连上 */
    | { status: 'unknown'; reason: string };

/** mini 代为下载的结果；失败时抛出带 code 的错误（AgentBackendError）。 */
export type MiniFetch = (url: string, label: string) => Promise<{ mime: string; dataBase64: string }>;

export interface DownloadDeps {
    fetchImpl?: typeof fetch;
    /** 没配对 mini 时传 null */
    miniFetch: MiniFetch | null;
    /** 页面是 https 时，浏览器会拦掉 http 图（混合内容），直接交给 mini */
    pageIsHttps: boolean;
    timeoutMs?: number;
}

const base64ToBlob = (base64: string, mime: string): Blob => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
};

export const blobToBase64 = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
};

/** mini 那边哪些错误代表「图床那头没了」（imageVault.mjs 的 UPSTREAM_* / DNS_FAILED） */
const isUpstreamFailure = (code: unknown) => typeof code === 'string' && (code.startsWith('UPSTREAM_') || code === 'DNS_FAILED');

export const downloadExternalImage = async (url: string, label: string, deps: DownloadDeps): Promise<DownloadResult> => {
    const fetchImpl = deps.fetchImpl ?? fetch;
    let directProblem = '';

    if (url.startsWith('http:') && deps.pageIsHttps) {
        directProblem = '网页不能直接下 http 的图';
    } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
        try {
            // 图床挂了是这里的预期结果，别让 OSContext 的网络日志为每一张都点亮 SYSTEM ERROR
            const init = { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal, __sullySuppressNetworkFailureLog: true } as RequestInit;
            const response = await fetchImpl(url, init);
            if (response.ok) {
                const blob = await response.blob();
                if (await blobIsImage(blob)) return { status: 'ok', blob, via: 'direct' };
                directProblem = '图床返回的不是图片';
            } else {
                directProblem = `图床返回 ${response.status}`;
            }
        } catch {
            directProblem = controller.signal.aborted ? '图床超时没响应' : '浏览器下不了（图床连不上，或者不让网页跨域下载）';
        } finally {
            clearTimeout(timer);
        }
    }

    if (!deps.miniFetch) {
        // 浏览器拿到了明确的回答（状态码 / 不是图）：图床那头确实没了。只是被拦着就说不准。
        return directProblem.startsWith('图床返回')
            ? { status: 'dead', reason: directProblem }
            : { status: 'unknown', reason: `${directProblem}；连上 Mac mini 后可以让它代为下载` };
    }

    try {
        const got = await deps.miniFetch(url, label);
        const blob = base64ToBlob(got.dataBase64, got.mime);
        return { status: 'ok', blob, via: 'mini' };
    } catch (error) {
        const code = (error as { code?: unknown })?.code;
        const message = (error as Error)?.message || '未知错误';
        if (isUpstreamFailure(code)) return { status: 'dead', reason: message };
        if (code === 'NOT_FOUND') return { status: 'unknown', reason: `${directProblem}；mini 的后端还没更新，拉代码重启后再试` };
        return { status: 'unknown', reason: `${directProblem}；mini 也没帮上忙（${message}）` };
    }
};

// ── 一整轮 ─────────────────────────────────────────────────────

export interface RescueDeps extends DownloadDeps {
    /** 存进本机，返回 blobref 令牌（真实环境用 putImageBlobDeduped） */
    storeBlob: (blob: Blob) => Promise<string>;
    /** 浏览器自己下下来的图，传一份到 mini（没配对传 null）；失败只记数，不影响本机 */
    miniBackup: ((blob: Blob, url: string, label: string) => Promise<void>) | null;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
}

export interface RescueFailure { image: ExternalImage; reason: string }

export interface RescueOutcome {
    /** 网址 → 本机令牌 */
    replacements: Map<string, string>;
    dead: RescueFailure[];
    unknown: RescueFailure[];
    /** mini 上有一份的张数（代为下载的 + 补传成功的） */
    backedUp: number;
    backupFailed: number;
}

export const rescueExternalImages = async (images: ExternalImage[], deps: RescueDeps): Promise<RescueOutcome> => {
    const outcome: RescueOutcome = { replacements: new Map(), dead: [], unknown: [], backedUp: 0, backupFailed: 0 };
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < images.length) {
            const image = images[next++];
            const label = image.uses.map(use => use.label).join('、').slice(0, 120);
            const result = await downloadExternalImage(image.url, label, deps);
            if (result.status === 'ok') {
                const token = await deps.storeBlob(result.blob);
                outcome.replacements.set(image.url, token);
                if (result.via === 'mini') outcome.backedUp += 1;
                else if (deps.miniBackup) {
                    try { await deps.miniBackup(result.blob, image.url, label); outcome.backedUp += 1; } catch { outcome.backupFailed += 1; }
                }
            } else {
                (result.status === 'dead' ? outcome.dead : outcome.unknown).push({ image, reason: result.reason });
            }
            done += 1;
            deps.onProgress?.(done, images.length);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(deps.concurrency ?? 3, images.length)) }, worker));
    return outcome;
};

// ── 改写引用 ───────────────────────────────────────────────────

export interface ApplyDeps {
    getEmojis: () => Promise<Emoji[]>;
    saveEmoji: (name: string, url: string, categoryId?: string) => Promise<void>;
    characters: Pick<CharacterProfile, 'id' | 'avatar'>[];
    updateCharacterAvatar: (charId: string, avatar: string) => void;
    user: Pick<UserProfile, 'avatar' | 'perCharAvatars'> | null;
    updateUserAvatars: (updates: Partial<Pick<UserProfile, 'avatar' | 'perCharAvatars'>>) => void;
    /** 按主键分页读 / 写 messages（DB.getStoreRowsPage / DB.putStoreRows） */
    getMessagesPage: (afterKey: IDBValidKey | null, limit: number) => Promise<{ rows: unknown[]; lastKey: IDBValidKey | null }>;
    putMessages: (rows: unknown[]) => Promise<void>;
}

export interface ApplySummary { emojis: number; characterAvatars: number; userAvatars: number; messages: number }

const MESSAGE_PAGE = 200;

export const applyImageReplacements = async (replacements: Map<string, string>, deps: ApplyDeps): Promise<ApplySummary> => {
    const summary: ApplySummary = { emojis: 0, characterAvatars: 0, userAvatars: 0, messages: 0 };
    if (replacements.size === 0) return summary;
    const swap = (value: unknown) => (typeof value === 'string' ? replacements.get(value.trim()) : undefined);

    for (const emoji of await deps.getEmojis()) {
        const token = swap(emoji.url);
        if (!token) continue;
        await deps.saveEmoji(emoji.name, token, emoji.categoryId);
        summary.emojis += 1;
    }

    for (const char of deps.characters) {
        const token = swap(char.avatar);
        if (!token) continue;
        deps.updateCharacterAvatar(char.id, token);
        summary.characterAvatars += 1;
    }

    if (deps.user) {
        const updates: Partial<Pick<UserProfile, 'avatar' | 'perCharAvatars'>> = {};
        const avatarToken = swap(deps.user.avatar);
        if (avatarToken) { updates.avatar = avatarToken; summary.userAvatars += 1; }
        const per = deps.user.perCharAvatars ?? {};
        let perChanged = false;
        const nextPer: Record<string, string> = { ...per };
        for (const [charId, avatar] of Object.entries(per)) {
            const token = swap(avatar);
            if (token) { nextPer[charId] = token; perChanged = true; summary.userAvatars += 1; }
        }
        if (perChanged) updates.perCharAvatars = nextPer;
        if (Object.keys(updates).length) deps.updateUserAvatars(updates);
    }

    // 聊天里发过的表情 / 图：content 整条就是网址
    let afterKey: IDBValidKey | null = null;
    for (;;) {
        const { rows, lastKey } = await deps.getMessagesPage(afterKey, MESSAGE_PAGE);
        const changed: unknown[] = [];
        for (const row of rows) {
            const message = row as { type?: string; content?: unknown };
            if (message.type !== 'emoji' && message.type !== 'image') continue;
            const token = swap(message.content);
            if (!token) continue;
            changed.push({ ...message, content: token });
        }
        if (changed.length) {
            await deps.putMessages(changed);
            summary.messages += changed.length;
        }
        if (lastKey === null || rows.length < MESSAGE_PAGE) break;
        afterKey = lastKey;
    }
    return summary;
};

/** 打不开的那些里，是表情包的名字（给「删掉打不开的表情包」用）。 */
export const deadEmojiNames = (failures: RescueFailure[]): string[] =>
    failures.flatMap(failure => failure.image.uses.filter(use => use.kind === 'emoji' && use.emojiName).map(use => use.emojiName as string));
// [EM-END: external-images-rescue]
