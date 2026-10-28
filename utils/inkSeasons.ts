/**
 * 墨线窗的六季（EM，[EM: ink-window-lock]）：同一个后院、同一扇窗过一年，两个月换一次。
 * 每季一套图：院子（草地上一件大东西）、窗（窗台上一件小东西，春 / 初夏 / 秋推开着），
 * 加一张玻璃遮罩（院子只从玻璃和推开的空当里露出来，scripts/ink-glass-mask.py 生成）。
 * 图在 assets/ink/seasons/<id>-{garden,window}-{day,night}.webp、<id>-glass.png。
 * 按设备时间的月份选（锁屏是「用户自己的时间」）。
 */
export type InkSeasonId = 'deepwinter' | 'spring' | 'earlysummer' | 'midsummer' | 'autumn' | 'earlywinter';

export interface InkSeasonFrame {
  id: InkSeasonId;
  /** 白天放下来的百叶盖住的范围（占 1024×1536 画面的百分比）：窗外框左右、百叶底到窗台 */
  blind: { left: number; width: number; top: number; bottom: number };
  /** 院子上下挪多少（占画面高的百分比，负数往上）：深冬那扇窗横档低，不挪雪人的脸会被挡住 */
  gardenShift: number;
}

const ART_W = 1024;
const ART_H = 1536;
const pct = (v: number, of: number) => Math.round((v / of) * 10000) / 100;
const frame = (id: InkSeasonId, x0: number, x1: number, y0: number, y1: number, gardenDy = 0): InkSeasonFrame => ({
  id,
  blind: { left: pct(x0, ART_W), width: pct(x1 - x0, ART_W), top: pct(y0, ART_H), bottom: pct(y1, ART_H) },
  gardenShift: pct(gardenDy, ART_H),
});

// 像素按各张窗图量（外框左右各让出 3–4px、百叶底往上 10px 盖严）；初冬沿用原来那组
export const INK_SEASONS: Record<InkSeasonId, InkSeasonFrame> = {
  deepwinter: frame('deepwinter', 66, 946, 293, 1330, -90),
  spring: frame('spring', 78, 946, 284, 1305),
  earlysummer: frame('earlysummer', 78, 945, 283, 1305),
  midsummer: frame('midsummer', 78, 945, 285, 1305),
  autumn: frame('autumn', 78, 945, 283, 1305),
  earlywinter: frame('earlywinter', 75, 948, 290, 1304),
};

const BY_MONTH: InkSeasonId[] = [
  'deepwinter', 'deepwinter', 'spring', 'spring', 'earlysummer', 'earlysummer',
  'midsummer', 'midsummer', 'autumn', 'autumn', 'earlywinter', 'earlywinter',
];

/** 1–2 深冬、3–4 春、5–6 初夏、7–8 盛夏、9–10 秋、11–12 初冬 */
export function inkSeasonOf(date: Date): InkSeasonFrame {
  return INK_SEASONS[BY_MONTH[date.getMonth()]];
}
