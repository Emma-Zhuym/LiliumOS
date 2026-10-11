import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// [EM-START: token-img-avatars]
// 「优化资源存储」会把角色头像（characters.avatar）和相册图（gallery.url）换成 `blobref:`
// 令牌，二进制在 IndexedDB 里（见 utils/storageOptimize.ts 的覆盖面清单）。令牌塞进裸
// <img src> 就是一张裂图——而且只有**上传过图片**的角色会犯，用外链或表情当头像的角色
// 看起来一切正常，所以这类 bug 特别难被发现。
//
// 上游把自己那些页面都换成了 TokenImg，EM 自己写的页面当时漏了六处：查手机的收藏轮播
// （整个轮播空白）、地图、日程、记账、投喂站、通讯录的头像。这份守卫钉住修好的结果。
//
// 新增页面渲染头像 / 相册图时照这里加一条：值可能是令牌 → 用 TokenImg，别用裸 <img>。
const read = (relative: string) => readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

const PAGES = [
    'apps/CheckPhone.tsx',
    'apps/MapApp.tsx',
    'apps/ScheduleApp.tsx',
    'apps/BankApp.tsx',
    'apps/ShoppingApp.tsx',
    'components/chat/ContactsList.tsx',
];

/** 裸 <img> 且 src 取自形如 xxx.avatar / avatar 的值。 */
const BARE_AVATAR_IMG = /<img[^>]*\ssrc=\{[^}]*\bavatar\b[^}]*\}/i;

describe('EM 页面的图片一律走 TokenImg', () => {
    it.each(PAGES)('%s 里没有直接渲染头像的裸 <img>', relative => {
        const source = read(relative);
        const match = source.match(BARE_AVATAR_IMG);
        expect(match?.[0] ?? null).toBeNull();
    });

    it('每个页面都引入了 TokenImg', () => {
        for (const relative of PAGES) {
            expect(read(relative), relative).toContain('os/TokenImg');
        }
    });

    it('查手机的收藏轮播两张图都走 TokenImg（淡入淡出要同时渲染前后两张）', () => {
        const source = read('apps/CheckPhone.tsx');
        expect(source).toContain('<TokenImg value={prev.url}');
        expect(source).toContain('<TokenImg key={idx} value={cur.url}');
        expect(source).not.toContain('<img src={prev.url}');
        expect(source).not.toContain('<img src={cur.url}');
    });
});
// [EM-END: token-img-avatars]
