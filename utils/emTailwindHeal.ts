/**
 * 样式自救（2026-10-14 阿萌的手机：录屏时页面崩了一下，之后每次打开都整屏没样式，杀掉重开也没用）。
 *
 * 样式全靠 index.html 里的 Tailwind 运行时现算；它没跑起来（window.tailwind 不存在），多半是 SW 缓存里
 * 存了一份坏的。联网时删掉缓存里的开机 CDN 再刷新一次；一次会话只试一次，断网时不删（坏的也比没有强）。
 * 不碰 IndexedDB / localStorage，聊天和数据都不受影响。
 */
const TRIED = 'em-tailwind-heal';
const CDN = 'https://cdn.tailwindcss.com/';

export function installTailwindHeal(): void {
  const check = async () => {
    if ('tailwind' in window || !navigator.onLine) return;
    try {
      if (sessionStorage.getItem(TRIED)) return;
      sessionStorage.setItem(TRIED, '1');
    } catch { return; }
    try {
      for (const name of await caches.keys()) {
        if (!name.startsWith('liliumos-assets-')) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) if (request.url.startsWith(CDN)) await cache.delete(request);
      }
    } catch { /* 没有 Cache Storage 也照样刷新一次 */ }
    location.reload();
  };
  if (document.readyState === 'complete') window.setTimeout(() => { void check(); }, 1500);
  else window.addEventListener('load', () => window.setTimeout(() => { void check(); }, 1500), { once: true });
}
