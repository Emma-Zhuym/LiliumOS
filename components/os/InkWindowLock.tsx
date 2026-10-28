/**
 * 墨线窗锁屏（EM 独有，外观 → 锁屏壁纸里的开关打开时才用，theme.lockStyle === 'inkWindow'）。
 *
 * 「四季的光」的初冬：一扇结霜的窗，窗外是后院。三层叠起来：
 *   天 = canvas 按设备时间画的淡彩（utils/inkSky.ts + inkSkyPaint.ts）
 *   景 = 后院线稿（白天灰靛 / 夜里黑底金线）
 *   窗 = 霜、百叶、窗台上的蜡烛（跟其他季节同一扇能推开的窗，关着）
 * 白天百叶从窗上拉起来；夜里屋里的光从窗台那支蜡烛那儿亮开。字用打字机敲出 LILIUM / 时间 / 日期（/ 未读）。
 * 参考实现 docs/design/ink-splash-winter.html，取值全部来自 utils/inkTokens.ts。
 *
 * 钟跟设备时间（锁屏属于「用户自己的时间」，见 docs/character-timezone.md）。点一下就解锁，不用等动画。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { INK, INK_DAY_FILTER, INK_FONT, INK_GRAIN, INK_MOTION, INK_NIGHT, INK_PAPER } from '../../utils/inkTokens';
import { hourOf, isInkNight } from '../../utils/inkSky';
import { paintInkSky } from '../../utils/inkSkyPaint';
import windowDay from '../../assets/ink/earlywinter-layer-window-day.webp';
import windowNight from '../../assets/ink/earlywinter-layer-window-night.webp';
import gardenDay from '../../assets/ink/winter-view-garden.webp';
import gardenNight from '../../assets/ink/winter-view-garden-night.webp';

// 窗格位置按 1024×1536 的窗层量；天和景只从这六格里露出来。
// 关着的窗（初冬 / 盛夏对齐后）都是这套：百叶底 300、横档 513–544 / 913–940、中梃 495–528
const ART_W = 1024, ART_H = 1536;
const PANES: Array<[number, number, number, number]> = [
  [151, 301, 344, 212], [529, 301, 344, 212],
  [151, 545, 344, 368], [529, 545, 344, 368],
  [151, 941, 344, 364], [529, 941, 344, 364],
];
const HORIZON = 0.42;
const PANE_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${ART_W} ${ART_H}' preserveAspectRatio='none'><g fill='#000'>${PANES.map(([x, y, w, h]) => `<rect x='${x}' y='${y}' width='${w}' height='${h}'/>`).join('')}</g></svg>`,
)}")`;

const TYPE_START_MS = 1150;
const TYPE_STEP_MS = 65;
const DONE_MS = 3400;
const IMAGE_WAIT_MS = 1500;
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = (n: number) => String(n).padStart(2, '0');

const CSS = `
@property --ink-lamp{syntax:'<percentage>';inherits:false;initial-value:150%}
.ink-lock{--paper:${INK_PAPER.paper};--grain:${INK_GRAIN.day};--ink:${INK.ink};--text:${INK.text};--slat:${INK.faint};
  position:relative;width:100%;height:100%;overflow:hidden;container-type:size;cursor:pointer;user-select:none;-webkit-user-select:none;
  background-color:var(--paper);background-image:var(--grain);color:var(--text);
  display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:${INK_FONT.serif}}
.ink-lock.is-night{--paper:${INK_NIGHT.paper};--grain:${INK_GRAIN.night};--ink:${INK_NIGHT.gold};--text:${INK_NIGHT.text}}
.ink-lock:focus-visible{outline:2px solid var(--ink);outline-offset:-4px}
/* 带动画 / 遮罩的层会自成一组，叠底 / 滤色只能跟组里的底色混，所以每一层都铺一层纸，不然露白底或黑框 */
.ink-lock-art{position:relative;width:min(78cqw,calc((100cqh - 230px) * 2 / 3));aspect-ratio:2/3;opacity:0;
  background-color:var(--paper);background-image:var(--grain)}
.ink-lock-scene{position:absolute;inset:0;background-color:var(--paper);background-image:var(--grain)}
.ink-lock-out{position:absolute;inset:0;background-color:var(--paper);background-image:var(--grain);
  -webkit-mask:${PANE_MASK} 0 0/100% 100% no-repeat;mask:${PANE_MASK} 0 0/100% 100% no-repeat}
.ink-lock-out canvas,.ink-lock-out img,.ink-lock-win{position:absolute;inset:0;width:100%;height:100%;display:block}
/* 白天去色映射成灰靛再正片叠底；景比窗淡（约 0.55），霜和窗外才分得出前后。夜里黑底金线直接滤色 */
.ink-lock-out img{object-fit:cover;filter:url(#ink-lock-day-ink);mix-blend-mode:multiply;opacity:.55}
.ink-lock-win{filter:url(#ink-lock-day-ink);mix-blend-mode:multiply}
.is-night .ink-lock-out img,.is-night .ink-lock-win{filter:none;mix-blend-mode:screen}
.is-night .ink-lock-out img{opacity:.85}
/* 放下的百叶：只在白天，盖住窗格，拉起时从下往上收；纸色不透明才能把图挡住 */
.ink-lock-blind{position:absolute;left:7.3%;width:85.3%;top:18.9%;height:66%;background-color:var(--paper);
  background-image:repeating-linear-gradient(to bottom,transparent 0 calc(var(--pitch) - 1px),var(--slat) calc(var(--pitch) - 1px) var(--pitch)),var(--grain);
  clip-path:inset(0 0 0% 0)}
.ink-lock-blind::before,.ink-lock-blind::after{content:"";position:absolute;top:0;bottom:0;width:0.75px;background:var(--slat)}
.ink-lock-blind::before{left:7%}.ink-lock-blind::after{right:7%}
.ink-lock-rail{position:absolute;left:7.3%;width:85.3%;top:84.9%;height:0;border-top:1px solid var(--ink)}
.is-night .ink-lock-blind,.is-night .ink-lock-rail,.ink-lock.done .ink-lock-blind,.ink-lock.done .ink-lock-rail,.ink-lock.still .ink-lock-blind,.ink-lock.still .ink-lock-rail{display:none}
/* 夜里屋里的光从窗台那支蜡烛那儿铺开：径向遮罩把整幅图慢慢揭开 */
.is-night .ink-lock-scene{-webkit-mask-image:radial-gradient(circle at 24% 84%,#000 calc(var(--ink-lamp) - 18%),transparent var(--ink-lamp));
  mask-image:radial-gradient(circle at 24% 84%,#000 calc(var(--ink-lamp) - 18%),transparent var(--ink-lamp));--ink-lamp:0%}
.is-night.play .ink-lock-scene{animation:ink-lock-lamp 1.8s ${INK_MOTION.lamp} .2s both}
.is-night.still .ink-lock-scene{-webkit-mask-image:none;mask-image:none}
.ink-lock.play .ink-lock-art{animation:ink-lock-settle .7s ${INK_MOTION.easeOut} both}
.ink-lock.play .ink-lock-blind{animation:ink-lock-lift 1.3s ${INK_MOTION.pull} .3s both}
.ink-lock.play .ink-lock-rail{animation:ink-lock-rail 1.3s ${INK_MOTION.pull} .3s both}
.ink-lock.still .ink-lock-art{opacity:1}
.ink-lock-lab{font-family:${INK_FONT.type};font-size:12px;letter-spacing:.32em;padding-left:.32em;color:var(--ink);margin-top:26px}
/* 时间是主角，系统名和日期是上下两行小字 */
.ink-lock-clock{font-family:${INK_FONT.type};font-size:34px;line-height:1;letter-spacing:.06em;padding-left:.06em;color:var(--text);margin-top:12px}
.ink-lock-date,.ink-lock-unread{font-family:${INK_FONT.type},${INK_FONT.serif};font-size:12px;letter-spacing:.2em;padding-left:.2em;color:var(--ink);margin-top:12px}
.ink-lock-date{opacity:.75}
.ink-lock-unread{margin-top:20px;max-width:86cqw;white-space:nowrap;overflow:hidden}
/* 打字机：脚本一格一格把字点亮，光标只有一块、挂在刚敲完的字后面跟着走。
   不用每字一个 CSS 动画收尾——iPhone Safari 会停在亮的那一帧，留下一排方块 */
.ink-lock-tx span{display:inline-block;white-space:pre;position:relative;opacity:0}
.ink-lock-tx span.on{opacity:1}
/* 光标用 <i>，不是 span，免得被上面「字先藏起来」那条一起藏掉 */
.ink-lock-caret{position:absolute;left:100%;top:.05em;width:.55em;height:1em;background:var(--ink)}
.ink-lock-caret.off{visibility:hidden}
@keyframes ink-lock-settle{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}
@keyframes ink-lock-lift{from{clip-path:inset(0 0 0% 0)}to{clip-path:inset(0 0 100% 0)}}
@keyframes ink-lock-rail{from{top:84.9%}to{top:18.9%;opacity:0}}
@keyframes ink-lock-lamp{from{--ink-lamp:0%}to{--ink-lamp:150%}}
`;

interface InkWindowLockProps {
  unreadCount: number;
  unreadName?: string | null;
  onUnlock: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 跟设备时间走的钟：对齐到整分钟换一次，回到前台立刻对一下 */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    timer = setTimeout(tick, 60_000 - (new Date().getSeconds() * 1000 + new Date().getMilliseconds()) + 50);
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(new Date()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return now;
}

const InkWindowLock: React.FC<InkWindowLockProps> = ({ unreadCount, unreadName, onUnlock }) => {
  const now = useMinuteClock();
  const hour = hourOf(now);
  const night = isInkNight(hour);
  const [still] = useState(prefersReducedMotion);
  const [stage, setStage] = useState<'wait' | 'play' | 'done'>(still ? 'done' : 'wait');
  const [typed, setTyped] = useState(still ? Number.POSITIVE_INFINITY : 0);
  const [caret, setCaret] = useState<{ at: number; off: boolean } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);
  const loadedRef = useRef(0);
  const [imagesReady, setImagesReady] = useState(false);

  const lines = useMemo(() => {
    const out = [
      { cls: 'ink-lock-lab', text: 'LILIUM' },
      { cls: 'ink-lock-clock', text: `${pad(now.getHours())}:${pad(now.getMinutes())}` },
      { cls: 'ink-lock-date', text: `${pad(now.getMonth() + 1)} · ${pad(now.getDate())}  ${WEEKDAYS[now.getDay()]}` },
    ];
    if (unreadCount > 0) {
      out.push({ cls: 'ink-lock-unread', text: `${unreadName ? `${unreadName} · ` : ''}${unreadCount} 条新消息` });
    }
    return out;
  }, [now, unreadCount, unreadName]);
  const totalChars = lines.reduce((n, l) => n + [...l.text].length, 0);
  const totalRef = useRef(totalChars);
  totalRef.current = totalChars;

  // 两张图都到了再开演（最多等 1.5 秒），不然百叶拉起来后面是空的
  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => setImagesReady(true), IMAGE_WAIT_MS);
    return () => clearTimeout(t);
  }, [still]);
  const onImageLoad = () => {
    loadedRef.current += 1;
    if (loadedRef.current >= 2) setImagesReady(true);
  };

  // 时间线：图层 0.7s 落定、白天 0.3s 起拉百叶 / 夜里 0.2s 起亮灯；字 1.15s 起每 65ms 敲一个，敲完光标闪两下收掉
  useEffect(() => {
    if (still || !imagesReady) return;
    setStage('play');
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    const count = totalRef.current;
    for (let i = 0; i < count; i++) {
      later(() => { setTyped(i + 1); setCaret({ at: i, off: false }); }, TYPE_START_MS + i * TYPE_STEP_MS);
    }
    const end = TYPE_START_MS + count * TYPE_STEP_MS;
    [0, 200, 400, 600].forEach((d, k) => later(() => setCaret((c) => (c ? { ...c, off: k % 2 === 0 } : c)), end + d));
    later(() => { setCaret(null); setTyped(Number.POSITIVE_INFINITY); }, end + 800);
    later(() => setStage('done'), Math.max(DONE_MS, end + 800));
    return () => timers.forEach(clearTimeout);
  }, [still, imagesReady]);

  useEffect(() => {
    const el = artRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 天每分钟跟着时间重画一次；种子固定，笔触不会闪
  useEffect(() => {
    const cv = skyRef.current;
    if (!cv || !size) return;
    const c = cv.getContext('2d');
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintInkSky(c, size.w, size.h, { horizon: HORIZON, hour, night, nowMs: now.getTime() });
  }, [size, hour, night, now]);

  let index = 0;
  const classes = ['ink-lock', night ? 'is-night' : '', stage !== 'wait' ? 'play' : '', stage === 'done' ? 'done' : '', still ? 'still' : '']
    .filter(Boolean).join(' ');
  const timeLabel = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      aria-label={`锁屏 ${timeLabel}${unreadCount > 0 ? `，${unreadCount} 条新消息` : ''}，点一下解锁`}
      onClick={onUnlock}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onUnlock(); } }}
      style={{ ['--pitch' as string]: `${((size?.h ?? 0) * 0.034).toFixed(2)}px` } as React.CSSProperties}
    >
      <style>{CSS}</style>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="ink-lock-day-ink" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope={INK_DAY_FILTER.contrastSlope} intercept={INK_DAY_FILTER.contrastIntercept} />
            <feFuncG type="linear" slope={INK_DAY_FILTER.contrastSlope} intercept={INK_DAY_FILTER.contrastIntercept} />
            <feFuncB type="linear" slope={INK_DAY_FILTER.contrastSlope} intercept={INK_DAY_FILTER.contrastIntercept} />
          </feComponentTransfer>
          <feComponentTransfer>
            <feFuncR type="table" tableValues={INK_DAY_FILTER.r} />
            <feFuncG type="table" tableValues={INK_DAY_FILTER.g} />
            <feFuncB type="table" tableValues={INK_DAY_FILTER.b} />
          </feComponentTransfer>
        </filter>
      </svg>

      <div className="ink-lock-art" ref={artRef} aria-hidden="true">
        <div className="ink-lock-scene">
          <div className="ink-lock-out">
            <canvas ref={skyRef} />
            {/* 昼夜换图时换一个新元素：沿用旧元素的话，新图解码前旧图会先套上另一套滤镜闪一下 */}
            <img key={night ? 'n' : 'd'} src={night ? gardenNight : gardenDay} alt="" width={ART_W} height={ART_H} onLoad={onImageLoad} draggable={false} />
          </div>
          <img key={night ? 'n' : 'd'} className="ink-lock-win" src={night ? windowNight : windowDay} alt="" width={ART_W} height={ART_H} onLoad={onImageLoad} draggable={false} />
        </div>
        <div className="ink-lock-blind" />
        <div className="ink-lock-rail" />
      </div>

      {lines.map((line) => (
        <div key={line.cls} className={`${line.cls} ink-lock-tx`} aria-hidden="true">
          {[...line.text].map((ch, i) => {
            const at = index++;
            return (
              <span key={i} className={at < typed ? 'on' : undefined}>
                {ch}
                {caret?.at === at && <i className={`ink-lock-caret${caret.off ? ' off' : ''}`} />}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default InkWindowLock;
