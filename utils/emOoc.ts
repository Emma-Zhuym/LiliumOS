// [EM-START: ooc]
/**
 * OOC：跟模型本身说话（阿萌 2026-10-30）。
 *
 * 原来出戏只能在对话后面加括号写元指令，情绪 API 把她的不满当成角色面对的情绪，
 * 记忆宫殿也照单全收。现在：
 * - 输入以 `//`、`OOC：`、`（OOC）` 开头就是 OOC，存成 `metadata.ooc`，灰色小气泡
 * - 这一轮在本机生成，模型用它自己的身份出戏回一段（也是 OOC），不扮演、不推剧情
 * - OOC 进聊天上下文（带明确标记），但不进情绪评估、心思、记忆宫殿、心跳快照
 * - 她可以把一条 OOC 钉住：每一轮都提醒（存本机，按角色）
 */

import type { Message } from '../types';

const OOC_PREFIX_RE = /^\s*(?:\/\/|ooc\s*[:：]|[（(]\s*ooc\s*[)）]\s*[:：]?)\s*/i;

/** 输入是不是 OOC：是就返回去掉前缀的正文，不是返回 null。只有前缀没有内容也算不是。 */
export const parseOocInput = (text: string): string | null => {
    const match = text.match(OOC_PREFIX_RE);
    if (!match) return null;
    const rest = text.slice(match[0].length).trim();
    return rest || null;
};

export const isOocMessage = (m: Pick<Message, 'metadata'> | null | undefined): boolean => m?.metadata?.ooc === true;

/** 给模型看的标记：情绪评估按它把这几行剔掉，所以别改字 */
export const OOC_MARK = '[OOC｜';

export const oocPromptContent = (
    m: Pick<Message, 'role' | 'content'>,
    { userName, timeStr = '', isLast = false }: { userName: string; timeStr?: string; isLast?: boolean },
): string => {
    const head = m.role === 'user'
        ? `${OOC_MARK}${userName}以作者身份对你（模型）说的，不是剧情里 ta 对角色说的话，也不是 ta 的情绪]`
        : `${OOC_MARK}你（模型）之前的出戏回应，不是剧情]`;
    let text = `${timeStr ? `${timeStr} ` : ''}${head}\n${m.content}`;
    if (isLast && m.role === 'user') {
        text += '\n\n（这一轮请出戏回应：用你自己——模型——的身份说话，不扮演角色、不写动作描写、不推进剧情，'
            + '不要输出任何 [[ ]] 标签。先说你理解的问题出在哪，再说接下来会怎么做。简短直接。'
            + '回到剧情时照 ta 的要求改，别在剧情里提起这段 OOC。）';
    }
    return text;
};

/** 情绪评估 / 心思标签只看剧情：带 OOC 标记的那几条剔掉 */
export const isOocPromptContent = (content: unknown): boolean => {
    if (typeof content === 'string') return content.includes(OOC_MARK);
    if (Array.isArray(content)) return content.some(part => typeof part?.text === 'string' && part.text.includes(OOC_MARK));
    return false;
};

/** 模型的出戏回应：剥思考块和标签，整段存一条 */
export const cleanOocReply = (raw: string): string => (raw || '')
    .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:think|thinking|thought)>[\s\S]*$/gi, '')
    .replace(/\[\[[\s\S]*?\]\]/g, '')
    .replace(/^\s*\[OOC[^\]]*\]\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// ── 钉住的 OOC ───────────────────────────────────────────

export interface OocPin { id: number; text: string; pinnedAt: number }

const PINS_MAX = 8;
const pinsKey = (charId: string) => `em_ooc_pins_v1:${charId}`;
export const OOC_PINS_CHANGED_EVENT = 'em-ooc-pins-changed';

export const loadOocPins = (charId: string): OocPin[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(pinsKey(charId)) || '[]');
        return Array.isArray(parsed) ? parsed.filter(p => p && typeof p.text === 'string' && Number.isFinite(p.id)) : [];
    } catch {
        return [];
    }
};

const savePins = (charId: string, pins: OocPin[]) => {
    try { localStorage.setItem(pinsKey(charId), JSON.stringify(pins)); } catch { /* 存不下就算了 */ }
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OOC_PINS_CHANGED_EVENT, { detail: { charId } }));
};

/** 钉住：最多 8 条，满了挤掉最早的 */
export const pinOoc = (charId: string, m: Pick<Message, 'id' | 'content'>, now = Date.now()) =>
    savePins(charId, [...loadOocPins(charId).filter(p => p.id !== m.id), { id: m.id, text: String(m.content).slice(0, 500), pinnedAt: now }].slice(-PINS_MAX));

export const unpinOoc = (charId: string, id: number) => savePins(charId, loadOocPins(charId).filter(p => p.id !== id));

export const isOocPinned = (charId: string, id: number) => loadOocPins(charId).some(p => p.id === id);

/** 每一轮都带：钉住的那几条 */
export const buildOocPinsInjection = (charId: string, userName: string, pins = loadOocPins(charId)): string => {
    if (!pins.length) return '';
    return `\n### ${userName}钉住的要求（OOC，作者对你说的，不是剧情）\n`
        + '每一轮都照做；不要在剧情里提起它们，也不要把它们当成角色的感受。\n'
        + pins.map(p => `- ${p.text}`).join('\n') + '\n';
};
// [EM-END: ooc]
