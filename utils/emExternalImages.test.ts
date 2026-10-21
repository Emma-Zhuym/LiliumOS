// [EM-START: external-images-rescue]
import { describe, expect, it } from 'vitest';

import {
    applyImageReplacements, blobToBase64, collectExternalImages, deadEmojiNames, downloadExternalImage, rescueExternalImages,
    type ExternalImage,
} from './emExternalImages';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const pngResponse = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
const CATBOX = 'https://files.catbox.moe/bgid0b.jpg';
const SHARKPAN = 'http://sharkpan.xyz/f/JnJIg/4344AAD53418BAE9569B06CEF9CFDDED_0.jpg';

const upstreamError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('扫外链图', () => {
    it('表情包、角色头像、我的头像都认；本机令牌和 data URL 不算；同一网址合并', () => {
        const images = collectExternalImages({
            emojis: [
                { name: '乖乖当狗', url: CATBOX },
                { name: '你少看扁我', url: SHARKPAN },
                { name: '本机的', url: 'blobref:b_abc' },
            ],
            characters: [
                { id: 'fox', name: '狐狐', avatar: CATBOX },
                { id: 'cat', name: '猫猫', avatar: 'data:image/png;base64,AAAA' },
            ],
            user: { avatar: 'https://i.imgur.com/me.png', perCharAvatars: { fox: 'https://i.imgur.com/me-fox.png', gone: 'https://i.imgur.com/x.png' } },
        });
        expect(images.map(image => image.host)).toEqual(['files.catbox.moe', 'i.imgur.com', 'i.imgur.com', 'sharkpan.xyz']);
        expect(images[0].uses.map(use => use.label)).toEqual(['表情包：乖乖当狗', '狐狐的头像']);
        expect(images.flatMap(image => image.uses.map(use => use.label))).toContain('我在狐狐那边的头像');
        // 删掉的角色留下的分角色头像不管
        expect(images.some(image => image.url.endsWith('/x.png'))).toBe(false);
    });
});

describe('下载一张', () => {
    it('浏览器直接下得到就不麻烦 mini', async () => {
        const result = await downloadExternalImage(CATBOX, '乖乖当狗', {
            fetchImpl: async () => pngResponse(), miniFetch: async () => { throw new Error('不该调用'); }, pageIsHttps: true,
        });
        expect(result.status).toBe('ok');
        expect(result.status === 'ok' && result.via).toBe('direct');
    });

    it('https 页面上的 http 图直接交给 mini；mini 说图床挂了就是打不开', async () => {
        let browserTried = false;
        const result = await downloadExternalImage(SHARKPAN, '你少看扁我', {
            fetchImpl: async () => { browserTried = true; return pngResponse(); },
            miniFetch: async () => { throw upstreamError('UPSTREAM_STATUS', '图床返回 522'); },
            pageIsHttps: true,
        });
        expect(browserTried).toBe(false);
        expect(result).toEqual({ status: 'dead', reason: '图床返回 522' });
    });

    it('浏览器被拦（跨域）就请 mini 代下；mini 下到了算成功', async () => {
        const result = await downloadExternalImage(CATBOX, '乖乖当狗', {
            fetchImpl: async () => { throw new TypeError('Load failed'); },
            miniFetch: async () => ({ mime: 'image/png', dataBase64: await blobToBase64(new Blob([PNG])) }),
            pageIsHttps: true,
        });
        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
            expect(result.via).toBe('mini');
            expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(PNG);
        }
    });

    it('图床回了一张网页（200）不算图：图床给了明确回答，算打不开', async () => {
        const result = await downloadExternalImage(CATBOX, 'x', {
            fetchImpl: async () => new Response('<html>gone</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
            miniFetch: null, pageIsHttps: true,
        });
        expect(result).toEqual({ status: 'dead', reason: '图床返回的不是图片' });
    });

    it('没连 mini：图床明确回了状态码算打不开，被拦着说不准', async () => {
        const dead = await downloadExternalImage(CATBOX, 'x', { fetchImpl: async () => new Response('', { status: 404 }), miniFetch: null, pageIsHttps: true });
        expect(dead.status).toBe('dead');
        const unknown = await downloadExternalImage(CATBOX, 'x', { fetchImpl: async () => { throw new TypeError('Load failed'); }, miniFetch: null, pageIsHttps: true });
        expect(unknown.status).toBe('unknown');
    });

    it('mini 的后端没更新（没有这个接口）、mini 没开：说不准，不算打不开', async () => {
        const blocked = async () => { throw new TypeError('Load failed'); };
        const old = await downloadExternalImage(CATBOX, 'x', { fetchImpl: blocked, miniFetch: async () => { throw upstreamError('NOT_FOUND', '未知路径'); }, pageIsHttps: true });
        expect(old.status).toBe('unknown');
        expect(old.status !== 'ok' && old.reason).toContain('拉代码重启');
        const offline = await downloadExternalImage(CATBOX, 'x', { fetchImpl: blocked, miniFetch: async () => { throw upstreamError('UNREACHABLE', '连不上 Mac mini 后端'); }, pageIsHttps: true });
        expect(offline.status).toBe('unknown');
    });
});

describe('一整轮', () => {
    const image = (url: string, emojiName: string): ExternalImage => ({ url, host: new URL(url).hostname, uses: [{ kind: 'emoji', label: `表情包：${emojiName}`, emojiName }] });

    it('能下的存本机、补传 mini；打不开的分开列；补传失败不影响本机', async () => {
        const stored: Blob[] = [];
        let backups = 0;
        const outcome = await rescueExternalImages([image(CATBOX, '乖乖当狗'), image(SHARKPAN, '你少看扁我'), image('https://files.catbox.moe/l14x54.jpg', '亲亲')], {
            fetchImpl: async () => pngResponse(),
            miniFetch: async () => { throw upstreamError('UPSTREAM_STATUS', '图床返回 522'); },
            pageIsHttps: true,
            storeBlob: async blob => { stored.push(blob); return `blobref:b_${stored.length}`; },
            miniBackup: async () => { backups += 1; if (backups === 2) throw new Error('mini 断了'); },
        });
        expect([...outcome.replacements.keys()].sort()).toEqual([CATBOX, 'https://files.catbox.moe/l14x54.jpg']);
        expect(outcome.dead.map(failure => failure.image.url)).toEqual([SHARKPAN]);
        expect(outcome.backedUp).toBe(1);
        expect(outcome.backupFailed).toBe(1);
        expect(deadEmojiNames(outcome.dead)).toEqual(['你少看扁我']);
    });
});

describe('改写引用', () => {
    it('表情库、角色头像、我的头像、聊天里发过的表情都换成本机令牌；别的不动', async () => {
        const replacements = new Map([[CATBOX, 'blobref:b_1']]);
        const savedEmojis: [string, string, string | undefined][] = [];
        const charUpdates: [string, string][] = [];
        let userUpdate: unknown = null;
        const messages = [
            { id: 1, type: 'emoji', content: CATBOX },
            { id: 2, type: 'text', content: CATBOX },
            { id: 3, type: 'emoji', content: SHARKPAN },
            { id: 4, type: 'image', content: CATBOX },
        ];
        const written: unknown[] = [];
        const summary = await applyImageReplacements(replacements, {
            getEmojis: async () => [{ name: '乖乖当狗', url: CATBOX, categoryId: 'c1' }, { name: '你少看扁我', url: SHARKPAN }],
            saveEmoji: async (name, url, categoryId) => { savedEmojis.push([name, url, categoryId]); },
            characters: [{ id: 'fox', avatar: CATBOX }, { id: 'cat', avatar: 'blobref:b_9' }],
            updateCharacterAvatar: (id, avatar) => { charUpdates.push([id, avatar]); },
            user: { avatar: 'blobref:b_me', perCharAvatars: { fox: CATBOX, cat: 'data:image/png;base64,AA' } },
            updateUserAvatars: updates => { userUpdate = updates; },
            getMessagesPage: async afterKey => (afterKey === null ? { rows: messages, lastKey: 4 } : { rows: [], lastKey: null }),
            putMessages: async rows => { written.push(...rows); },
        });
        expect(savedEmojis).toEqual([['乖乖当狗', 'blobref:b_1', 'c1']]);
        expect(charUpdates).toEqual([['fox', 'blobref:b_1']]);
        expect(userUpdate).toEqual({ perCharAvatars: { fox: 'blobref:b_1', cat: 'data:image/png;base64,AA' } });
        expect(written).toEqual([{ id: 1, type: 'emoji', content: 'blobref:b_1' }, { id: 4, type: 'image', content: 'blobref:b_1' }]);
        expect(summary).toEqual({ emojis: 1, characterAvatars: 1, userAvatars: 1, messages: 2 });
    });
});
// [EM-END: external-images-rescue]
