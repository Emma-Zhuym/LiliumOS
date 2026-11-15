/**
 * 贴贴事后记录里会落库、会发请求的动作：写这一次（含重写）、删掉 TA 记住的那条。
 * 规则都在 tietie.ts，这里只管按顺序写。
 */

import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import { safeFetchJson } from './safeApi';
import { MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { vectorizeAndStore } from './memoryPalace/vectorStore';
import type { EmbeddingConfig, MemoryNode, RemoteVectorConfig } from './memoryPalace/types';
import {
    TIETIE_CARD_KIND,
    buildTietieCardContent,
    buildTietieMaterials,
    buildTietiePersona,
    buildTietiePrompt,
    clearTietieSessionIf,
    nextTietieNo,
    parseTietieResult,
    tietieRecordId,
    type TietieRecord,
    type TietieResult,
} from './tietie';
import { TietieDB } from './tietieDb';

/** 记忆宫殿的向量配置；null = 这个角色没开记忆宫殿，记忆不写 */
export type TietiePalaceConfig = { embedding?: EmbeddingConfig | null; remote?: RemoteVectorConfig | null } | null;

const WRITE_TIMEOUT_MS = 120_000;

/** 同一次正在写就别再写一份（结束事件和补写可能撞上） */
const writing = new Set<string>();

/** 写不出来时把原因带回来，卡上直接写给她看 */
type TietieRequest = { result: TietieResult; error?: undefined } | { result: null; error: string };

const describeError = (error: unknown): string => {
    const text = String((error as { message?: string })?.message || error || '');
    if (/abort|timeout|超时/i.test(text)) return '等太久没回音';
    const status = text.match(/\b([45]\d\d)\b/)?.[1];
    if (status) return `模型返回 ${status}`;
    return text.slice(0, 60) || '请求失败';
};

const requestRecord = async (
    char: CharacterProfile,
    api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
    prompt: string,
): Promise<TietieRequest> => {
    if (!api.baseUrl) return { result: null, error: '这个角色没接 API' };
    let error = '没按格式写';
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const data = await safeFetchJson(
                `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
                    body: JSON.stringify({
                        model: api.model,
                        messages: [
                            { role: 'system', content: `你是${char.name}。` },
                            { role: 'user', content: prompt },
                        ],
                        temperature: 0.85,
                    }),
                },
                0,
                WRITE_TIMEOUT_MS,
                { appId: 'chat', appName: '消息', charId: char.id, charName: char.name, purpose: '贴贴事后记录' },
            );
            const content = data?.choices?.[0]?.message?.content;
            const result = typeof content === 'string' ? parseTietieResult(content) : null;
            if (result) return { result };
            error = typeof content === 'string' && content.trim() ? '没按格式写（可能拒绝了）' : '回了空的';
        } catch (e) {
            console.warn('[Tietie] 事后记录生成失败', e);
            error = describeError(e);
        }
    }
    return { result: null, error };
};

/** 这一页里是不是正在写这一次：不在写的 writing 记录是上次页面中途被杀留下的，卡上按没写出来算 */
export const isTietieWriting = (id: string) => writing.has(id);

const saveMemory = async (charId: string, content: string, palace: NonNullable<TietiePalaceConfig>): Promise<string | undefined> => {
    const now = Date.now();
    const node: MemoryNode = {
        id: `mn_${now}_${Math.random().toString(36).slice(2, 8)}`,
        charId,
        content,
        room: 'bedroom',
        tags: ['贴贴'],
        importance: 7,
        mood: 'tender',
        embedded: false,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        origin: 'system',
    };
    const embedding = palace.embedding;
    if (embedding?.baseUrl && embedding.apiKey) {
        try {
            const { stored } = await vectorizeAndStore([node], embedding, palace.remote || undefined);
            return stored ? node.id : undefined;
        } catch (error) {
            console.warn('[Tietie] 记忆向量化失败，先存下来等消化时补', error);
        }
    }
    await MemoryNodeDB.save(node);
    return node.id;
};

/**
 * 写这一次。已经写成功过就直接返回那一份；失败过的再调就是重写，聊天里那张卡原地更新。
 * 写成功：卡片 + TA 事后的一两句话 + 一条卧室记忆。写不出来：照样落卡，卡上能点重写。
 */
export const writeTietieRecord = async (input: {
    char: CharacterProfile;
    user: UserProfile;
    api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
    palace: TietiePalaceConfig;
    startedAt: number;
    endedAt: number;
    endedBy: 'manual' | 'timeout';
}): Promise<TietieRecord | null> => {
    const { char, user, api, palace, startedAt, endedAt, endedBy } = input;
    const id = tietieRecordId(char.id, startedAt);
    if (writing.has(id)) return null;
    writing.add(id);
    try {
        const existing = await TietieDB.get(id);
        if (existing?.status === 'done') {
            clearTietieSessionIf(char.id, startedAt);
            return existing;
        }

        // 先把卡落下来再调 API：写一次要好几分钟，中途切走、页面被杀，至少聊天里留着一张能重写的卡
        let record: TietieRecord = {
            ...(existing || { id, charId: char.id, startedAt, endedAt, endedBy, createdAt: Date.now() }),
            status: 'writing',
            error: undefined,
        };
        const saveCard = async () => {
            const cardContent = buildTietieCardContent(record);
            if (record.cardMessageId) {
                await DB.updateMessage(record.cardMessageId, cardContent);
            } else {
                record.cardMessageId = await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: cardContent,
                    metadata: { kind: TIETIE_CARD_KIND, tietieId: id },
                });
            }
            await TietieDB.save(record);
        };
        await saveCard();
        // 卡在库里了，本机记的开始时刻才能清；清早了、卡又没落下，这一次就无影无踪
        clearTietieSessionIf(char.id, startedAt);

        let request: TietieRequest;
        let history: TietieRecord[] = [];
        try {
            const names = { userName: user.name || '我', charName: char.name };
            const all = await DB.getMessagesByCharId(char.id, true);
            const { lead, inside } = buildTietieMaterials(all, { startedAt, endedAt }, names);
            history = await TietieDB.list(char.id);
            const lastMemory = history.filter(r => r.status === 'done' && r.memory && r.id !== id).slice(-1)[0]?.memory;
            const persona = buildTietiePersona(char, user, [lead, inside]);
            request = await requestRecord(char, api, buildTietiePrompt({
                names, persona, lead, inside, startedAt, endedAt, endedBy, lastMemory,
            }));
        } catch (e) {
            console.warn('[Tietie] 准备材料失败', e);
            request = { result: null, error: describeError(e) };
        }

        const result = request.result;
        record = result
            ? { ...record, ...result, minutes: result.minutes ?? undefined, status: 'done', error: undefined, no: record.no || nextTietieNo(history) }
            : { ...record, status: 'failed', error: request.error };
        if (result && palace) {
            record.memoryId = await saveMemory(char.id, result.memory, palace).catch(() => undefined);
        }
        await saveCard();
        // TA 先开口：她接着回就好，不用再说「刚才好喜欢」
        for (const line of record.status === 'done' ? record.after || [] : []) {
            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: line });
        }
        return record;
    } finally {
        writing.delete(id);
    }
};

/**
 * 这次不算（副 API 猜错了开的、按错了还是写了）：日记、卧室记忆、聊天里那张卡一起删。
 * TA 事后说的那一两句是普通消息，留在聊天里，她想删就长按删。之后的「第几次」按剩下的算。
 */
export const discardTietieRecord = async (record: TietieRecord, remote?: RemoteVectorConfig | null): Promise<void> => {
    await forgetTietieMemory(record, remote);
    if (record.cardMessageId) await DB.deleteMessage(record.cardMessageId).catch(() => {});
    await TietieDB.remove(record);
};

/**
 * 她不想让 TA 记住这一次的细节：删那条卧室记忆（本地向量、远程向量一起），
 * 聊天里那张卡给上下文的那一行也去掉细节。日记本身留着。
 */
export const forgetTietieMemory = async (record: TietieRecord, remote?: RemoteVectorConfig | null): Promise<TietieRecord> => {
    if (!record.memory) return record;
    const memoryId = record.memoryId;
    if (memoryId) {
        await Promise.all([MemoryVectorDB.delete(memoryId), MemoryNodeDB.delete(memoryId)]).catch(() => {});
        if (remote?.enabled && remote.initialized) {
            void import('./memoryPalace/supabaseVector').then(({ deleteVector }) => deleteVector(remote, memoryId)).catch(() => {});
        }
    }
    const next: TietieRecord = { ...record, memory: undefined, memoryId: undefined };
    if (next.cardMessageId) await DB.updateMessage(next.cardMessageId, buildTietieCardContent(next));
    await TietieDB.save(next);
    return next;
};
