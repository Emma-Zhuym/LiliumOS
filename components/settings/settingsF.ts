// [EM-START: settings-skin-f]
/**
 * 设置页子页换 F 皮（2026-10-22）：上游 Settings.tsx 里几百处 Tailwind 颜色 / 圆角 / 阴影类不逐行改，
 * 在设置根节点挂 `settings-f` + 这组 CSS 变量，由 settingsF.css 统一映射成 F 的取值。
 * 跟小厨房 KITCHEN_PAPER_VARS 一个做法：取值只从 clayTokens 来，CSS 里只引用变量、不写 hex。
 *
 * 色彩预算：设置认领 HUE.blue（与 SettingsHome 一致）；上游各色装饰（violet / sky / indigo / pink / teal…）
 * 一律收成这一个主色；绿 / 琥珀 / 红按状态色走（成功 / 提醒 / 危险）。
 */

import type { CSSProperties } from 'react';
import { F, FONT, HUE, R, STATUS } from '../../utils/clayTokens';
import './settingsF.css';

export const SETTINGS_F_CLASS = 'settings-f';

export const SETTINGS_F_VARS = {
    '--sf-bg': F.appBg,
    '--sf-surface': F.surface,
    '--sf-sunken': F.surfaceSunken,
    '--sf-text': F.textPrimary,
    '--sf-text2': F.textSecondary,
    '--sf-text3': F.textTertiary,
    '--sf-border': F.borderSoft,
    '--sf-border-strong': F.borderStrong,
    '--sf-accent': F.accent,
    '--sf-p-tint': HUE.blue.tint,
    '--sf-p-soft': HUE.blue.soft,
    '--sf-p-main': HUE.blue.main,
    '--sf-p-ink': HUE.blue.ink,
    '--sf-ok-tint': STATUS.success.tint,
    '--sf-ok': STATUS.success.main,
    '--sf-ok-ink': STATUS.success.ink,
    '--sf-ok-soft': HUE.green.soft,
    '--sf-warn-tint': STATUS.warning.tint,
    '--sf-warn-soft': HUE.amber.soft,
    '--sf-warn-ink': STATUS.warning.ink,
    '--sf-danger-tint': STATUS.danger.tint,
    '--sf-danger-soft': HUE.red.soft,
    '--sf-danger': STATUS.danger.main,
    '--sf-danger-ink': STATUS.danger.ink,
    '--sf-r-small': `${R.small}px`,
    '--sf-r-input': `${R.input}px`,
    '--sf-r-card': `${R.bigCard}px`,
    '--sf-r-sheet': `${R.sheet}px`,
    '--sf-heading': FONT.heading,
    '--sf-body': FONT.body,
} as CSSProperties;
// [EM-END: settings-skin-f]
