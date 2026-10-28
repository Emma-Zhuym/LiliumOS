/**
 * 墨线窗锁屏（EM 独有，外观 → 锁屏壁纸里的开关打开时才用，theme.lockStyle === 'inkWindow'）。
 *
 * 「四季的光」：同一个后院、同一扇窗过一年，按月份换六季（utils/inkSeasons.ts）。三层叠起来：
 *   天 = canvas 按设备时间画的淡彩（utils/inkSky.ts + inkSkyPaint.ts）
 *   景 = 后院线稿（白天灰靛 / 夜里黑底金线），草地上一件当季的大东西
 *   窗 = 百叶、窗台上一件当季的小东西；春 / 初夏 / 秋窗推开着，初冬结霜
 * 景只从那扇窗的玻璃和推开的空当里露出来（每季一张玻璃遮罩）。
 * 白天百叶从窗上拉起来；夜里屋里的光从窗台那儿亮开。字用打字机敲出 LILIUM / 时间 / 日期（/ 未读）。
 * 参考实现 docs/design/ink-splash-winter.html，取值全部来自 utils/inkTokens.ts。
 *
 * 钟跟设备时间（锁屏属于「用户自己的时间」，见 docs/character-timezone.md）。点一下就解锁，不用等动画。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { INK, INK_DAY_FILTER, INK_FONT, INK_GRAIN, INK_MOTION, INK_NIGHT, INK_PAPER } from '../../utils/inkTokens';
import { hourOf, isInkNight } from '../../utils/inkSky';
import { paintInkSky } from '../../utils/inkSkyPaint';
import { inkSeasonOf } from '../../utils/inkSeasons';

// 六季的图（1024×1536）和玻璃遮罩：assets/ink/seasons/<季>-{garden,window}-{day,night}.webp、<季>-glass.png
const SEASON_ART = import.meta.glob('../../assets/ink/seasons/*.{webp,png}', { eager: true, import: 'default' }) as Record<string, string>;
const seasonArt = (name: string) => SEASON_ART[`../../assets/ink/seasons/${name}`];

const ART_W = 1024, ART_H = 1536;
const HORIZON = 0.42;

// 字跟百叶 / 灯同时起（0.3s），前三行（LILIUM / 时间 / 日期）在百叶收上去的那一刻（约 1.6s）打完，一个字 25–60ms；
// 未读那行同样的速度接着往下敲，不为它把前面敲快
const TYPE_START_MS = 300;
const TYPE_END_MS = 1600;
const TYPE_STEP_MAX_MS = 60;
const TYPE_STEP_MIN_MS = 25;
const DONE_MS = 2000;
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
  -webkit-mask-image:var(--glass);mask-image:var(--glass);-webkit-mask-size:100% 100%;mask-size:100% 100%;
  -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
.ink-lock-out canvas,.ink-lock-out img,.ink-lock-win{position:absolute;inset:0;width:100%;height:100%;display:block}
/* 白天去色映射成灰靛再正片叠底；景比窗淡（约 0.55），霜和窗外才分得出前后。夜里黑底金线直接滤色 */
.ink-lock-out img{object-fit:cover;filter:url(#ink-lock-day-ink);mix-blend-mode:multiply;opacity:.55;translate:0 var(--garden-dy)}
.ink-lock-win{filter:url(#ink-lock-day-ink);mix-blend-mode:multiply}
.is-night .ink-lock-out img,.is-night .ink-lock-win{filter:none;mix-blend-mode:screen}
.is-night .ink-lock-out img{opacity:.85}
/* 放下的百叶：只在白天，盖住窗格，拉起时从下往上收；纸色不透明才能把图挡住 */
.ink-lock-blind{position:absolute;left:var(--blind-l);width:var(--blind-w);top:var(--blind-t);height:calc(var(--blind-b) - var(--blind-t));background-color:var(--paper);
  background-image:repeating-linear-gradient(to bottom,transparent 0 calc(var(--pitch) - 1px),var(--slat) calc(var(--pitch) - 1px) var(--pitch)),var(--grain);
  clip-path:inset(0 0 0% 0)}
.ink-lock-blind::before,.ink-lock-blind::after{content:"";position:absolute;top:0;bottom:0;width:0.75px;background:var(--slat)}
.ink-lock-blind::before{left:7%}.ink-lock-blind::after{right:7%}
.ink-lock-rail{position:absolute;left:var(--blind-l);width:var(--blind-w);top:var(--blind-b);height:0;border-top:1px solid var(--ink)}
.is-night .ink-lock-blind,.is-night .ink-lock-rail,.ink-lock.done .ink-lock-blind,.ink-lock.done .ink-lock-rail,.ink-lock.still .ink-lock-blind,.ink-lock.still .ink-lock-rail{display:none}
/* 夜里屋里的光从窗台左边那件小东西那儿铺开（六季都摆在那一带）：径向遮罩把整幅图慢慢揭开 */
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
@keyframes ink-lock-rail{from{top:var(--blind-b)}to{top:var(--blind-t);opacity:0}}
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
  const season = inkSeasonOf(now);
  const tod = night ? 'night' : 'day';
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
  const headChars = lines.slice(0, 3).reduce((n, l) => n + [...l.text].length, 0);
  // 未读数常常比锁屏晚到一步：敲字时每一下都读最新的总数，晚到的那行也接着敲出来，不会在最后一下子跳出来
  const totalRef = useRef(totalChars);
  totalRef.current = totalChars;
  const headRef = useRef(headChars);
  headRef.current = headChars;

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

  // 时间线：图层 0.7s 落定、白天 0.3s 起拉百叶 / 夜里 0.2s 起亮灯；字也 0.3s 起敲，跟百叶一起收尾，光标闪一下收掉
  useEffect(() => {
    if (still || !imagesReady) return;
    setStage('play');
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    const startedAt = Date.now();
    const step = Math.max(TYPE_STEP_MIN_MS, Math.min(TYPE_STEP_MAX_MS, (TYPE_END_MS - TYPE_START_MS) / Math.max(headRef.current, 1)));
    let at = 0;
    const finish = () => {
      later(() => setCaret((c) => (c ? { ...c, off: true } : c)), 0);
      later(() => setCaret((c) => (c ? { ...c, off: false } : c)), 150);
      later(() => { setCaret(null); setTyped(Number.POSITIVE_INFINITY); }, 300);
      later(() => setStage('done'), Math.max(300, DONE_MS - (Date.now() - startedAt)));
    };
    const tick = () => {
      if (at >= totalRef.current) { finish(); return; }
      const i = at++;
      setTyped(i + 1);
      setCaret({ at: i, off: false });
      later(tick, step);
    };
    later(tick, TYPE_START_MS);
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
      style={{
        ['--pitch' as string]: `${((size?.h ?? 0) * 0.034).toFixed(2)}px`,
        ['--glass' as string]: `url("${seasonArt(`${season.id}-glass.png`)}")`,
        ['--garden-dy' as string]: `${season.gardenShift}%`,
        ['--blind-l' as string]: `${season.blind.left}%`,
        ['--blind-w' as string]: `${season.blind.width}%`,
        ['--blind-t' as string]: `${season.blind.top}%`,
        ['--blind-b' as string]: `${season.blind.bottom}%`,
      } as React.CSSProperties}
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
            <img key={`${season.id}-${tod}`} src={seasonArt(`${season.id}-garden-${tod}.webp`)} alt="" width={ART_W} height={ART_H} onLoad={onImageLoad} draggable={false} />
          </div>
          <img key={`${season.id}-${tod}`} className="ink-lock-win" src={seasonArt(`${season.id}-window-${tod}.webp`)} alt="" width={ART_W} height={ART_H} onLoad={onImageLoad} draggable={false} />
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
