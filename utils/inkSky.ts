/**
 * inkSky.ts — 墨线窗外那片天的纯逻辑：几点是什么天色、太阳在哪、月亮走到哪、今天是什么月相。
 * 只算数，不碰 canvas；画在 inkSkyPaint.ts。时间一律是设备时间（锁屏的钟属于「用户自己的时间」，
 * 见 docs/character-timezone.md）。
 */
import { INK_SKY, INK_SKY_STOPS, type Rgb } from './inkTokens';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 0–24 的小数小时，如 7:30 → 7.5 */
export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** 19 点到第二天 6 点算夜里：换黑底金线那一套图 */
export function isInkNight(hour: number): boolean {
  return hour < INK_SKY.nightEnd || hour >= INK_SKY.nightStart;
}

export interface SkyTint {
  top: Rgb;
  topAlpha: number;
  horizon: Rgb;
  horizonAlpha: number;
}

/** 白天的天色：在时段表两个节点之间按时间插值；表外的时间贴着两头 */
export function skyTintAt(hour: number): SkyTint {
  const S = INK_SKY_STOPS;
  let k = 0;
  while (k < S.length - 2 && hour > S[k + 1][0]) k++;
  const A = S[k], B = S[k + 1];
  const f = clamp((hour - A[0]) / (B[0] - A[0]), 0, 1);
  return {
    top: mixRgb(A[1], B[1], f),
    topAlpha: A[2] + (B[2] - A[2]) * f,
    horizon: mixRgb(A[3], B[3], f),
    horizonAlpha: A[4] + (B[4] - A[4]) * f,
  };
}

export interface SunPlace {
  /** 离地平线多高：0 = 贴着地平线，1 = 正午最高；小于 -0.05 就不画了 */
  elevation: number;
  /** 横向位置，占画面宽度的比例 */
  x: number;
  /** 贴地平线偏橙、升高了是淡黄铜 */
  color: Rgb;
}

/** 冬天的太阳走一道低弧：7:10 出、17:10 落 */
export function sunAt(hour: number): SunPlace {
  const t = (hour - INK_SKY.sunrise) / INK_SKY.dayLength;
  const elevation = Math.sin(Math.PI * t);
  return {
    elevation,
    x: 0.18 + 0.64 * clamp(t, 0, 1),
    color: mixRgb(INK_SKY.sunHigh, INK_SKY.sunLow, clamp(1 - elevation * 2.2, 0, 1)),
  };
}

export const SYNODIC_MONTH_DAYS = 29.530588853;
/** 参照新月：2000-01-06 18:14 UTC */
export const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

/** 月相：0 = 新月，0.25 = 上弦，0.5 = 满月，0.75 = 下弦（按平均朔望月算，误差在一天以内） */
export function moonPhase(ms: number): number {
  const days = (ms - REFERENCE_NEW_MOON_MS) / 864e5;
  return ((days / SYNODIC_MONTH_DAYS) % 1 + 1) % 1;
}

export interface MoonShape {
  /** 亮的半边在右（上半月，北半球看）还是在左 */
  litRight: boolean;
  /**
   * 明暗交界那道椭圆的横半径占月亮半径的比例（0–1）。
   * bulge 为 true 时椭圆补在亮的半边外面（凸月），否则从亮的半边里挖掉（娥眉月）
   */
  terminator: number;
  bulge: boolean;
}

export function moonShape(phase: number): MoonShape {
  const k = Math.cos(2 * Math.PI * phase);
  return { litRight: phase < 0.5, terminator: Math.abs(k), bulge: k <= 0 };
}

/** 月亮 19 点到 6 点走一道弧：x 占宽度比例，lift = 离地平线高度占地平线以上高度的比例 */
export function moonArcAt(hour: number): { x: number; lift: number } {
  const span = 24 - INK_SKY.nightStart + INK_SKY.nightEnd;
  const f = clamp((hour >= INK_SKY.nightStart ? hour - INK_SKY.nightStart : hour + 24 - INK_SKY.nightStart) / span, 0, 1);
  return { x: 0.2 + 0.6 * f, lift: Math.sin(Math.PI * f) * 0.5 };
}

/** 固定种子的伪随机：同一张天每次刷出来笔触都一样，不会每分钟闪一下 */
export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
