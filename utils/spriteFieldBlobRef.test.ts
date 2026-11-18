import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 角色立绘的三个字段——`sprites.*`（见面情绪立绘 + 小小窝的 sprites.chibi）、
// `dateSkinSets[].sprites.*`（换装套装）、`savedDateState.currentSprite`（见面存档快照）
// ——存的值可能是 `blobref:` 令牌（二进制在 IndexedDB，见 utils/blobRef.ts）。
// 令牌塞进裸 <img src> 或 CSS url() 就是一张裂图，所以这些字段的渲染端一律走
// TokenImg（或先 useBlobRefUrl 解析再拼）。
//
// 这份守卫扫源码：只要有人把立绘字段直接接回裸 <img src={...}> / backgroundImage，
// 这条就红。变量名带 Url 后缀的（已经解析过的地址）不在其列。

const ROOTS = ['components', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** 裸 <img src={ ...sprites[...] / ...sprite.xxx... }>：立绘字段值直接当地址用。 */
const BARE_IMG = /<img\b[^>]*\bsrc=\{[^}]*\bsprites?\s*[[.]/;
/** CSS url() 里插立绘字段值。 */
const BARE_CSS_URL = /backgroundImage[^\n]*\$\{[^}]*\bsprites?\s*[[.]/;
/** 见面存档快照里的立绘值直接当地址用。 */
const BARE_SAVED_SPRITE = /(?:<img\b[^>]*\bsrc=|url\(\$)\{[^}]*\bcurrentSprite\b[^}]*\}/;

function collectTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectTsxFiles(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const repoRoot = path.resolve(__dirname, '..');
const files = ROOTS.flatMap(root => collectTsxFiles(path.join(repoRoot, root)));

const scan = (pattern: RegExp): string[] => files
  .filter(file => pattern.test(readFileSync(file, 'utf8')))
  .map(file => path.relative(repoRoot, file));

describe('立绘字段的 blobref 渲染路径', () => {
  it('扫到了源码文件（别让路径写错导致这份守卫空跑）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('没有任何 sprites 字段值被塞进裸 <img src>', () => {
    expect(scan(BARE_IMG)).toEqual([]);
  });

  it('没有任何 sprites 字段值被拼进 CSS url()', () => {
    expect(scan(BARE_CSS_URL)).toEqual([]);
  });

  it('见面存档里的 currentSprite 也不走裸 <img src> / url()', () => {
    expect(scan(BARE_SAVED_SPRITE)).toEqual([]);
  });
});

describe('见面设置（MeetSettings）的立绘缩略图', () => {
  const source = readFileSync(path.join(repoRoot, 'components/date/MeetSettings.tsx'), 'utf8');

  it('情绪格子（默认和皮肤共用一套格子）走 TokenImg', () => {
    expect(source).toContain('<TokenImg value={sprites[key]}');
    expect(source).not.toContain('<img src={sprites[key]}');
  });
});

describe('见面设置（MeetSettings）的立绘上传写端', () => {
  const source = readFileSync(path.join(repoRoot, 'components/date/MeetSettings.tsx'), 'utf8');

  it('上传立绘存的是令牌，不是 base64', () => {
    expect(source).toContain('const ref = await putImageBlob(await processImageToBlob(file));');
    expect(source).toContain('setSprite(target.key, ref);');
    expect(source).not.toContain('processImage(file)');
  });

  it('立绘保持原来的压缩口径，背景才保原画质', () => {
    expect(source).toContain('await processImageToBlob(file, { skipCompression: true })');
    expect(source.match(/skipCompression/g)?.length).toBe(1);
  });

  it('网址入口照旧写外链（外链不是本机资源，不该令牌化）', () => {
    expect(source).toContain('setSprite(tile, url);');
  });
});
