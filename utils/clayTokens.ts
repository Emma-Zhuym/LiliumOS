/**
 * clayTokens.ts — Emma Soft Clay UI design system tokens for React inline styles.
 * Single source of truth. Values mirrored in design-system/tokens.json.
 *
 * v1.0（2026-09 换皮「F」）：全平——投影和凹陷阴影都没有了，分层靠细线和明度差；
 * 圆角收紧到 12；底色去黄转中性；16 色按 OKLCH 公式重算；标题用衬线。
 * 浮在内容上面的东西（sheet、提示条）用 OVERLAY 的雾面材质。
 */

import './clayMotion.css';

// ── Foundation ──
export const F = {
  appBg:        '#F8F9F7',
  surface:      '#FFFFFF',
  surfaceWarm:  '#F2F4F0',
  surfaceSunken:'#EDEFEA',
  surfaceRaised:'#FFFFFF',
  textPrimary:  '#23262A',
  textSecondary:'#5D635F',
  textTertiary: '#959B96',
  borderSoft:   '#E3E6E0',
  borderStrong: '#CBCFC8',
  divider:      '#EBEEE8',
  accent:       '#B4402F',
} as const;

// ── Shadows ──
// 全平：四档都保留名字（旧代码照常引用），值一律为 none。
// 层次改由 1px borderSoft、surface 与 appBg 的明度差、以及浮层的动效来表达。
export const S = {
  raisedSoft:   'none',
  raisedMedium: 'none',
  floating:     'none',
  sunken:       'none',
} as const;

// ── Radius ──
export const R = {
  chartBar: 2, // Compact chart bars: square base, subtly rounded top.
  tiny: 4, small: 8, medium: 10, large: 12,
  panel: 14, sheet: 16, pill: 999,
  button: 10, input: 10, smallCard: 10, bigCard: 12,
} as const;

// ── Spacing ──
export const SP = [4, 8, 12, 16, 20, 24, 32, 48, 64] as const;

// ── Typography ──
// 衬线只给标题：App 顶栏标题、sheet 标题、section 小标题。数字、正文、标签一律无衬线。
export const FONT = {
  heading: '"Noto Serif SC", "Songti SC", serif',
  body:    '"Noto Sans SC", -apple-system, "PingFang SC", sans-serif',
  navTitle:     { fontSize: 17, fontWeight: 700 },
  sectionTitle: { fontSize: 15.5, fontWeight: 600 },
} as const;

// ── Status ──
export const STATUS = {
  success: { tint: '#E7F3E9', main: '#53A768', ink: '#246135' },
  warning: { tint: '#F7EDE2', main: '#ECA84A', ink: '#7B510D' },
  danger:  { tint: '#FCEBE9', main: '#CA6862', ink: '#7F3B37' },
  info:    { tint: '#E7F0FC', main: '#4982C9', ink: '#2B5386' },
} as const;

// ── Hue palette (tint / soft / main / ink) ──
// OKLCH 公式：tint L .952 / C .019，soft L .885 / C .06，ink L .44–.47 / C .095；
// main 的亮度按色相走——黄橙提亮免得发土，蓝靛压暗免得发飘，饱和度封顶 .135。
// amber / yellow / lime 太亮，白字压不住：只做圆点、图标、圆环，不做实心按钮底。
export const HUE = {
  red:    { tint: '#FCEBE9', soft: '#FFCBC5', main: '#CA6862', ink: '#7F3B37' },
  rose:   { tint: '#FBEAEE', soft: '#FCC9D6', main: '#CC6C89', ink: '#7C3A4E' },
  orange: { tint: '#FAECE4', soft: '#FACFB5', main: '#D87E42', ink: '#844A23' },
  amber:  { tint: '#F7EDE2', soft: '#F2D3AE', main: '#ECA84A', ink: '#7B510D' },
  yellow: { tint: '#F3EFE1', soft: '#E5D9AD', main: '#E6C959', ink: '#6C5904' },
  lime:   { tint: '#ECF2E4', soft: '#D0E1B6', main: '#A4C661', ink: '#4F6422' },
  green:  { tint: '#E7F3E9', soft: '#BEE5C5', main: '#53A768', ink: '#246135' },
  mint:   { tint: '#E4F3ED', soft: '#B3E6D2', main: '#37B78F', ink: '#006249' },
  teal:   { tint: '#E2F4F1', soft: '#ACE7E0', main: '#0CABA2', ink: '#05605A' },
  cyan:   { tint: '#E2F3F7', soft: '#ACE4F2', main: '#06B1CE', ink: '#025D6D' },
  blue:   { tint: '#E7F0FC', soft: '#C1DCFE', main: '#4982C9', ink: '#2B5386' },
  indigo: { tint: '#EBEFFC', soft: '#CED7FE', main: '#6170C0', ink: '#434D87' },
  purple: { tint: '#F0EDFB', soft: '#DDD1FC', main: '#8A6EC1', ink: '#594680' },
  violet: { tint: '#F5EBF7', soft: '#EBCDF2', main: '#AA6FB8', ink: '#694073' },
  brown:  { tint: '#F8EEE7', soft: '#E3CCBB', main: '#9F7655', ink: '#614731' },
  gray:   { tint: '#EEF1EF', soft: '#D1D6D1', main: '#818882', ink: '#434A44' },
} as const;

// ── Overlay（浮在内容上面的 sheet / 提示条，iOS 18 雾面材质） ──
export const OVERLAY = {
  bg:        'rgba(250,251,249,.66)',
  blur:      'blur(26px) saturate(175%)',
  edge:      '1px solid rgba(255,255,255,.78)',
  hairline:  '0 -.5px 0 rgba(35,38,42,.14)',
  grab:      'rgba(35,38,42,.22)',
  well:      'rgba(118,124,140,.12)',   // 浮层里的凹槽底色
  toastBg:   'rgba(232,235,230,.80)',
  toastEdge: '1px solid rgba(35,38,42,.14)',
  scrim:     'transparent',             // 玻璃自己分层；真正要打断用户的确认框才压暗
  scrimModal:'rgba(35,38,42,.22)',
} as const;

// ── Motion ──
export const MOTION = {
  tap: '100ms', hover: '140ms', card: '180ms', sheet: '240ms', page: '280ms',
  ease: 'cubic-bezier(.2,.8,.2,1)',          // 出场：列表升起、圆环画出
  easeSheet: 'cubic-bezier(.32,.72,0,1)',    // 浮层、切换 bar 白块：一下出去，慢慢停，不回弹
  easePop: 'cubic-bezier(.34,1.36,.64,1)',   // 提示条、选中日：全系统只有这两处允许「弹」
  sheetIn: '460ms', toastIn: '560ms', toastOut: '380ms',
} as const;

// ── Helpers ──
// 没有阴影可减了：按压 = 轻微缩小（卡片 .985、按钮 .95），裸 icon 用透明度 .4。
export const pressStyle = { transform: 'scale(.97)' };
export const iconButtonBare = {
  width: 44, height: 44, borderRadius: 999, background: 'transparent', border: 'none', boxShadow: 'none',
} as const;
