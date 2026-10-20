// [EM-START: char-drives-engine]
/**
 * 劲儿系统在手机这一侧：副 API 评估情绪时顺手给几个「事件标签」，送去 mini 的劲儿引擎。
 * 规格见 docs/spec-character-drives.md 5.2。
 *
 * - 照 roomAmbient 的先例搭顺风车：评估提示词末尾多一段可选输出，不多调一次 API
 * - **只给标签和她的原话，不给数字**：数值由 mini 上的代码定（模型给的数字不稳定）
 * - 只判断「她做了什么」，不看人设——同一句「嗯」换个角色标签不该变；角色多在意由脾气读数管
 * - 负面的必须引她的原话，没有原话 mini 直接不收（小模型把兴奋判成不高兴、天天积成假账的教训）
 * - mini 不在线时存一小队列，下次再送
 */

import { AgentBackend, isAgentPaired } from './emAgentBackend';

export const DRIVE_EVENT_LABELS = [
    'affectionate', 'intimate', 'vulnerable', 'reassuring', 'sharing',
    'cold', 'dismissive', 'conflict', 'broken_promise', 'pressing', 'concern_fact',
] as const;
export type DriveEventLabel = typeof DRIVE_EVENT_LABELS[number];
export interface DriveEvent { label: DriveEventLabel; quote?: string }

const NEGATIVE = new Set<DriveEventLabel>(['cold', 'dismissive', 'conflict', 'broken_promise', 'pressing']);
const MAX_EVENTS = 3;
const QUOTE_MAX = 120;

/** 评估提示词末尾追加的那一段。没配对 mini 时不加（没地方送，白占提示词）。 */
export const buildDriveEventsEvalSection = (): string => {
    if (!isAgentPaired()) return '';
    return `

## 附加输出：driveEvents（可选）
只看**对方（用户）最近这几条消息里做了什么**，挑 0–${MAX_EVENTS} 个最贴切的标签，写进 JSON 的 "driveEvents" 数组：[{"label": "...", "quote": "她的原话"}]。
标签只能从下面选，不看角色人设、只看对方的行为：
- affectionate：亲昵、撒娇、说想你 / 喜欢你
- intimate：亲密、调情
- vulnerable：难受、生病、哭、说自己很累很崩溃
- reassuring：安抚、道歉、和好
- sharing：兴冲冲分享一件事
- cold：明显冷淡（这一轮比之前短得多、敷衍）
- dismissive：对角色说的话不当回事
- conflict：吵起来了、带着火气
- broken_promise：答应过的事没做 / 忘了
- pressing：催、追问
- concern_fact：提到会让人挂心的事实（考试、看病、出远门、大额花销）
规则：cold / dismissive / conflict / broken_promise / pressing **必须**在 quote 里一字不差地引她的原话，引不出来就别标；兴奋、开玩笑、语气词多不是负面。没有合适的就写 "driveEvents": []。`;
};

/** 模型给的整理一遍：认识的标签、负面的有原话、最多三个。 */
export const sanitizeDriveEvents = (raw: unknown): DriveEvent[] => {
    if (!Array.isArray(raw)) return [];
    const out: DriveEvent[] = [];
    for (const item of raw) {
        const label = (item as any)?.label;
        if (!DRIVE_EVENT_LABELS.includes(label)) continue;
        const quote = typeof (item as any)?.quote === 'string' ? (item as any).quote.trim().slice(0, QUOTE_MAX) : '';
        if (NEGATIVE.has(label) && !quote) continue;
        out.push(quote ? { label, quote } : { label });
        if (out.length >= MAX_EVENTS) break;
    }
    return out;
};

// ── 送去 mini（不在线就排队）──────────────────────────────────────
const QUEUE_KEY = 'em_drive_events_queue_v1';
const QUEUE_MAX = 20;
const QUEUE_TTL_MS = 6 * 60 * 60 * 1000;

interface QueuedBatch { charId: string; events: DriveEvent[]; at: number }

const readQueue = (now: number): QueuedBatch[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((b: QueuedBatch) => b && typeof b.charId === 'string' && now - b.at < QUEUE_TTL_MS) : [];
    } catch {
        return [];
    }
};

const writeQueue = (queue: QueuedBatch[]) => {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_MAX))); } catch { /* 存不下就丢 */ }
};

/**
 * 情绪评估落地时调（emotionApply.ts）。先把排着的旧的送掉，再送这一批；送不出去就排队。
 * 永不抛错：这是顺风车，坏了不该连累情绪评估本身。
 */
export const sendDriveEventsFromEval = async (parsed: any, charId: string, now = Date.now()): Promise<void> => {
    try {
        const events = sanitizeDriveEvents(parsed?.driveEvents);
        if (!isAgentPaired()) return;
        const queue = readQueue(now);
        if (events.length) queue.push({ charId, events, at: now });
        if (!queue.length) return;
        const left: QueuedBatch[] = [];
        for (const batch of queue) {
            try {
                await AgentBackend.driveEvents(batch.charId, batch.events);
            } catch {
                left.push(batch);
            }
        }
        writeQueue(left);
        if (events.length) console.log(`💗 [Drives] ${charId} ← ${events.map(e => e.label).join(', ')}`);
    } catch (error) {
        console.warn('💗 [Drives] 事件标签没送出去', error);
    }
};
// [EM-END: char-drives-engine]
