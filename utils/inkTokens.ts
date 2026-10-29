/**
 * inkTokens.ts — 墨线（阿萌的第二套风格）的取值。墨线页面的颜色、字、线、天色只从这里来。
 *
 * 墨线给「有感情的东西」用（锁屏的窗、以后的情侣空间、信、日记）；F（clayTokens.ts）照旧管工具 App，
 * 两套并存。每个值是怎么定下来的见 design-system/INK_DRAFT.md「已定」，样稿在 docs/design/ink-*.html。
 */

// ── 纸（第一轮）：冷白布纹纸托在一圈灰蓝衬底上，「纸放在纸上」 ──
export const INK_PAPER = {
  paper: '#ECEEEB',
  mount: '#D8DBE2',
} as const;

// ── 墨（第一轮）：线稿 / 编号 / 英文斜体用灰靛，中文正文用近黑的深墨；黄铜只点一下 ──
export const INK = {
  ink:   '#3E4C7A',
  text:  '#23273A',
  brass: '#A8864F',
  /** 百叶、细线框这类「画得轻」的线：灰靛 55% */
  faint: 'rgba(62,76,122,.55)',
} as const;

// ── 夜色（第二轮）：深靛纸托在亮一阶的衬底上，线和编号换金，中文换米白 ──
export const INK_NIGHT = {
  paper: '#1E2436',
  mount: '#2A3249',
  gold:  '#C8A66A',
  text:  '#E4E1D8',
} as const;

// ── 衬底（2026-10-29 阿萌定，锁屏）：方角纸片搁在衬板上，三边 24px、下边 40px，底下一层很淡的影子。
//    纸只盖住外圈，纸上的东西照整屏排（窗不跟着缩）；手机屏圆角会削掉离边 18px 以内的纸角 ──
export const INK_MOUNT = {
  inset: '24px 24px 40px',
  shadowDay: '0 .5px 1px rgba(35,39,58,.14), 0 3px 9px rgba(35,39,58,.09)',
  shadowNight: '0 .5px 1px rgba(8,10,18,.5), 0 4px 12px rgba(8,10,18,.38)',
} as const;

/** 布纹：横向拉长的分形噪声，白天深色纤维、夜里浅色纤维。直接当 background-image 用 */
const grainSvg = (r: string, g: string, b: string, alpha: string) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='c' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9 .25' numOctaves='2' seed='5' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${alpha}'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23c)'/%3E%3C/svg%3E")`;

export const INK_GRAIN = {
  day:   grainSvg('.3', '.33', '.36', '.5 -.17'),
  night: grainSvg('.8', '.8', '.85', '.35 -.14'),
} as const;

// ── 字（第三轮）：标题宋体 600，TA 的话宋体 400 灰靛，标签打字机体字距拉开 ──
export const INK_FONT = {
  serif: '"Noto Serif SC", "Songti SC", serif',
  type:  '"Courier Prime", "Courier New", monospace',
  /** 打字机小标签的字距 */
  labelTracking: '.26em',
} as const;

// ── 线（第四 / 六轮）：细线 0.75px，细线框灰靛约 55%，空位虚线约 50% ──
export const INK_LINE = {
  hair: 0.75,
  frameOpacity: 0.55,
  dashOpacity: 0.5,
} as const;

// ── 动效（第五轮）：只许长出来、散开、落下、沉下去 ──
export const INK_MOTION = {
  easeOut: 'cubic-bezier(.22,.8,.2,1)',
  /** 拉百叶：先慢后快再慢，像手拉绳子 */
  pull: 'cubic-bezier(.55,0,.25,1)',
  /** 光从窗台上的蜡烛那儿铺开 */
  lamp: 'cubic-bezier(.3,.6,.3,1)',
} as const;

/**
 * 白天去色后映射成灰靛（黑 → INK.ink、白 → 白），再正片叠底到布纹纸上。
 * tableValues 的第一个数就是 INK.ink 的 RGB / 255。
 */
export const INK_DAY_FILTER = {
  contrastSlope: 1.3,
  contrastIntercept: -0.22,
  r: '0.243 1',
  g: '0.298 1',
  b: '0.478 1',
} as const;

// ── 天（墨线里唯一允许大面积上色的地方）：淡彩，只从她家里那几样沉下去的色里取 ──
export type Rgb = readonly [number, number, number];
/** [几点, 天顶色, 天顶浓度, 地平线色, 地平线浓度]，中间按时间插值（阿萌 2026-10-27 定的时段） */
export type SkyStop = readonly [number, Rgb, number, Rgb, number];

export const INK_SKY_STOPS: readonly SkyStop[] = [
  [6.0,  [70, 80, 130],   .38, [120, 110, 160], .30], // 天亮前蓝紫
  [6.8,  [110, 105, 155], .32, [190, 140, 165], .42], // 地平线粉紫
  [7.5,  [150, 150, 190], .22, [205, 160, 150], .30], // 桃粉
  [9.0,  [150, 163, 190], .20, [220, 200, 150], .22], // 白天灰蓝，地平线一点淡黄
  [12.0, [158, 168, 190], .18, [226, 208, 160], .24],
  [14.5, [155, 165, 190], .20, [222, 198, 145], .24],
  [16.0, [150, 160, 185], .20, [210, 160, 105], .34], // 下午金
  [17.1, [120, 120, 165], .30, [215, 130, 85],  .48], // 日落橙
  [17.8, [80, 90, 145],   .38, [185, 120, 130], .38], // 余晖玫瑰
  [19.0, [55, 65, 115],   .45, [85, 95, 150],   .38], // 入夜蓝调
];

export const INK_SKY = {
  /** 冬天的太阳 7:10 出、17:10 落 */
  sunrise: 7 + 10 / 60,
  dayLength: 10,
  /** 太阳升高了是淡黄铜、贴地平线偏橙 */
  sunHigh: [214, 184, 122] as Rgb,
  sunLow: [222, 140, 88] as Rgb,
  /** 太阳周围那圈淡黄暖光 */
  sunGlow: [232, 208, 142] as Rgb,
  brass: [168, 134, 79] as Rgb,
  /** 夜里：19 点到 6 点；地平线一层深靛微光，星点和月亮都是金 */
  nightStart: 19,
  nightEnd: 6,
  nightHaze: [52, 62, 100] as Rgb,
  star: [200, 166, 106] as Rgb,
  moon: [206, 174, 112] as Rgb,
  starCount: 70,
} as const;
