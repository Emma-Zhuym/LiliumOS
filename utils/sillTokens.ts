// [EM-START: window-sill]
/**
 * 窗台的取值（2026-11-10 阿萌定：窗台不走 clayTokens / F，就用画布上一路改定的这套）。
 * 画布：https://claude.ai/artifact/BfunjkLhpiV2D9kNayYLvP （「C3 · 点进一个人」「C2 · 跟手指动 · 乙」「C2 · 平常的下午」）
 *
 * 窗台自成一套，跟小厨房的纸（kitchenPaperTokens）、墨线窗（inkTokens）一个待遇：
 * 窗台的组件只从这里取颜色、字体、圆角、动效，不写裸 hex，也不混 F 的值。
 */

/** 页底、字、线。页底是墨线的纸色。 */
export const SILL = {
    page: '#ECEEEB',
    ink: '#2B2F45',
    inkSoft: 'rgba(43,47,69,.72)',
    inkFaint: 'rgba(43,47,69,.55)',
    line: 'rgba(43,47,69,.2)',
    lineFaint: 'rgba(43,47,69,.12)',
    paper: '#F1EDE4',
    switchOff: 'rgba(43,47,69,.25)',
    chipOn: 'rgba(43,47,69,.08)',
    radius: 6,
} as const;

export const SILL_FONT = {
    serif: '"Noto Serif SC", "Songti SC", serif',
    sans: '"Noto Sans SC", -apple-system, "PingFang SC", sans-serif',
    type: '"Courier Prime", "Courier New", monospace',
} as const;

export type SillThemeId = 'spring' | 'summer' | 'earlyWinter';

export interface SillTheme {
    id: SillThemeId;
    name: string;
    /** 牌 / 顶卡 / 未寄的话那张纸的底 */
    field: string;
    /** 撞上去的那块形状（春的绿果冻、夏的浅水、冬的月亮） */
    shape: string;
    /** 压角的深色块（春的酒红果冻、夏的深水、冬的霜） */
    block: string;
    /** 心思那行字 */
    mood: string;
    /** 牌上其余的字 */
    text: string;
    textSoft: string;
    /** 页面上用这一套颜色的地方（热力条、胶囊、开关、「最重的一笔」） */
    accent: string;
    accentRgb: string;
    capsuleBg: string;
    /** 顶卡左下 API 选择器、右下「下一跳」压在图案上的字色 */
    apiText: string;
    nextText: string;
    /** 牌底部「攒着几句」那行字 */
    footText: string;
    /** 未寄的话的索引贴：这一页的贴（压在纸上）/ 别页的贴（压在纸下） */
    flagOn: string;
    flagOnEdge: string;
    flagOff: string;
    flagOffEdge: string;
    /** 纸纹的颜色（feColorMatrix 的 r g b） */
    grain: string;
}

export const SILL_THEMES: Record<SillThemeId, SillTheme> = {
    spring: {
        id: 'spring', name: '春日',
        field: '#E6B8AE', shape: '#8FB07A', block: '#6E3436', mood: '#6E3436', text: '#2B2F45', textSoft: 'rgba(43,47,69,.72)',
        accent: '#6E3436', accentRgb: '110,52,54', capsuleBg: 'rgba(110,52,54,.12)',
        apiText: '#2B2F45', nextText: '#2B2F45', footText: '#2B2F45',
        flagOn: 'rgba(110,52,54,.78)', flagOnEdge: 'rgba(60,24,26,.55)', flagOff: 'rgba(143,176,122,.55)', flagOffEdge: 'rgba(70,96,58,.45)',
        grain: '0.36 0.16 0.17',
    },
    summer: {
        id: 'summer', name: '盛夏',
        field: '#EBCB6E', shape: '#4F9BAA', block: '#1F4E5C', mood: '#1F4E5C', text: '#2B2F45', textSoft: 'rgba(43,47,69,.72)',
        accent: '#1F4E5C', accentRgb: '31,78,92', capsuleBg: 'rgba(31,78,92,.12)',
        apiText: '#F1EDE4', nextText: '#F1EDE4', footText: '#F1EDE4',
        flagOn: 'rgba(31,78,92,.78)', flagOnEdge: 'rgba(15,40,48,.55)', flagOff: 'rgba(79,155,170,.5)', flagOffEdge: 'rgba(40,90,100,.45)',
        grain: '0.38 0.27 0.06',
    },
    earlyWinter: {
        id: 'earlyWinter', name: '初冬',
        field: '#3A4460', shape: '#E0A66B', block: '#C5CAD6', mood: '#F0C491', text: '#F1EDE4', textSoft: 'rgba(241,237,228,.72)',
        accent: '#3A4460', accentRgb: '58,68,96', capsuleBg: 'rgba(58,68,96,.12)',
        apiText: '#F1EDE4', nextText: '#2B2F45', footText: '#F1EDE4',
        flagOn: 'rgba(224,166,107,.85)', flagOnEdge: 'rgba(140,90,40,.55)', flagOff: 'rgba(197,202,214,.6)', flagOffEdge: 'rgba(110,116,135,.45)',
        grain: '0.10 0.12 0.20',
    },
};

export const SILL_THEME_ORDER: SillThemeId[] = ['spring', 'summer', 'earlyWinter'];

/** 七日心事的五档浓淡（0 = 平常）。 */
export const SILL_HEAT_ALPHA = [0.08, 0.26, 0.46, 0.7, 1] as const;

/** 索引贴的明暗：这一页的贴浮在纸上，别页的贴被纸边压着（阿萌 2026-11-10 看过样稿要的那点写实）。 */
export const SILL_FLAG = {
    shadowOn: '0 1px 1.5px rgba(43,47,69,.22), 0 0 0 .5px rgba(43,47,69,.08)',
    shadowOff: 'inset 10px 0 4px -6px rgba(43,47,69,.28), 0 1px 1px rgba(43,47,69,.14)',
    topEdge: 'rgba(255,255,255,.45)',
    sheenOn: 'rgba(255,255,255,.12)',
    sheenOff: 'rgba(255,255,255,.2)',
} as const;

export const SILL_MOTION = {
    /** 翻牌：一条顺滑转动，不过头不回弹 */
    flip: '700ms',
    flipEase: 'cubic-bezier(.45,0,.25,1)',
    /** 未寄的话换页：字先淡出再淡入 */
    fade: '180ms',
    flag: '220ms',
    ease: 'ease',
} as const;
// [EM-END: window-sill]
