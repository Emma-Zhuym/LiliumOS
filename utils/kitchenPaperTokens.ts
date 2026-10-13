import type { CSSProperties } from 'react';
import { F, STATUS } from './clayTokens';

/** Emma's approved kitchen-only paper palette. Other apps retain their theme. */
export const KITCHEN_PAPER = {
  bg: '#F5F7F5',
  surface: F.surfaceRaised,
  well: '#EDF1EF',
  ink: '#34413E',
  muted: '#64746E',
  faint: '#778680',
  line: '#DCE4DF',
  blue: '#E2EDF2',
  blueInk: '#426479',
  green: '#E7EFE3',
  greenInk: '#446349',
  danger: STATUS.danger.ink,
  /** 小票核对单上「要看一眼」的行 */
  warn: STATUS.warning.ink,
  warnTint: STATUS.warning.tint,
  heading: '"Noto Serif SC", "Songti SC", "ZCOOL XiaoWei", "STSong", Georgia, serif',
  /** 操作记录小票上的热敏打印字（只用在数字、时间、小票号） */
  mono: 'ui-monospace, "SF Mono", Menlo, "Courier New", monospace',
  paperPhoto: `${import.meta.env.BASE_URL}kitchen/cotton-paper-soft.svg`,
  texture: `${import.meta.env.BASE_URL}kitchen/paper-fibers.svg`,
  radius: { field: 10, button: 10, sheet: 16, card: 12 },
} as const;

/** Apply once on .kitchen-paper; all its surfaces inherit this palette. */
export const KITCHEN_PAPER_VARS = {
  '--k-bg': KITCHEN_PAPER.bg,
  '--k-surface': KITCHEN_PAPER.surface,
  '--k-well': KITCHEN_PAPER.well,
  '--k-ink': KITCHEN_PAPER.ink,
  '--k-muted': KITCHEN_PAPER.muted,
  '--k-faint': KITCHEN_PAPER.faint,
  '--k-line': KITCHEN_PAPER.line,
  '--k-blue': KITCHEN_PAPER.blue,
  '--k-blue-ink': KITCHEN_PAPER.blueInk,
  '--k-green': KITCHEN_PAPER.green,
  '--k-green-ink': KITCHEN_PAPER.greenInk,
  '--k-danger': KITCHEN_PAPER.danger,
  '--k-warn': KITCHEN_PAPER.warn,
  '--k-warn-tint': KITCHEN_PAPER.warnTint,
  '--k-heading': KITCHEN_PAPER.heading,
  '--k-mono': KITCHEN_PAPER.mono,
  '--k-paper-photo': `url("${KITCHEN_PAPER.paperPhoto}")`,
  '--k-texture': `url("${KITCHEN_PAPER.texture}")`,
  '--k-radius-field': `${KITCHEN_PAPER.radius.field}px`,
  '--k-radius-button': `${KITCHEN_PAPER.radius.button}px`,
  '--k-radius-sheet': `${KITCHEN_PAPER.radius.sheet}px`,
  '--k-radius-card': `${KITCHEN_PAPER.radius.card}px`,
} as CSSProperties;
