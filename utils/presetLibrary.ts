// [EM-START: preset-library]
/**
 * 素材库：从阿萌自己的酒馆预设里挑出来的文风、基调（2026-11-17）。
 *
 * - 直接读酒馆导出的 JSON（prompts + prompt_order），不用先转格式；她勾要哪几条、标成文风还是基调
 * - 原文只存在这台设备（localStorage）和她的私有备份仓库（`emPresetLibrary`），**绝不进代码仓库**：
 *   预设作者只许自用、不许传播，LiliumOS 仓库是公开的
 * - 番外选文风 / 基调，见面按角色的默认基调（CharacterProfile.meetToneId）都从这里取
 * - 宏：setvar / getvar / 注释在导入时去掉（那是酒馆里条目之间传话用的）；{{user}} {{char}} {{random::…}} 留着，用的时候再换
 */
import type { CharacterProfile } from '../types';

export type PresetItemKind = 'style' | 'tone';

export interface PresetItem {
    id: string;
    kind: PresetItemKind;
    name: string;
    text: string;
    /** 从哪份预设导进来的（文件名），手贴的没有 */
    source?: string;
    createdAt: number;
}

export const PRESET_KIND_LABEL: Record<PresetItemKind, string> = { style: '文风', tone: '基调' };

const KEY = 'em_preset_library_v1';
/** 以前番外「贴一个文风」存的地方，读一次就并进素材库 */
const LEGACY_STYLE_KEY = 'em_meet_extra_styles_v1';
export const PRESET_LIBRARY_CHANGED_EVENT = 'em-preset-library-changed';

const storage = (): Storage | null => {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

const newId = () => `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const isItem = (r: any): r is PresetItem => r && typeof r.id === 'string' && (r.kind === 'style' || r.kind === 'tone') && typeof r.name === 'string' && typeof r.text === 'string';

const readRaw = (): PresetItem[] => {
    const s = storage();
    if (!s) return [];
    try {
        const rows = JSON.parse(s.getItem(KEY) || '[]');
        return Array.isArray(rows) ? rows.filter(isItem) : [];
    } catch { return []; }
};

const write = (rows: PresetItem[]) => {
    const s = storage();
    if (!s) return;
    try { s.setItem(KEY, JSON.stringify(rows)); } catch { /* 存不了就这一次 */ }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(PRESET_LIBRARY_CHANGED_EVENT));
};

/** 旧的番外文风并进来（只做一次） */
const migrateLegacy = (rows: PresetItem[]): PresetItem[] => {
    const s = storage();
    const raw = s?.getItem(LEGACY_STYLE_KEY);
    if (!s || !raw) return rows;
    try {
        const legacy = JSON.parse(raw);
        const add = (Array.isArray(legacy) ? legacy : [])
            .filter((r: any) => r && typeof r.name === 'string' && typeof r.text === 'string' && !rows.some(x => x.kind === 'style' && x.name === r.name))
            .map((r: any) => ({ id: newId(), kind: 'style' as const, name: r.name, text: r.text, createdAt: Date.now() }));
        const next = [...rows, ...add];
        s.removeItem(LEGACY_STYLE_KEY);
        if (add.length) write(next);
        return next;
    } catch { return rows; }
};

export const listPresetItems = (kind?: PresetItemKind): PresetItem[] => {
    const rows = migrateLegacy(readRaw());
    return kind ? rows.filter(r => r.kind === kind) : rows;
};

export const findPresetItem = (id?: string): PresetItem | undefined => (id ? listPresetItems().find(r => r.id === id) : undefined);

export const savePresetItem = (item: Omit<PresetItem, 'id' | 'createdAt'> & { id?: string }): PresetItem => {
    const rows = listPresetItems();
    const existing = item.id ? rows.find(r => r.id === item.id) : undefined;
    const row: PresetItem = { ...(existing || { id: newId(), createdAt: Date.now() }), ...item, id: existing?.id || item.id || newId(), name: item.name.trim(), text: item.text.trim() } as PresetItem;
    write([...rows.filter(r => r.id !== row.id), row]);
    return row;
};

export const addPresetItems = (items: Omit<PresetItem, 'id' | 'createdAt'>[]): number => {
    const rows = listPresetItems();
    const now = Date.now();
    // 同一份预设、同名、同类的再导一次就是更新，不重复
    const next = [...rows];
    for (const item of items) {
        const i = next.findIndex(r => r.kind === item.kind && r.name === item.name && r.source === item.source);
        const row = { ...item, id: i >= 0 ? next[i].id : newId(), createdAt: i >= 0 ? next[i].createdAt : now };
        if (i >= 0) next[i] = row; else next.push(row);
    }
    write(next);
    return items.length;
};

export const removePresetItem = (id: string) => write(listPresetItems().filter(r => r.id !== id));

// ── 备份：私有备份仓库，阿萌 2026-11-17 确认过是私有的 ──
export const exportPresetLibrary = (): PresetItem[] => listPresetItems();
export const importPresetLibrary = (rows: unknown) => {
    if (!Array.isArray(rows)) return;
    const incoming = rows.filter(isItem);
    const mine = listPresetItems().filter(r => !incoming.some(x => x.id === r.id));
    write([...mine, ...incoming]);
};

// ── 用的时候：宏换掉 ──

/** {{user}} {{char}} 换名字，{{random::a::b}} 抽一个，剩下认不出的宏去掉 */
export const renderPresetText = (text: string, names: { user: string; char: string }, rand: () => number = Math.random): string =>
    text
        .replace(/\{\{random::([\s\S]*?)\}\}/gi, (_m, body: string) => {
            const opts = body.split('::').map(s => s.trim()).filter(Boolean);
            return opts.length ? opts[Math.floor(rand() * opts.length) % opts.length] : '';
        })
        .replace(/\{\{user\}\}/gi, names.user || '对方')
        .replace(/\{\{char\}\}/gi, names.char || '你')
        .replace(/<\{\{?user\}?\}_info>/gi, '')
        .replace(/\{\{[^{}]*\}\}/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

/** 见面里这个角色的基调（没选、或者素材库里删了 → 空） */
export const meetToneBlock = (char: Pick<CharacterProfile, 'meetToneId' | 'name'>, userName: string): string => {
    const tone = findPresetItem(char.meetToneId);
    if (!tone || tone.kind !== 'tone') return '';
    return `### 你们相处的基调：${tone.name}\n${renderPresetText(tone.text, { user: userName, char: char.name })}\n\n`;
};

// ── 读酒馆预设 ──

export interface PresetImportEntry {
    key: string;
    name: string;
    /** 预设里的分区（┌─…─┐ / ├─…─┤ 那种标题条目下面的） */
    group: string;
    text: string;
    enabled: boolean;
    /** 按名字猜的用途；猜不出是 null */
    guess: PresetItemKind | null;
}

const isHeader = (name: string) => /^[\s]*[┌├└]/.test(name);

/** 去掉 {{setvar::名::内容}}（内容可能跨行、里面还有 {{}}）、{{getvar::…}}、{{// 注释}} */
export const stripPresetPlumbing = (raw: string): string => {
    let out = '';
    let i = 0;
    while (i < raw.length) {
        const rest = raw.slice(i, i + 12).toLowerCase();
        if (rest.startsWith('{{setvar::') || rest.startsWith('{{getvar::') || rest.startsWith('{{//') || rest.startsWith('{{trim}}')) {
            let depth = 0;
            let j = i;
            for (; j < raw.length; j++) {
                if (raw.startsWith('{{', j)) { depth++; j++; continue; }
                if (raw.startsWith('}}', j)) { depth--; j++; if (depth === 0) { j++; break; } }
            }
            i = j;
            continue;
        }
        out += raw[i];
        i++;
    }
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

/** 先看条目自己的名字，名字里看不出来才看它在哪个分区 */
const guessKind = (name: string, group: string): PresetItemKind | null => {
    const STYLE = /文风|笔法|writing.?style/i;
    const TONE = /基调|氛围|atmosphere|tone/i;
    if (STYLE.test(name)) return 'style';
    if (TONE.test(name)) return 'tone';
    if (STYLE.test(group)) return 'style';
    if (TONE.test(group)) return 'tone';
    return null;
};

/** 名字里的装饰（│🎼、┌─ 等）去掉，留人话 */
export const cleanPresetName = (name: string): string =>
    name.replace(/[│┌├└┐┤┘─]/g, '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/^\s*(选-|文风-|文风·|笔法·|基调·|氛围·)/, '').replace(/[·\s]+$/, '').trim();

/** 读一份酒馆预设：按预设里的顺序列出有正文的条目，标出开着没开、在哪个分区 */
export const parseTavernPreset = (json: string): PresetImportEntry[] => {
    let data: any;
    try { data = JSON.parse(json); } catch { throw new Error('读不出来：不是有效的 JSON 文件'); }
    const prompts: any[] = Array.isArray(data?.prompts) ? data.prompts : [];
    if (!prompts.length) throw new Error('这个文件里没有预设条目（要酒馆导出的对话补全预设）');
    const orders: any[] = Array.isArray(data?.prompt_order) ? data.prompt_order : [];
    const order: any[] = orders.reduce((best: any[], o: any) => (Array.isArray(o?.order) && o.order.length > best.length ? o.order : best), []);
    const enabled = new Map<string, boolean>(order.map((o: any) => [o.identifier, !!o.enabled]));
    const byId = new Map(prompts.map(p => [p.identifier, p]));
    const sequence: any[] = order.length
        ? [...order.map((o: any) => byId.get(o.identifier)).filter(Boolean), ...prompts.filter(p => !enabled.has(p.identifier))]
        : prompts;
    const out: PresetImportEntry[] = [];
    let group = '';
    for (const p of sequence) {
        const name = String(p?.name || '');
        if (isHeader(name)) { group = cleanPresetName(name); }
        const text = stripPresetPlumbing(String(p?.content || ''));
        if (!text || p?.marker || text.length < 20) continue;
        const clean = cleanPresetName(name) || '未命名';
        // 分区标题、「点小铅笔查看说明」「勿关」这类是给酒馆里的人看的说明，不当文风 / 基调
        const plumbing = isHeader(name) || /勿关|勿动|千万别关|点小铅笔|确认与接收/.test(name);
        out.push({ key: String(p.identifier || `${out.length}`), name: clean, group: isHeader(name) ? '' : group, text, enabled: !!enabled.get(p.identifier), guess: plumbing ? null : guessKind(name, group) });
    }
    return out;
};
// [EM-END: preset-library]
