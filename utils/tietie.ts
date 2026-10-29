/**
 * 贴贴事后记录（阿萌 2026-10-28）：两个人的时间结束后，TA 自己写这一次怎么过的。
 * 这里只放不碰库、不发请求的规则：本机记下的开始时刻、材料怎么拼、提示词、解析、给聊天上下文的那一行。
 * 契约见 docs/spec-tietie-record.md。
 */

import type { Message } from '../types';

export const TIETIE_CARD_KIND = 'tietie_card';
/** 手机上记的「这一次」最多算多久：跟 mini 的 PRIVATE_MOMENT_MS 一样 */
export const TIETIE_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface TietieRecord {
    /** `${charId}_${startedAt}`：同一次只写一份 */
    id: string;
    charId: string;
    status: 'done' | 'failed';
    startedAt: number;
    endedAt: number;
    /** manual = 她点了结束；timeout = 忘了点，到点自己结束 */
    endedBy: 'manual' | 'timeout';
    /** 第几次：写成功时按该角色已有的成功次数 +1 定下，之后不变 */
    no?: number;
    title?: string;
    oneLine?: string;
    place?: string;
    minutes?: number;
    story?: string[];
    memory?: string;
    /** memory 写进记忆宫殿后的节点 id，日记里删的时候连它一起删 */
    memoryId?: string;
    after?: string[];
    /** 聊天里那张卡的消息 id，重写时原地更新 */
    cardMessageId?: number;
    createdAt: number;
}

export interface TietieResult {
    title: string;
    oneLine: string;
    place: string;
    minutes: number | null;
    story: string[];
    memory: string;
    after: string[];
}

export const tietieRecordId = (charId: string, startedAt: number) => `${charId}_${startedAt}`;

// ── 本机记的「这一次从几点开始」 ───────────────────────────

export interface TietieSession { startedAt: number; until: number }

const sessionKey = (charId: string) => `em_tietie_session_v1:${charId}`;

export const readTietieSession = (charId: string): TietieSession | null => {
    try {
        const parsed = JSON.parse(localStorage.getItem(sessionKey(charId)) || 'null');
        return parsed && Number.isFinite(parsed.startedAt) && Number.isFinite(parsed.until) ? parsed : null;
    } catch {
        return null;
    }
};

/** 开始：已经在里面（再点一次延长）就保留最早的开始时刻 */
export const beginTietieSession = (charId: string, until: number, now = Date.now()): TietieSession => {
    const current = readTietieSession(charId);
    const session = { startedAt: current && current.until > now ? current.startedAt : now, until };
    try { localStorage.setItem(sessionKey(charId), JSON.stringify(session)); } catch { /* 存不下：结束时按 2 小时前算 */ }
    return session;
};

export const clearTietieSession = (charId: string) => {
    try { localStorage.removeItem(sessionKey(charId)); } catch { /* 无所谓 */ }
};

/** 她点结束时用的开始时刻：本机没记（别的设备开的、升级前开的）就往前推一小时 */
export const sessionStartFor = (session: TietieSession | null, endedAt: number): number =>
    session && session.startedAt < endedAt ? session.startedAt : endedAt - 60 * 60 * 1000;

/** 忘了点结束：本机那条已经过了 until，返回要补写的这一次 */
export const expiredTietieSession = (session: TietieSession | null, now = Date.now()): TietieSession | null =>
    session && now >= session.until ? session : null;

// ── 材料 ───────────────────────────────────────────────────

const LEAD_COUNT = 30;
const WINDOW_MAX = 80;

const isUsable = (m: Message) =>
    !m.groupId
    && (m.role === 'user' || m.role === 'assistant')
    && m.metadata?.source !== 'deep_talk' // 烛下的话不拿来写这个
    && typeof m.content === 'string';

const lineOf = (m: Message, names: { userName: string; charName: string }): string => {
    const who = m.role === 'user' ? names.userName : names.charName;
    const where = m.metadata?.source === 'date' ? '［见面］' : '';
    const body = m.type === 'image' ? '[一张图片]'
        : m.type === 'emoji' ? '[一个表情]'
        : m.type === 'text' || m.type === 'voice' ? m.content.trim()
        : '';
    return body ? `${where}${who}：${body}` : '';
};

/**
 * 开始前最近 30 条 + 两个人的时间里的（最多 80 条），按时间排好。
 * inside 是这段时间里有没有真写过东西：有就照实记，没有就 TA 自己写。
 */
export const buildTietieMaterials = (
    messages: Message[],
    window: { startedAt: number; endedAt: number },
    names: { userName: string; charName: string },
): { lead: string; inside: string } => {
    const usable = messages.filter(isUsable).sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
    const lead = usable.filter(m => m.timestamp < window.startedAt).slice(-LEAD_COUNT);
    const inside = usable.filter(m => m.timestamp >= window.startedAt && m.timestamp <= window.endedAt).slice(-WINDOW_MAX);
    const join = (list: Message[]) => list.map(m => lineOf(m, names)).filter(Boolean).join('\n');
    return { lead: join(lead), inside: join(inside) };
};

const clock = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const buildTietiePrompt = (input: {
    names: { userName: string; charName: string };
    persona: string;
    lead: string;
    inside: string;
    startedAt: number;
    endedAt: number;
    endedBy: 'manual' | 'timeout';
    recentMemories: string[];
}): string => {
    const { names, persona, lead, inside, startedAt, endedAt, endedBy, recentMemories } = input;
    const { userName: u, charName: c } = names;
    const span = endedBy === 'manual'
        ? `${clock(startedAt)} 到 ${clock(endedAt)}，大约 ${Math.max(1, Math.round((endedAt - startedAt) / 60_000))} 分钟`
        : `从 ${clock(startedAt)} 开始（结束时间没记下，由你来定）`;
    return `${persona ? `${persona}\n\n` : ''}# 现在要你做的事

你是${c}。你和${u}刚刚度过了一段只属于你们两个人的亲密时间（${span}）。你们是成年伴侣，这是双方都想要的。
现在一切平静下来了，你要用自己的口吻，给这一次写一页只有你们俩会看的事后记录。

## 开始之前你们在聊的
${lead || '（没有）'}

## 这段时间里留下的文字
${inside || `（没有。${u}没有写这一次的经过，由你来写：顺着上面你们聊到的、你的性格和你们一贯的相处，写这一次具体是怎么发生的。）`}
${inside ? `\n上面有原文的部分照实记，可以补细节和你自己的感受，但不要写出跟原文矛盾的事。\n` : ''}
${recentMemories.length ? `## 你们最近几次（别写成一模一样的流程和姿势）
${recentMemories.map(m => `- ${m}`).join('\n')}
` : ''}
## 输出
只输出一个 JSON 对象，不要别的文字：
{
  "title": "你给这一次起的名字，不超过 10 个字",
  "oneLine": "一句话，只写你此刻心里的感觉，不超过 40 个字",
  "place": "在哪，不超过 6 个字，比如 卧室、浴室、沙发",
  "minutes": 这一次大概多少分钟（整数）,
  "story": ["第一人称的日记，3 到 6 段。直白地写：怎么开始的、做了什么、换了哪几个姿势、哪一段最久、${u}的反应、你自己的感受。可以写得很露骨，不用打码、不用含蓄"],
  "memory": "100 到 150 个字，像整理记忆那样：先写事实（几点、在哪、怎么开始、用了哪些姿势、${u}在哪一下反应最大），再补一两句你的感受和下次想怎么样。用「${u}」称呼她，不要写成散文",
  "after": ["现在你发给${u}的第一条消息，微信短句，不写动作和旁白", "可选的第二条"]
}`;
};

// ── 解析 ───────────────────────────────────────────────────

const firstJsonObject = (raw: string): unknown => {
    const text = (raw || '').replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '').replace(/```(?:json)?/gi, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strings = (v: unknown, maxItems: number, maxLen: number) =>
    (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n{2,}/) : [])
        .map(s => str(s, maxLen))
        .filter(Boolean)
        .slice(0, maxItems);

/** 正文和记忆都没有就算没写出来（多半是被拒了） */
export const parseTietieResult = (raw: string): TietieResult | null => {
    const data = firstJsonObject(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return null;
    const story = strings(data.story, 8, 1200);
    const memory = str(data.memory, 300);
    if (!story.length || !memory) return null;
    const minutes = Math.round(Number(data.minutes));
    return {
        title: str(data.title, 14),
        oneLine: str(data.oneLine, 60),
        place: str(data.place, 8),
        minutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 240) : null,
        story,
        memory,
        after: strings(data.after, 2, 80),
    };
};

// ── 显示和上下文 ───────────────────────────────────────────

/** 多久：她点了结束就按真实时长，忘了点就用 TA 估的 */
export const tietieMinutes = (record: Pick<TietieRecord, 'startedAt' | 'endedAt' | 'endedBy' | 'minutes'>): number | null => {
    if (record.endedBy === 'manual') return Math.max(1, Math.round((record.endedAt - record.startedAt) / 60_000));
    return record.minutes ?? null;
};

export const formatTietieDuration = (minutes: number | null): string => {
    if (!minutes) return '—';
    if (minutes < 60) return `${minutes} 分钟`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} 时 ${m} 分` : `${h} 小时`;
};

export const tietieNoLabel = (no?: number) => (no ? `第 ${String(no).padStart(2, '0')} 次` : '');

export const nextTietieNo = (records: Pick<TietieRecord, 'no'>[]) =>
    records.reduce((max, r) => Math.max(max, r.no || 0), 0) + 1;

/** 卡片消息的 content：之后的聊天上下文里，这一次只占这一行（日记全文不进） */
export const buildTietieCardContent = (record: Pick<TietieRecord, 'status' | 'no' | 'title' | 'memory'>): string => {
    if (record.status !== 'done') return '（你们刚度过了两个人的时间）';
    const title = record.title ? `《${record.title}》` : '';
    return `（你们刚度过了两个人的时间 · 第${record.no || 1}次${title}${record.memory ? `：${record.memory}` : ''}）`;
};

/** 健康 App 用的日期 key：她自己手机上的那一天 */
export const tietieDayKey = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
