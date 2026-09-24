// [EM-START: agent-life]
/**
 * 私人生活里的小事，从 Mac mini 心跳送来后落进「查手机」里对应的 App：
 * 和朋友家人聊几句 → 联系人里那段聊天；点外卖 → 外卖；网购 → 淘宝；发朋友圈 → 朋友圈。
 *
 * 和工作往来（emWork.ts）是两条线：工作的只在「工作」App 里，这里的才进通讯录和短信那一侧。
 * 全是纯函数，返回新的 phoneState；没有要改的就返回 null（调用方据此跳过写库）。
 */

import type { CharacterProfile, PhoneContact, PhoneEvidence } from '../types';
import { normalizeContactGroup } from './contactGroups';
import { normName, upsertContact } from './relationshipChat';

type PhoneState = NonNullable<CharacterProfile['phoneState']>;

export interface LifeEpisode {
    kind: 'chat' | 'delivery' | 'order' | 'moment' | 'gift';
    with?: string;
    relation?: string;
    group?: string;
    lines?: { who: string; text: string }[];
    detail?: string;
    value?: string;
    /** gift：网购还是点外卖、要不要当惊喜、附言 */
    via?: 'net' | 'food';
    surprise?: boolean;
    note?: string;
}

export interface LifeEvent {
    messageId: string;
    createdAt: string;
    life: LifeEpisode;
}

const MINE = '我';
/** 一条记录里最多记多少个来源 id：只用来去重，太旧的不可能再被取回来。 */
const MAX_SOURCE_IDS = 50;

const RECORD_TYPE: Record<Exclude<LifeEpisode['kind'], 'chat' | 'gift'>, string> = {
    delivery: 'delivery',
    order: 'order',
    moment: 'social',
};

const clock = (at: number) =>
    new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 转成查手机聊天记录的「我: / 对方:」逐行格式（parseTranscript 认的就是这个）。 */
const toTranscript = (lines: NonNullable<LifeEpisode['lines']>) =>
    lines.map(line => `${line.who === MINE ? '我' : '对方'}: ${line.text.replace(/\n+/g, ' ')}`).join('\n');

const alreadyApplied = (records: PhoneEvidence[], messageId: string) =>
    records.some(record => record.id === `ag-${messageId}` || record.agentSourceIds?.includes(messageId));

export const applyLifeEpisode = (
    phone: CharacterProfile['phoneState'] | undefined,
    event: LifeEvent,
    { userName }: { userName?: string } = {},
): PhoneState | null => {
    const records = phone?.records ?? [];
    if (alreadyApplied(records, event.messageId)) return null;
    const at = Date.parse(event.createdAt) || Date.now();
    const { life } = event;

    if (life.kind === 'chat') {
        const name = life.with?.trim();
        const lines = (life.lines ?? []).filter(line => line.who?.trim() && line.text?.trim());
        if (!name || lines.length === 0) return null;
        if (userName && normName(name) === normName(userName)) return null;
        const contacts = phone?.contacts ?? [];
        const existing = contacts.find(contact => normName(contact.name) === normName(name));
        // 真人角色之间的对话要两边手机同步；单方面写一段会对不上，宁可不写。
        if (existing && (existing.kind === 'real' || existing.linkedCharId)) return null;
        // 被删、被拉黑的人不会突然又聊起来。
        if (existing && existing.status !== 'friend') return null;

        // 称呼和分组只给新认识的人定：已经在通讯录里的人，心跳随口一句不能改掉阿萌或扫描定下的称呼。
        const nextContacts = upsertContact(contacts, existing
            ? { name, lastInteraction: at }
            : {
                name,
                kind: 'npc',
                identity: life.relation?.trim() || undefined,
                group: normalizeContactGroup(life.group),
                lastInteraction: at,
            });
        const contact = nextContacts.find(item => normName(item.name) === normName(name)) as PhoneContact;
        const transcript = toTranscript(lines);
        const record = records.find(item => item.type === 'chat'
            && (item.contactId === contact.id || normName(item.title) === normName(name)));
        const nextRecords = record
            ? records.map(item => item.id !== record.id ? item : {
                ...item,
                contactId: contact.id,
                detail: item.detail ? `${item.detail}\n${transcript}` : transcript,
                timestamp: at,
                agentSourceIds: [...(item.agentSourceIds ?? []), event.messageId].slice(-MAX_SOURCE_IDS),
            })
            : [...records, {
                id: `ag-${event.messageId}`,
                type: 'chat',
                title: name,
                detail: transcript,
                timestamp: at,
                contactId: contact.id,
                agentSourceIds: [event.messageId],
            }];
        return { ...phone, records: nextRecords, contacts: nextContacts };
    }

    // 给阿萌买的东西：记在 TA 自己手机的淘宝 / 外卖里（TA 付的钱），投喂站那一单由 OSContext 另外落
    if (life.kind === 'gift') {
        const title = life.with?.trim();
        if (!title) return null;
        const who = userName || 'TA';
        const detail = [life.detail?.trim(), `送给${who}${life.surprise ? '的惊喜，还没告诉' + who : ''}`].filter(Boolean).join(' · ');
        return {
            ...phone,
            records: [...records, {
                id: `ag-${event.messageId}`,
                type: life.via === 'food' ? 'delivery' : 'order',
                title,
                detail,
                timestamp: at,
                ...(life.value?.trim() ? { value: life.value.trim() } : {}),
                agentSourceIds: [event.messageId],
            }],
        };
    }

    const type = RECORD_TYPE[life.kind];
    if (!type) return null;
    const detail = life.detail?.trim() ?? '';
    const title = life.kind === 'moment' ? clock(at) : life.with?.trim();
    if (!title || (life.kind === 'moment' && !detail)) return null;
    const record: PhoneEvidence = {
        id: `ag-${event.messageId}`,
        type,
        title,
        detail: detail || '…',
        timestamp: at,
        ...(life.value?.trim() && life.kind !== 'moment' ? { value: life.value.trim() } : {}),
        agentSourceIds: [event.messageId],
    };
    return { ...phone, records: [...records, record] };
};
// [EM-END: agent-life]
