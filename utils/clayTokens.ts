/**
 * clayTokens.ts — Emma Soft Clay UI design system tokens for React inline styles.
 * Single source of truth. Values from design-system/tokens.json.
 */

// ── Foundation ──
export const F = {
  appBg:        '#F7F6F2',
  surface:      '#FFFEFC',
  surfaceWarm:  '#FAF6EF',
  surfaceSunken:'#ECE8E1',
  surfaceRaised:'#FFFFFF',
  textPrimary:  '#2E2A28',
  textSecondary:'#6E665F',
  textTertiary: '#9E9891',
  borderSoft:   '#E8E1D8',
  borderStrong: '#D8CFC4',
  divider:      '#EEE8E0',
  accent:       '#C7834B',
} as const;

// ── Shadows (4 levels only) ──
export const S = {
  raisedSoft:   '0 2px 6px rgba(70,66,58,.06), 0 8px 20px rgba(70,66,58,.06)',
  raisedMedium: '0 4px 10px rgba(70,66,58,.08), 0 14px 28px rgba(70,66,58,.08)',
  floating:     '0 8px 18px rgba(70,66,58,.10), 0 20px 40px rgba(70,66,58,.10)',
  sunken:       'inset 2px 2px 5px rgba(70,66,58,.10), inset -2px -2px 5px rgba(255,255,255,.8)',
} as const;

// ── Radius ──
export const R = {
  chartBar: 2, // Compact chart bars: square base, subtly rounded top.
  tiny: 6, small: 10, medium: 14, large: 18,
  panel: 24, sheet: 28, pill: 999,
  button: 14, input: 14, smallCard: 16, bigCard: 20,
} as const;

// ── Spacing ──
export const SP = [4, 8, 12, 16, 20, 24, 32, 48, 64] as const;

// ── Status ──
export const STATUS = {
  success: { tint: '#E6F7E9', main: '#35A853', ink: '#1E6F36' },
  warning: { tint: '#FFF1D0', main: '#D99612', ink: '#7A5200' },
  danger:  { tint: '#FFE6EA', main: '#D94B72', ink: '#8F2443' },
  info:    { tint: '#EAF1FF', main: '#4A88FF', ink: '#2457B8' },
} as const;

// ── Hue palette (tint / soft / main / ink) ──
export const HUE = {
  red:    { tint: '#FFE8E8', soft: '#FFC6C6', main: '#F45B5B', ink: '#A83232' },
  rose:   { tint: '#FFE6EF', soft: '#FFC1D6', main: '#F45D8A', ink: '#A92D56' },
  orange: { tint: '#FFEBDD', soft: '#FFC89F', main: '#F47B3F', ink: '#9B431D' },
  amber:  { tint: '#FFF1D0', soft: '#FFD98A', main: '#F5A914', ink: '#8A5A00' },
  yellow: { tint: '#FFF7CC', soft: '#FFE985', main: '#E8C21A', ink: '#776300' },
  lime:   { tint: '#EEF9D6', soft: '#D4F09A', main: '#8BCF32', ink: '#4F7D18' },
  green:  { tint: '#E6F7E9', soft: '#BCECC6', main: '#35C45A', ink: '#1F7A3A' },
  mint:   { tint: '#E3F7EE', soft: '#B7EBD3', main: '#35B985', ink: '#1E7354' },
  teal:   { tint: '#E2F5F2', soft: '#B3E4DC', main: '#39B4A6', ink: '#1F7068' },
  cyan:   { tint: '#E3F6FA', soft: '#B8E8F2', main: '#36B6D5', ink: '#1D7185' },
  blue:   { tint: '#EAF1FF', soft: '#C9DCFF', main: '#4A88FF', ink: '#2457B8' },
  indigo: { tint: '#ECEEFF', soft: '#CDD3FF', main: '#6377F2', ink: '#3745A5' },
  purple: { tint: '#F0E8FF', soft: '#D7C3FF', main: '#9B6CFF', ink: '#5E3CB8' },
  violet: { tint: '#F5E8FF', soft: '#E6C5FF', main: '#B66BEE', ink: '#743CA0' },
  brown:  { tint: '#F5E9DA', soft: '#E8CBAA', main: '#C98B52', ink: '#7A4D28' },
  gray:   { tint: '#F0EFEC', soft: '#DDD9D3', main: '#8D8780', ink: '#4D4843' },
} as const;

// ── Motion ──
export const MOTION = {
  tap: '100ms', hover: '140ms', card: '180ms', sheet: '240ms', page: '280ms',
  ease: 'cubic-bezier(.2,.8,.2,1)',
} as const;

// ── Helpers ──
export const pressStyle = { transform: 'translateY(1px)', boxShadow: '0 1px 3px rgba(70,66,58,.12)' };
