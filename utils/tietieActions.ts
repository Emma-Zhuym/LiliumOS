/**
 * 贴贴事后记录里会落库、会发请求的动作：写这一次（含重写）、删掉 TA 记住的那条。
 * 规则都在 tietie.ts，这里只管按顺序写。
 */

import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import { safeFetchJson } from './safeApi';
import { ContextBuilder } from './context';
import { MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { vectorizeAndStore } from './memoryPalace/vectorStore';
import type { EmbeddingConfig, MemoryNode, RemoteVectorConfig } from './memoryPalace/types';
import {
    TIETIE_CARD_KIND,
    buildTietieCardContent,
    buildTietieMaterials,
    buildTietiePrompt,
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

const requestRecord = async (
    char: CharacterProfile,
    api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
    prompt: string,
): Promise<TietieResult | null> => {
    if (!api.baseUrl) return null;
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
            if (result) return result;
        } catch (error) {
            console.warn('[Tietie] 事后记录生成失败', error);
        }
    }
    return null;
};

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
        if (existing?.status === 'done') return existing;

        const names = { userName: user.name || '我', charName: char.name };
        const all = await DB.getMessagesByCharId(char.id, true);
        const { lead, inside } = buildTietieMaterials(all, { startedAt, endedAt }, names);
        const history = await TietieDB.list(char.id);
        const recentMemories = history.filter(r => r.status === 'done' && r.memory && r.id !== id).slice(-3).map(r => r.memory!);
        let persona = '';
        try { persona = ContextBuilder.buildCoreContext(char, user, false); } catch { /* 拼不出人设就只靠名字 */ }

        const result = await requestRecord(char, api, buildTietiePrompt({
            names, persona, lead, inside, startedAt, endedAt, endedBy, recentMemories,
        }));

        const base: TietieRecord = existing || { id, charId: char.id, status: 'failed', startedAt, endedAt, endedBy, createdAt: Date.now() };
        const record: TietieRecord = result
            ? { ...base, ...result, minutes: result.minutes ?? undefined, status: 'done', no: base.no || nextTietieNo(history) }
            : { ...base, status: 'failed' };
        if (result && palace) {
            record.memoryId = await saveMemory(char.id, result.memory, palace).catch(() => undefined);
        }

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
