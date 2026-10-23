// [EM-START: settings-subpages-f]
/**
 * 设置子页的零件（2026-10-22 阿萌看过样稿 docs/design/settings-subpages-mock.html 定）。
 *
 * 上游那种「一个功能一个大彩色方块」全换成跟首页一样的分组列表，所有子页都用这几样拼：
 * - Group：组标题 + 白卡（行之间自动画分隔线）+ 组下灰色说明
 * - Row：一行；tone = link 是一次性动作（蓝字），danger 是会删东西的（红字）
 * - ToggleRow：开关行，开了相关的选项在同一组里才冒出来（由调用方条件渲染）
 * - FieldRow：小标签在上、平底输入框在下；Token 一律 password
 * - Segmented：二选一，灰底白块滑过去（APP_CONVENTIONS B）
 * - Chips：多选小圆片，选中实心主色
 * - Stepper：− 数值 +
 * - Hero：顶上那张淡蓝状态卡，底色恒定，右下文字按钮
 *
 * 颜色只有设置的主色 HUE.blue，绿点 / 红字只表示状态。
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, CaretRight } from '@phosphor-icons/react';
import { F, MOTION, R, STATUS } from '../../utils/clayTokens';
import { SETTINGS_HUE as P, StatusDot } from './SettingsHome';

const INSET = 14;

/** 把 Fragment 摊平、去掉 false / null，方便「开了才冒出来」的行跟着画分隔线。 */
const flatten = (children: React.ReactNode): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    React.Children.forEach(children, child => {
        if (child === null || child === undefined || child === false || child === true || child === '') return;
        if (React.isValidElement(child) && child.type === React.Fragment) {
            out.push(...flatten((child.props as { children?: React.ReactNode }).children));
            return;
        }
        out.push(child);
    });
    return out;
};

export const Group: React.FC<{
    title?: React.ReactNode;
    foot?: React.ReactNode;
    footTone?: 'plain' | 'danger';
    children?: React.ReactNode;
    testId?: string;
}> = ({ title, foot, footTone = 'plain', children, testId }) => {
    const rows = flatten(children);
    return (
        <section className="flex flex-col" style={{ gap: 6 }} data-testid={testId}>
            {title && <h3 className="px-1" style={{ margin: 0, fontFamily: 'inherit', fontSize: 12, fontWeight: 400, color: F.textTertiary, letterSpacing: '.04em' }}>{title}</h3>}
            {rows.length > 0 && (
                <div className="overflow-hidden" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard }}>
                    {rows.map((row, i) => (
                        <div key={React.isValidElement(row) && row.key != null ? row.key : i} className="relative">
                            {i > 0 && <span aria-hidden className="absolute top-0 right-0" style={{ left: INSET, height: 1, background: F.divider }} />}
                            {row}
                        </div>
                    ))}
                </div>
            )}
            {foot && <div className="px-1" style={{ fontSize: 12, lineHeight: '18px', color: footTone === 'danger' ? STATUS.danger.ink : F.textTertiary }}>{foot}</div>}
        </section>
    );
};

const rowBox: React.CSSProperties = { minHeight: 52, padding: `8px ${INSET}px`, gap: 12, width: '100%', background: 'transparent', border: 'none', textAlign: 'left' };

const Label: React.FC<{ title: React.ReactNode; sub?: React.ReactNode; color?: string; weight?: number }> = ({ title, sub, color, weight }) => (
    <span className="flex-1 min-w-0" style={{ fontSize: 15, lineHeight: '21px', color: color || F.textPrimary, fontWeight: weight }}>
        {title}
        {sub && <span className="block" style={{ fontSize: 12, lineHeight: '17px', color: F.textTertiary, marginTop: 1, fontWeight: 400 }}>{sub}</span>}
    </span>
);

/** 一行。给 onClick 就能点（tone 决定字色，plain 带 ›）；给 href 是外链。 */
export const Row: React.FC<{
    title: React.ReactNode;
    sub?: React.ReactNode;
    value?: React.ReactNode;
    dot?: 'ok' | 'bad' | null;
    valueTone?: 'plain' | 'bad' | 'ok';
    tone?: 'plain' | 'link' | 'danger';
    right?: React.ReactNode;
    chevron?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    href?: string;
}> = ({ title, sub, value, dot, valueTone = 'plain', tone = 'plain', right, chevron, disabled, onClick, href }) => {
    const color = tone === 'link' ? P.main : tone === 'danger' ? STATUS.danger.ink : undefined;
    const weight = tone === 'plain' ? undefined : 500;
    const showChevron = chevron ?? (tone === 'plain' && !!onClick);
    const body = (
        <>
            <Label title={title} sub={sub} color={disabled ? F.textTertiary : color} weight={weight} />
            {(value || dot) && (
                <span className="shrink-0 inline-flex items-center" style={{
                    gap: 6, maxWidth: '55%', fontSize: 14, fontVariantNumeric: 'tabular-nums',
                    color: valueTone === 'bad' ? STATUS.danger.ink : valueTone === 'ok' ? STATUS.success.ink : F.textTertiary,
                }}>
                    {dot && <StatusDot tone={dot} />}
                    <span className="truncate">{value}</span>
                </span>
            )}
            {right}
            {href && <ArrowSquareOut size={15} weight="bold" color={P.main} className="shrink-0" />}
            {showChevron && <CaretRight size={14} weight="bold" color={F.borderStrong} className="shrink-0" />}
        </>
    );
    if (href) {
        return <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center active:opacity-60 transition-opacity" style={{ ...rowBox, textDecoration: 'none' }}>{body}</a>;
    }
    if (onClick) {
        return <button type="button" onClick={onClick} disabled={disabled} className="flex items-center active:opacity-60 transition-opacity disabled:cursor-not-allowed" style={rowBox}>{body}</button>;
    }
    return <div className="flex items-center" style={rowBox}>{body}</div>;
};

export const Toggle: React.FC<{ checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
        className="relative shrink-0 disabled:opacity-50"
        style={{ width: 48, height: 28, borderRadius: R.pill, border: 'none', padding: 0, background: checked ? P.main : F.borderStrong, transition: `background ${MOTION.hover} ${MOTION.ease}` }}>
        <span className="absolute" style={{
            top: 3, left: checked ? 23 : 3, width: 22, height: 22, borderRadius: R.pill, background: F.surface,
            transition: `left ${MOTION.card} ${MOTION.ease}`,
        }} />
    </button>
);

export const ToggleRow: React.FC<{
    title: React.ReactNode;
    sub?: React.ReactNode;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    label?: string;
}> = ({ title, sub, checked, onChange, disabled, label }) => (
    <div className="flex items-center" style={rowBox}>
        <Label title={title} sub={sub} />
        <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label || (typeof title === 'string' ? title : '开关')} />
    </div>
);

const inputStyle: React.CSSProperties = {
    width: '100%', minWidth: 0, height: 40, padding: '0 12px', borderRadius: R.input, border: '1px solid transparent',
    background: F.surfaceSunken, color: F.textPrimary, fontSize: 15, outline: 'none',
};

/**
 * 填写行。输入时只改草稿，离开输入框（或这一页被关掉）时才 onCommit 一次——
 * 不然每敲一个字都要存一遍、往云端推一遍。
 */
export const FieldRow: React.FC<{
    label: React.ReactNode;
    value: string;
    onCommit: (value: string) => void;
    placeholder?: string;
    secret?: boolean;
    mono?: boolean;
    multiline?: boolean;
    inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
    trailing?: React.ReactNode;
    onEnter?: (value: string) => void;
    /** 每敲一个字都要知道的（比如搜索框），给这个；它不触发 onCommit。 */
    onDraft?: (value: string) => void;
    /**
     * 停手这么多毫秒后也存一次。旁边有「测试连接」的填写行要给：手机上点按钮不一定先让输入框失焦，
     * 不给的话测的还是旧值。
     */
    autoCommitMs?: number;
    /** 原生 name（密码管理器、测试按它找） */
    name?: string;
    rows?: number;
}> = ({ label, value, onCommit, placeholder, secret, mono, multiline, inputMode, trailing, onEnter, onDraft, autoCommitMs, name, rows }) => {
    const [draft, setDraft] = useState(value);
    const draftRef = useRef(value);
    const committedRef = useRef(value);
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;
    useEffect(() => { setDraft(value); draftRef.current = value; committedRef.current = value; }, [value]);
    const commit = () => {
        if (draftRef.current === committedRef.current) return;
        committedRef.current = draftRef.current;
        commitRef.current(draftRef.current);
    };
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
        if (draftRef.current !== committedRef.current) commitRef.current(draftRef.current);
    }, []);
    const change = (next: string) => {
        setDraft(next); draftRef.current = next; onDraft?.(next);
        if (autoCommitMs) {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => { timer.current = null; commit(); }, autoCommitMs);
        }
    };
    const id = useRef(`sf-field-${Math.random().toString(36).slice(2, 9)}`).current;
    const common = {
        id, name, value: draft, placeholder, onBlur: commit, spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off',
        style: { ...inputStyle, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined, fontSize: mono ? 14 : 15 },
    } as const;
    return (
        <div className="flex flex-col" style={{ gap: 6, padding: `10px ${INSET}px 12px` }}>
            <label htmlFor={id} style={{ fontSize: 12, color: F.textTertiary }}>{label}</label>
            <div className="flex items-center" style={{ gap: 8 }}>
                {multiline ? (
                    <textarea {...common} rows={rows ?? 3} onChange={e => change(e.target.value)}
                        style={{ ...common.style, height: 'auto', minHeight: 72, padding: '10px 12px', resize: 'vertical', lineHeight: '20px' }} />
                ) : (
                    <input {...common} type={secret ? 'password' : 'text'} autoComplete={secret ? 'new-password' : 'off'} inputMode={inputMode}
                        onChange={e => change(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { commit(); onEnter?.(draftRef.current); } }} />
                )}
                {trailing}
            </div>
        </div>
    );
};

/** 输入框右边的小蓝字按钮（搜索、粘贴这类）。 */
export const InlineAction: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ onClick, disabled, children }) => (
    <button type="button" onClick={onClick} disabled={disabled}
        className="shrink-0 flex items-center justify-center active:opacity-40 transition-opacity disabled:opacity-40"
        style={{ height: 40, padding: '0 4px', background: 'transparent', border: 'none', color: P.main, fontSize: 14, fontWeight: 500 }}>
        {children}
    </button>
);

export function Segmented<T extends string>({ options, value, onChange, standalone, label }: {
    options: { value: T; label: React.ReactNode }[];
    value: T;
    onChange: (next: T) => void;
    standalone?: boolean;
    label?: string;
}) {
    const index = Math.max(0, options.findIndex(o => o.value === value));
    return (
        <div role="radiogroup" aria-label={label} className="relative grid" style={{
            gridAutoFlow: 'column', gridAutoColumns: '1fr', background: F.surfaceSunken, borderRadius: R.medium, padding: 2,
            margin: standalone ? 0 : `10px ${INSET}px`,
        }}>
            <span aria-hidden className="absolute" style={{
                top: 2, bottom: 2, left: 2, width: `calc((100% - 4px) / ${options.length})`, borderRadius: R.small, background: F.surface,
                transform: `translateX(${index * 100}%)`, transition: `transform 340ms ${MOTION.easeSheet}`,
            }} />
            {options.map(o => (
                <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
                    className="relative" style={{
                        height: 32, background: 'transparent', border: 'none', fontSize: 14,
                        color: o.value === value ? F.textPrimary : F.textSecondary, fontWeight: o.value === value ? 600 : 400,
                    }}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function Chips<T extends string>({ options, selected, onToggle }: {
    options: { value: T; label: React.ReactNode }[];
    selected: readonly T[];
    onToggle: (value: T) => void;
}) {
    return (
        <div className="flex flex-wrap" style={{ gap: 8, padding: `12px ${INSET}px 14px` }}>
            {options.map(o => {
                const on = selected.includes(o.value);
                return (
                    <button key={o.value} type="button" aria-pressed={on} onClick={() => onToggle(o.value)}
                        className="active:opacity-60 transition-opacity"
                        style={{ fontSize: 13, padding: '6px 12px', borderRadius: R.pill, border: 'none', background: on ? P.main : P.tint, color: on ? F.surface : P.ink }}>
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

export const Stepper: React.FC<{ value: React.ReactNode; onDec: () => void; onInc: () => void; decLabel: string; incLabel: string; decDisabled?: boolean; incDisabled?: boolean }> = ({ value, onDec, onInc, decLabel, incLabel, decDisabled, incDisabled }) => {
    const btn: React.CSSProperties = { width: 32, height: 32, background: 'transparent', border: 'none', fontSize: 18, color: F.textPrimary };
    return (
        <span className="shrink-0 flex items-center" style={{ background: F.surfaceSunken, borderRadius: R.medium }}>
            <button type="button" aria-label={decLabel} onClick={onDec} disabled={decDisabled} className="active:opacity-40 disabled:opacity-30" style={btn}>−</button>
            <span style={{ minWidth: 56, textAlign: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: F.textPrimary }}>{value}</span>
            <button type="button" aria-label={incLabel} onClick={onInc} disabled={incDisabled} className="active:opacity-40 disabled:opacity-30" style={btn}>+</button>
        </span>
    );
};

/** 顶上的状态卡：Product tint 底恒定（连没连上都不换色，APP_CONVENTIONS G0），大字前一颗状态点。 */
export const Hero: React.FC<{ title: React.ReactNode; sub?: React.ReactNode; dot?: 'ok' | 'bad' | null; actions?: React.ReactNode; testId?: string }> = ({ title, sub, dot, actions, testId }) => (
    <div className="flex flex-col" data-testid={testId} style={{ background: P.tint, borderRadius: R.bigCard, padding: 16, gap: 4 }}>
        <div className="flex items-center" style={{ gap: 8, fontSize: 20, lineHeight: '28px', fontWeight: 600, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>
            {dot && <StatusDot tone={dot} />}
            <span className="min-w-0">{title}</span>
        </div>
        {sub && <div style={{ fontSize: 13, lineHeight: '18px', color: F.textSecondary }}>{sub}</div>}
        {actions && <div className="flex justify-end flex-wrap" style={{ gap: 8 }}>{actions}</div>}
    </div>
);

export const HeroAction: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ onClick, disabled, children }) => (
    <button type="button" onClick={onClick} disabled={disabled}
        className="inline-flex items-center active:opacity-40 transition-opacity disabled:opacity-40"
        style={{ minHeight: 44, padding: '0 4px', background: 'transparent', border: 'none', color: P.main, fontSize: 15, fontWeight: 500 }}>
        {children}
    </button>
);

/** 测试结果那一小行：成功绿字、失败红字、进行中灰字。 */
export type TestResult = { tone: 'ok' | 'bad' | 'busy'; text: string } | null;
export const resultSub = (result: TestResult): React.ReactNode => result
    ? <span style={{ color: result.tone === 'ok' ? STATUS.success.ink : result.tone === 'bad' ? STATUS.danger.ink : F.textTertiary, whiteSpace: 'pre-line' }}>{result.text}</span>
    : undefined;

/** 子页滚动区里的一整页：组与组之间 22px。给 label 时外层是 <section> + 只给读屏的 <h2>（顶栏已写了标题）。 */
export const Page: React.FC<{ children: React.ReactNode; testId?: string; label?: string }> = ({ children, testId, label }) => label ? (
    <section className="flex flex-col" style={{ gap: 22 }} data-testid={testId}>
        <h2 className="sr-only">{label}</h2>
        {children}
    </section>
) : (
    <div className="flex flex-col" style={{ gap: 22 }} data-testid={testId}>{children}</div>
);
// [EM-END: settings-subpages-f]

// [EM-START: settings-subpages-f]
/** 组里的一段提示（出了问题要说清楚的那种）：状态色 tint 底 + ink 字，不加边框阴影。 */
export const Notice: React.FC<{ tone: 'danger' | 'warning' | 'info'; title?: React.ReactNode; children: React.ReactNode }> = ({ tone, title, children }) => {
    const pair = tone === 'danger' ? STATUS.danger : tone === 'warning' ? STATUS.warning : STATUS.info;
    return (
        <div role="status" style={{ background: pair.tint, color: pair.ink, borderRadius: R.smallCard, padding: '10px 14px', fontSize: 13, lineHeight: '20px' }}>
            {title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>}
            {children}
        </div>
    );
};
// [EM-END: settings-subpages-f]
