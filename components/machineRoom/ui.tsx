// [EM-START: machine-room]
/**
 * 机房 App 的小零件：卡片、分组标题、开关、状态点、行。取值全部来自 clayTokens（F 规范，全平）。
 * 主色 mint（P），状态点用 STATUS；一屏不另加辅助色。
 */

import React from 'react';
import { CaretRight } from '@phosphor-icons/react';

import { F, FONT, HUE, MOTION, R, STATUS } from '../../utils/clayTokens';

export const P = HUE.mint;

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void; tint?: boolean }> = ({ children, style, onClick, tint }) => {
    const base: React.CSSProperties = {
        background: tint ? P.tint : F.surface,
        border: `1px solid ${tint ? P.soft : F.borderSoft}`,
        borderRadius: R.bigCard,
        padding: '14px 16px',
        ...style,
    };
    return onClick
        ? <button type="button" onClick={onClick} className="w-full text-left clay-press" style={base}>{children}</button>
        : <div style={base}>{children}</div>;
};

export const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
    <div className="flex items-center justify-between px-1 pt-1.5">
        <span style={{ ...FONT.sectionTitle, fontFamily: FONT.heading, color: F.textPrimary }}>{children}</span>
        {right && <span style={{ fontSize: 12, color: F.textTertiary }}>{right}</span>}
    </div>
);

export type Tone = 'ok' | 'warn' | 'off' | 'danger';
const TONE_COLOR: Record<Tone, string> = {
    ok: STATUS.success.main, warn: STATUS.warning.main, off: F.borderStrong, danger: STATUS.danger.main,
};
export const Dot: React.FC<{ tone: Tone }> = ({ tone }) => (
    <span className="shrink-0" style={{ width: 8, height: 8, borderRadius: R.pill, background: TONE_COLOR[tone] }} />
);

/** 状态小徽章：Tint 底 + Ink 字（APP_CONVENTIONS E）。 */
export const Badge: React.FC<{ tone?: 'ok' | 'warn' | 'danger' | 'info' | 'plain'; children: React.ReactNode }> = ({ tone = 'plain', children }) => {
    const pair = tone === 'plain' ? { tint: F.surfaceSunken, ink: F.textSecondary }
        : tone === 'ok' ? STATUS.success : tone === 'warn' ? STATUS.warning : tone === 'danger' ? STATUS.danger : STATUS.info;
    return <span className="shrink-0 whitespace-nowrap" style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: R.pill, background: pair.tint, color: pair.ink }}>{children}</span>;
};

export const Toggle: React.FC<{ checked: boolean; onChange: () => void; label: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
        className="relative shrink-0 disabled:opacity-50"
        style={{ width: 48, height: 28, borderRadius: R.pill, background: checked ? P.main : F.borderStrong, transition: `background ${MOTION.hover} ${MOTION.ease}` }}>
        <span className="absolute" style={{
            top: 3, left: checked ? 23 : 3, width: 22, height: 22, borderRadius: R.pill, background: F.surface,
            transition: `left ${MOTION.card} ${MOTION.ease}`,
        }} />
    </button>
);

/** 一行：左边标题（可带小字），右边任意东西；能点就带个箭头。 */
export const Row: React.FC<{ title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; onClick?: () => void; first?: boolean }> = ({ title, sub, right, onClick, first }) => {
    const body = (
        <>
            <div className="flex-1 min-w-0">
                <div className="truncate" style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{title}</div>
                {sub && <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
            </div>
            {right}
            {onClick && <CaretRight size={16} weight="bold" color={F.textTertiary} className="shrink-0" />}
        </>
    );
    const style: React.CSSProperties = { gap: 12, padding: '12px 0', borderTop: first ? 'none' : `1px solid ${F.divider}`, width: '100%', textAlign: 'left' };
    return onClick
        ? <button type="button" onClick={onClick} className="flex items-center active:opacity-60 transition-opacity" style={style}>{body}</button>
        : <div className="flex items-center" style={style}>{body}</div>;
};

/** 凹槽空状态（APP_CONVENTIONS E）。 */
export const Empty: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
    <div className="flex flex-col items-center text-center" style={{ gap: 8, background: F.surfaceSunken, borderRadius: R.bigCard, padding: '20px 16px' }}>
        {icon}
        <p style={{ fontSize: 13, color: F.textTertiary, lineHeight: 1.6 }}>{children}</p>
    </div>
);

export const PillButton: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean; strong?: boolean }> = ({ onClick, children, disabled, strong }) => (
    <button type="button" onClick={onClick} disabled={disabled}
        className="shrink-0 active:translate-y-[1px] transition-transform disabled:opacity-50"
        style={{ padding: '8px 14px', borderRadius: R.pill, background: strong ? P.main : P.tint, color: strong ? F.surface : P.ink, fontSize: 13, fontWeight: 600 }}>
        {children}
    </button>
);

export const selectStyle: React.CSSProperties = {
    background: F.surfaceSunken, border: `1px solid ${F.borderSoft}`, borderRadius: R.input, padding: '6px 10px',
    fontSize: 13, color: F.textPrimary, outline: 'none', maxWidth: '100%',
};
// [EM-END: machine-room]
