#!/usr/bin/env node
/**
 * 把墨线动画页导出成 mp4（EM，2026-10-28 给「一年在窗前」做的，以后别的墨线动画也能用）。
 * 逐帧截图再合成，不是录屏：每帧调页面的 window.inkSeek(秒) 定格，所以不会掉帧、循环接缝准。
 *
 * 要的东西（不进仓库依赖）：
 *   brew install ffmpeg
 *   mkdir -p ~/.cache/lilium-video && cd ~/.cache/lilium-video && npm i playwright@1.48.2 && npx playwright install chromium
 *
 * 用法（仓库根目录）：
 *   node scripts/ink-export-video.mjs [--page docs/design/ink-year-loop.html] [--out ~/Movies/一年在窗前.mp4]
 *                                     [--fps 30] [--start 0] [--loops 1] [--size 1080x1920]
 * 页面要提供 window.inkReady / window.inkTotal / window.inkSeek(sec)（见 docs/design/ink-year-loop.html 末尾）。
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const expand = (p) => p.replace(/^~(?=$|\/)/, homedir());
const PAGE = args.page ?? 'docs/design/ink-year-loop.html';
const OUT = path.resolve(expand(args.out ?? '~/Movies/一年在窗前.mp4'));
const FPS = Number(args.fps ?? 30);
const START = Number(args.start ?? 0); // 从接缝起：开头是锁屏敲字，结尾退格删光，循环播放接得上
const LOOPS = Number(args.loops ?? 1);
const [W, H] = (args.size ?? '1080x1920').split('x').map(Number);
const SCALE = 2; // 页面按一半尺寸排版、两倍像素截图，线条更细

const tools = expand(process.env.INK_VIDEO_TOOLS ?? '~/.cache/lilium-video');
const { chromium } = createRequire(path.join(tools, 'package.json'))('playwright');

// 起一个只读的本地静态服务，根目录是仓库（页面在 localhost 下会直接读 assets/ink/seasons）
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://localhost:${server.address().port}/${PAGE}`;

const frames = await mkdtemp(path.join(tmpdir(), 'ink-frames-'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W / SCALE, height: H / SCALE }, deviceScaleFactor: SCALE });
  await page.goto(url);
  await page.waitForFunction(() => window.inkReady === true, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  // 视频里不要播放条；窗子在竖屏里放大一点
  await page.addStyleTag({ content: '.bar{display:none!important}.art{width:min(100%,470px)!important}' });
  const total = await page.evaluate(() => window.inkTotal);
  const count = Math.round(total * LOOPS * FPS);
  for (let i = 0; i < count; i++) {
    await page.evaluate((sec) => window.inkSeek(sec), START + i / FPS);
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(5, '0')}.png`) });
    if (i % FPS === 0) process.stdout.write(`\r${i}/${count}`);
  }
  process.stdout.write(`\r${count}/${count}\n`);
} finally {
  await browser.close();
  server.close();
}

execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.png'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT,
], { stdio: 'inherit' });
await rm(frames, { recursive: true, force: true });
console.log(OUT);
