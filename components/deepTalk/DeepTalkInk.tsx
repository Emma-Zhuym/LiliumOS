// [EM-START: deep-talk]
/**
 * 烛下（深谈）共用的墨线部件：蜡烛、手绘抖边、昼夜配色。
 * 白天用 HUE.indigo + F，夜里用 CANDLE_NIGHT（2026-10-22 阿萌定），都从 clayTokens 取。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CANDLE_NIGHT, F, HUE } from '../../utils/clayTokens';
import { resolveDeepTalkTheme, type DeepTalkThemePref } from '../../utils/deepTalk';

export interface DeepTalkPalette {
    paper: string;
    ink: string;
    inkMid: string;
    inkMe: string;
    inkSoft: string;
    line: string;
    rule: string;
    flame: string;
    flameFill: string;
}

export const DAY_PALETTE: DeepTalkPalette = {
    paper: F.appBg,
    ink: HUE.indigo.ink,
    inkMid: HUE.indigo.main,
    inkMe: HUE.indigo.main,
    inkSoft: F.textTertiary,
    line: HUE.indigo.soft,
    rule: HUE.indigo.soft,
    flame: HUE.indigo.ink,
    flameFill: 'none',
};

export const NIGHT_PALETTE: DeepTalkPalette = { ...CANDLE_NIGHT };

export const WOBBLE_FILTER_ID = 'em-dt-wob';

/** 抖边滤镜：手绘线稿那点不平整。每个用到抖边的根节点放一份，id 相同没关系 */
export const WobbleDefs: React.FC = () => (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        <filter id={WOBBLE_FILTER_ID} x="-4%" y="-8%" width="108%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves={2} seed={4} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={3} xChannelSelector="R" yChannelSelector="G" />
        </filter>
    </svg>
);

/** 手绘描边框：叠在内容下面，pointer-events 关掉 */
export const WobbleBorder: React.FC<{ color: string; radius?: string; width?: number }> = ({ color, radius = '4px 7px 5px 8px', width = 1.3 }) => (
    <span aria-hidden="true" style={{
        position: 'absolute', inset: 0, border: `${width}px solid ${color}`, borderRadius: radius,
        filter: `url(#${WOBBLE_FILTER_ID})`, pointerEvents: 'none',
    }} />
);

/** 蜡烛线稿：点着的 / 灭了冒一缕烟的 */
export const Candle: React.FC<{ lit: boolean; palette: DeepTalkPalette; width?: number; height?: number; className?: string }> = ({ lit, palette, width = 15, height = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 32" aria-hidden="true" className={className}
        style={{ fill: 'none', stroke: palette.ink, strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', flexShrink: 0 }}>
        {lit
            ? <path d="M12 2.6c-2.3 3.1-3.1 4.7-3.1 6.4 0 1.8 1.4 3.2 3.1 3.2s3-1.3 3-3.1c0-1.8-.8-3.3-3-6.5z" style={{ stroke: palette.flame, fill: palette.flameFill }} />
            : <path d="M12.2 11.8c-1.4-1.6 1.2-2.6-.1-4.3-1-1.3.6-2.4.2-3.8" style={{ stroke: palette.inkSoft, strokeWidth: 1 }} />}
        <path d="M12 12.4v2.1" />
        <path d="M8.3 14.9c.1 4.3 0 9.2.2 13.1M15.8 14.7c-.2 4.4-.1 9.4 0 13.3M8.2 15c2.5-.5 5.2-.4 7.7-.3" />
        <path d="M10.2 17.3c.2 1 .1 2-.3 2.7" />
        <path d="M4.8 28.3c4.7.5 9.8.3 14.4 0" />
    </svg>
);

/** 横格纸：30px 一行，线用 rule 色（svg 平铺，不用渐变） */
export const ruledBackground = (palette: DeepTalkPalette, lineHeight = 30): React.CSSProperties => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='${lineHeight}'><path d='M0 ${lineHeight - 0.5}H10' stroke='${palette.rule}' stroke-opacity='0.55' stroke-width='1'/></svg>`;
    return {
        backgroundColor: palette.paper,
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
        backgroundSize: `100% ${lineHeight}px`,
        backgroundAttachment: 'local',
    };
};

const themeKey = (charId: string) => `em_deep_talk_theme_${charId}`;

const readPref = (charId: string): DeepTalkThemePref => {
    try {
        const v = localStorage.getItem(themeKey(charId));
        return v === 'day' || v === 'night' ? v : 'auto';
    } catch { return 'auto'; }
};

/** 昼夜：默认看角色那边几点，手动切过就按手动的（按角色存在本机，不进备份） */
export const useDeepTalkTheme = (charId: string, timeZone?: string) => {
    const [pref, setPref] = useState<DeepTalkThemePref>(() => readPref(charId));
    const [now, setNow] = useState(() => new Date());
    useEffect(() => { setPref(readPref(charId)); }, [charId]);
    useEffect(() => {
        if (pref !== 'auto') return;
        const timer = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(timer);
    }, [pref]);
    const theme = resolveDeepTalkTheme(pref, now, timeZone);
    const toggle = useCallback(() => {
        const next: DeepTalkThemePref = theme === 'night' ? 'day' : 'night';
        try { localStorage.setItem(themeKey(charId), next); } catch { /* 存不了就只管这一次 */ }
        setPref(next);
    }, [charId, theme]);
    const palette = useMemo(() => (theme === 'night' ? NIGHT_PALETTE : DAY_PALETTE), [theme]);
    return { theme, palette, toggle };
};

/** 开关图标：白天显示月亮（点了变夜里），夜里显示太阳 */
export const ThemeGlyph: React.FC<{ theme: 'day' | 'night'; color: string }> = ({ theme, color }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
        {theme === 'day'
            ? <path d="M16.5 3.8a8.4 8.4 0 1 0 3.7 11.9 6.9 6.9 0 0 1-3.7-11.9z" />
            : <><circle cx="12" cy="12" r="4" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>}
    </svg>
);
// [EM-END: deep-talk]
