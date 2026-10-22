// [EM-START: deep-talk]
/**
 * 烛下（深谈）里会落库、会发请求的动作：邀请、TA 的回答、重新点上、说一段、结束收卡。
 * 判断规则都在 deepTalk.ts，这里只管按顺序写库。
 */

import type { APIConfig, CharacterProfile, Message } from '../types';
import { DB } from './db';
import { safeFetchJson } from './safeApi';
import { resolveCharTimeZone } from './timezone';
import { AnticipationDB, MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { vectorizeAndStore } from './memoryPalace/vectorStore';
import type { EmbeddingConfig, MemoryNode, RemoteVectorConfig } from './memoryPalace/types';
import {
    buildCardContent,
    buildEndPrompt,
    buildTranscript,
    deepTalkEventText,
    formatClock,
    DEEP_TALK_CARD_KIND,
    DEEP_TALK_EVENT_KIND,
    DEEP_TALK_SOURCE,
    isDeepTalkMessage,
    keptLineMemoryContent,
    nextNightNo,
    padNight,
    parseEndResult,
    resolveLaterTime,
    type DeepTalkAnswer,
    type DeepTalkEvent,
    type DeepTalkKeptLine,
    type DeepTalkMaterials,
    type DeepTalkNight,
    type PastCandleNight,
} from './deepTalk';
import { DeepTalkDB, notifyDeepTalkChanged } from './deepTalkDb';

type Names = { userName: string; charName: string };
/** 记忆宫殿的向量配置：有就当场向量化，没有就先落盘，等消化时补 */
export type DeepTalkPalaceConfig = { embedding?: EmbeddingConfig | null; remote?: RemoteVectorConfig | null };

const END_TIMEOUT_MS = 90_000;

const saveEvent = (
    charId: string,
    night: DeepTalkNight,
    event: DeepTalkEvent,
    names: Names,
    extra: Record<string, unknown> = {},
): Promise<number> => DB.saveMessage({
    charId,
    // 邀请是阿萌的动作（触发一轮回复），其余是程序写的系统气泡
    role: event === 'invite' && night.invitedBy === 'user' ? 'user' : 'system',
    type: event === 'invite' && night.invitedBy === 'user' ? 'interaction' : 'text',
    content: `[${deepTalkEventText(event, { ...names, invitedBy: night.invitedBy })}]`,
    metadata: { kind: DEEP_TALK_EVENT_KIND, deepTalkEvent: event, deepTalkId: night.id, ...extra },
});

/** 这一夜的所有话（含已被记忆宫殿整理过的），按顺序 */
export const loadNightSegments = async (charId: string, nightId: string): Promise<Message[]> =>
    (await DB.getMessagesByCharId(charId, true))
        .filter(m => isDeepTalkMessage(m) && m.metadata.deepTalkId === nightId)
        .sort((a, b) => a.id - b.id);

/** 阿萌点蜡烛：有约好的就直接重新点上，否则发一个新邀请 */
export const startDeepTalkInvite = async (
    char: CharacterProfile,
    names: Names,
): Promise<{ night: DeepTalkNight; relit: boolean }> => {
    const active = await DeepTalkDB.getActive(char.id);
    if (active?.status === 'open') return { night: active, relit: false };
    if (active?.status === 'later') return { night: await relightDeepTalk(char, active, names), relit: true };
    if (active?.status === 'invited') {
        // 上一个邀请 TA 没接住（没带标记）：作废，重新邀请
        await DeepTalkDB.saveNight({ ...active, status: 'declined' });
    }
    const night: DeepTalkNight = {
        id: crypto.randomUUID(),
        charId: char.id,
        status: 'invited',
        invitedBy: 'user',
        invitedAt: Date.now(),
    };
    await DeepTalkDB.saveNight(night);
    await saveEvent(char.id, night, 'invite', names);
    return { night, relit: false };
};

/** 约好以后重新点上：TA 已经答应过，不再问一遍 */
export const relightDeepTalk = async (char: CharacterProfile, night: DeepTalkNight, names: Names): Promise<DeepTalkNight> => {
    const next: DeepTalkNight = { ...night, status: 'open', relit: true, startedAt: Date.now() };
    await DeepTalkDB.saveNight(next);
    await saveEvent(char.id, next, 'relight', names);
    return next;
};

/**
 * TA 对邀请的回答（回复已经照常落库之后调）。没带标记 = 没答应：不变纸，也不发「蜡烛先留着」。
 * 返回更新后的那一夜。
 */
export const applyDeepTalkAnswer = async (
    char: CharacterProfile,
    night: DeepTalkNight,
    answer: DeepTalkAnswer | null,
    names: Names,
    now = new Date(),
): Promise<DeepTalkNight> => {
    if (answer?.kind === 'accept') {
        const next: DeepTalkNight = { ...night, status: 'open', startedAt: now.getTime() };
        await DeepTalkDB.saveNight(next);
        return next;
    }
    if (answer?.kind === 'later') {
        const timeZone = resolveCharTimeZone(char);
        const laterAt = resolveLaterTime(answer.time, now, timeZone);
        if (laterAt) {
            const next: DeepTalkNight = { ...night, status: 'later', laterAt };
            await DeepTalkDB.saveNight(next);
            // 气泡上写 TA 那边的钟点，跟 TA 说的话对得上
            await saveEvent(char.id, next, 'later', names, { laterAt, laterClock: formatClock(laterAt, timeZone) });
            return next;
        }
    }
    const next: DeepTalkNight = { ...night, status: 'declined' };
    await DeepTalkDB.saveNight(next);
    if (answer) await saveEvent(char.id, next, 'declined', names);
    return next;
};

/** 深谈里说一段（阿萌的，或 TA 清洗过的那段） */
export const saveDeepTalkSegment = async (
    charId: string,
    nightId: string,
    role: 'user' | 'assistant',
    content: string,
    thinking?: string,
): Promise<number> => {
    const id = await DB.saveMessage({
        charId,
        role,
        type: 'text',
        content,
        // 思考只存在这条消息上：不进历史正文、深谈原文也不进记忆宫殿
        metadata: { source: DEEP_TALK_SOURCE, deepTalkId: nightId, ...(thinking ? { deepTalkThinking: thinking } : {}) },
    });
    notifyDeepTalkChanged(charId);
    return id;
};

/**
 * 蜡烛灭了：让 TA 起名字、写那句话和摘要，然后收成卡。
 * 一段话都没说就灭了的不算一夜，不收卡。名字生成失败也照样收卡（「第 N 夜」+ 空的一句话）。
 */
export const endDeepTalk = async (input: {
    char: CharacterProfile;
    night: DeepTalkNight;
    names: Names;
    api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
    reason?: 'end' | 'burnt_out';
    palace?: DeepTalkPalaceConfig | null;
}): Promise<DeepTalkNight> => {
    const { char, night, names, api } = input;
    const reason = input.reason || 'end';
    const segments = await loadNightSegments(char.id, night.id);
    const endedAt = Date.now();
    if (!segments.length) {
        const next: DeepTalkNight = { ...night, status: 'declined', endedAt };
        await DeepTalkDB.saveNight(next);
        await saveEvent(char.id, next, reason, names);
        return next;
    }

    let result = null as ReturnType<typeof parseEndResult>;
    if (api.baseUrl) {
        const prompt = buildEndPrompt(names, buildTranscript(segments, names));
        for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
            try {
                const data = await safeFetchJson(
                    `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
                        body: JSON.stringify({
                            model: api.model,
                            messages: [
                                { role: 'system', content: `你是${names.charName}。` },
                                { role: 'user', content: prompt },
                            ],
                            temperature: 0.7,
                        }),
                    },
                    0,
                    END_TIMEOUT_MS,
                    { appId: 'chat', appName: '消息', charId: char.id, charName: char.name, purpose: '烛下收尾' },
                );
                const content = data?.choices?.[0]?.message?.content;
                result = typeof content === 'string' ? parseEndResult(content, segments) : null;
            } catch (error) {
                console.warn('[DeepTalk] 收尾生成失败', error);
            }
        }
    }

    const nightNo = nextNightNo(await DeepTalkDB.listNights(char.id));
    const next: DeepTalkNight = {
        ...night,
        status: 'closed',
        endedAt,
        burntOut: reason === 'burnt_out' || undefined,
        nightNo,
        title: result?.title || `第 ${padNight(nightNo)} 夜`,
        oneLine: result?.oneLine || '',
        summary: result?.summary || '',
        candleSummary: result?.candleSummary || '',
        kept: [],
        segmentCount: segments.length,
    };
    // 原文不进记忆宫殿（说真话的夜），只把 TA 挑的那一两句写进去，平时想得起原话
    for (const line of result?.kept || []) {
        // palace 传 null = 这个角色没开记忆宫殿：原话只留在这一夜的记录里
        const memoryId = input.palace === null ? undefined
            : await saveKeptLineToPalace(char.id, line, names.userName, input.palace).catch(() => undefined);
        next.kept!.push({ ...line, ...(memoryId ? { memoryId } : {}) });
    }
    await DeepTalkDB.saveNight(next);
    await saveEvent(char.id, next, reason, names);
    await DB.saveMessage({
        charId: char.id,
        role: 'system',
        type: 'text',
        content: buildCardContent(next),
        metadata: { kind: DEEP_TALK_CARD_KIND, deepTalkId: next.id },
    });
    return next;
};

/** 困扰的原料：阁楼（没想通的事）最多 3 条、窗台（期盼）最多 2 条，按重要程度和新近排 */
export const loadDeepTalkMaterials = async (charId: string): Promise<DeepTalkMaterials> => {
    const byWeight = <T extends { importance?: number; createdAt?: number }>(a: T, b: T) =>
        (b.importance || 0) - (a.importance || 0) || (b.createdAt || 0) - (a.createdAt || 0);
    const [attic, hopes] = await Promise.all([
        MemoryNodeDB.getByRoom(charId, 'attic').catch(() => []),
        AnticipationDB.getActive(charId).catch(() => []),
    ]);
    return {
        attic: [...attic].sort(byWeight).slice(0, 3).map(n => n.content),
        windowsill: [...(hopes as { content?: string; createdAt?: number }[])]
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, 2)
            .map(h => h.content || '')
            .filter(Boolean),
    };
};
/** 之前几夜在烛下真正聊过的，最近的三夜（开着的深谈里给 TA 看） */
export const loadPastCandleNights = async (charId: string, excludeId?: string): Promise<PastCandleNight[]> =>
    (await DeepTalkDB.listClosed(charId)).filter(n => n.id !== excludeId).slice(0, 3);

/** 带回平时的一句话写成 TA 的一条卧室记忆；返回记忆 id（被判重复就没有） */
export const saveKeptLineToPalace = async (
    charId: string,
    line: Pick<DeepTalkKeptLine, 'speaker' | 'text'>,
    userName: string,
    palace?: DeepTalkPalaceConfig,
): Promise<string | undefined> => {
    const now = Date.now();
    const node: MemoryNode = {
        id: `mn_${now}_${Math.random().toString(36).slice(2, 8)}`,
        charId,
        content: keptLineMemoryContent(line, userName),
        room: 'bedroom',
        tags: ['烛下', '原话'],
        importance: 7,
        mood: 'tender',
        embedded: false,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        origin: 'system',
    };
    const embedding = palace?.embedding;
    if (embedding?.baseUrl && embedding.apiKey) {
        try {
            const { stored } = await vectorizeAndStore([node], embedding, palace?.remote || undefined);
            return stored ? node.id : undefined;
        } catch (error) {
            console.warn('[DeepTalk] 原话向量化失败，先存下来等消化时补', error);
        }
    }
    await MemoryNodeDB.save(node);
    return node.id;
};

/** 阿萌在信笺里删掉一句不想让 TA 带回去的：连那条记忆一起删 */
export const removeKeptLine = async (night: DeepTalkNight, index: number, remote?: RemoteVectorConfig | null): Promise<DeepTalkNight> => {
    const line = night.kept?.[index];
    if (!line) return night;
    if (line.memoryId) {
        const memoryId = line.memoryId;
        await Promise.all([MemoryVectorDB.delete(memoryId), MemoryNodeDB.delete(memoryId)]).catch(() => {});
        if (remote?.enabled && remote.initialized) {
            void import('./memoryPalace/supabaseVector').then(({ deleteVector }) => deleteVector(remote, memoryId)).catch(() => {});
        }
    }
    const next: DeepTalkNight = { ...night, kept: (night.kept || []).filter((_, i) => i !== index) };
    await DeepTalkDB.saveNight(next);
    return next;
};
// [EM-END: deep-talk]
