/**
 * inkSkyPaint.ts — 把 inkSky.ts 算出来的天画到 canvas 上（参考实现 docs/design/ink-splash-winter.html）。
 * 白天是横着一笔笔刷的淡彩 + 太阳和它周围的淡黄暖光；夜里是地平线一层深靛微光、金色星点和照真实月相的月亮。
 */
import { INK_SKY, type Rgb } from './inkTokens';
import { mixRgb, moonArcAt, moonPhase, moonShape, seededRandom, skyTintAt, sunAt } from './inkSky';

const rgba = (c: Rgb, a: number) => `rgba(${c.map(Math.round).join(',')},${a.toFixed(3)})`;

/** 横着一笔笔刷的水彩：每行若干段，浓淡随机一点；过了地平线再往下淡出一段，不切一刀 */
function brush(
  c: CanvasRenderingContext2D, W: number, H: number, hy: number, rand: () => number,
  colorAt: (t: number) => [Rgb, number],
) {
  const end = hy + H * 0.16;
  for (let y = 0; y < end; y += 2) {
    const t = Math.min(1, y / hy);
    const fade = y < hy ? 1 : 1 - (y - hy) / (end - hy);
    const [col, a] = colorAt(t);
    for (let x = 0; x < W;) {
      const len = 30 + rand() * 120;
      c.fillStyle = rgba(col, a * fade * (0.8 + rand() * 0.4));
      c.fillRect(x, y, len + 1, 2.2);
      x += len;
    }
  }
}

function paintDay(c: CanvasRenderingContext2D, W: number, H: number, hy: number, hour: number, rand: () => number) {
  const sky = skyTintAt(hour);
  brush(c, W, H, hy, rand, (t) => {
    const u = Math.pow(t, 1.4);
    return [mixRgb(sky.top, sky.horizon, u), sky.topAlpha + (sky.horizonAlpha - sky.topAlpha) * u];
  });
  const sun = sunAt(hour);
  if (sun.elevation <= -0.05) return;
  const sx = W * sun.x, sy = hy - sun.elevation * hy * 0.45, R = W * 0.022;
  // 太阳升高以后天会显得惨白，所以给太阳周围刷一圈淡黄暖光，离太阳越远越淡
  if (sun.elevation > 0.12) {
    const Rh = W * 0.38;
    const strength = Math.min(1, (sun.elevation - 0.12) * 2.5) * 0.45;
    for (let y = Math.max(0, sy - Rh); y < Math.min(hy + H * 0.08, sy + Rh); y += 2) {
      const dy = y - sy, hw = Math.sqrt(Rh * Rh - dy * dy);
      for (let x = sx - hw; x < sx + hw;) {
        const len = 20 + rand() * 60;
        const d = Math.hypot(x + len / 2 - sx, dy) / Rh;
        if (d < 1) {
          c.fillStyle = rgba(INK_SKY.sunGlow, strength * (1 - d) * (1 - d) * (0.8 + rand() * 0.4));
          c.fillRect(x, y, len + 1, 2.2);
        }
        x += len;
      }
    }
  }
  c.save();
  c.beginPath(); c.rect(0, 0, W, hy); c.clip();
  c.fillStyle = rgba(sun.color, 0.62);
  c.beginPath(); c.arc(sx, sy, R, 0, Math.PI * 2); c.fill();
  c.strokeStyle = rgba(INK_SKY.brass, 1);
  c.lineWidth = 0.8;
  c.stroke();
  c.restore();
}

function paintNight(c: CanvasRenderingContext2D, W: number, H: number, hy: number, hour: number, nowMs: number, rand: () => number) {
  brush(c, W, H, hy, rand, (t) => [INK_SKY.nightHaze, 0.04 + 0.3 * t * t]);
  c.save();
  c.beginPath(); c.rect(0, 0, W, hy); c.clip();
  for (let i = 0; i < INK_SKY.starCount; i++) {
    const x = rand() * W, y = Math.pow(rand(), 1.3) * hy * 0.92;
    c.fillStyle = rgba(INK_SKY.star, 0.25 + rand() * 0.55);
    c.beginPath(); c.arc(x, y, 0.4 + rand() * 0.5, 0, Math.PI * 2); c.fill();
  }
  const arc = moonArcAt(hour);
  const mx = W * arc.x, my = hy - arc.lift * hy, R = W * 0.024;
  const shape = moonShape(moonPhase(nowMs));
  // 小画布上先画亮的半边，再用椭圆补成凸月或挖成娥眉月，贴回夜空
  const m = document.createElement('canvas');
  const Z = Math.ceil(R * 2 + 4), o = Z / 2;
  m.width = m.height = Z;
  const mc = m.getContext('2d');
  if (mc) {
    mc.fillStyle = rgba(INK_SKY.moon, 1);
    mc.beginPath();
    mc.arc(o, o, R, shape.litRight ? -Math.PI / 2 : Math.PI / 2, shape.litRight ? Math.PI / 2 : Math.PI * 1.5);
    mc.fill();
    mc.globalCompositeOperation = shape.bulge ? 'source-over' : 'destination-out';
    mc.beginPath(); mc.ellipse(o, o, shape.terminator * R, R, 0, 0, Math.PI * 2); mc.fill();
  }
  // 背后留一圈很淡的整月轮廓
  c.strokeStyle = rgba(INK_SKY.star, 0.22);
  c.lineWidth = 0.6;
  c.beginPath(); c.arc(mx, my, R, 0, Math.PI * 2); c.stroke();
  c.globalAlpha = 0.92;
  c.drawImage(m, mx - o, my - o);
  c.globalAlpha = 1;
  c.restore();
}

/**
 * 画一整片天。W / H 是 CSS 像素，canvas 已按 dpr 缩放好；horizon 是地平线占高度的比例。
 * 种子固定，同一时刻每次画出来一样。
 */
export function paintInkSky(
  c: CanvasRenderingContext2D, W: number, H: number,
  opts: { horizon: number; hour: number; night: boolean; nowMs: number },
) {
  c.clearRect(0, 0, W, H);
  const rand = seededRandom(7);
  const hy = H * opts.horizon;
  if (opts.night) paintNight(c, W, H, hy, opts.hour, opts.nowMs, rand);
  else paintDay(c, W, H, hy, opts.hour, rand);
}
