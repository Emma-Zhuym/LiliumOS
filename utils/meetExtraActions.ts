// [EM-START: meet-extra]
/**
 * 番外里会落库、会发请求的动作：写一篇（含重写、接着写）、写总结、分享到聊天。
 * 规则都在 meetExtra.ts，这里只管按顺序做。契约 docs/spec-meet-extra.md。
 *
 * 先落库再调 API（贴贴踩过的坑）：写一篇要一两分钟，中途切走、页面被杀，书架上至少留着一本「没写完」的。
 */
import type { APIConfig, CharacterProfile, Message, UserProfile } from '../types';
import { ContextBuilder } from './context';
import { DB } from './db';
import { safeFetchJson } from './safeApi';
import { loadCharacterContextRange } from './chatContextRange';
import { formatChatHistoryForSchedule, recentMessagesForSchedule } from './scheduleGenerator';
import { injectMemoryPalace } from './memoryPalace/pipeline';
import {
    MEET_EXTRA_CARD_KIND,
    MEET_EXTRA_LENGTHS,
    buildMeetExtraContinueNote,
    buildMeetExtraSummaryPrompt,
    buildMeetExtraTask,
    countExtraChars,
    joinExtraParts,
    meetExtraCardContent,
    meetExtraId,
    needsExtraContinue,
    splitExtraTitle,
    type MeetExtra,
    type MeetExtraCardMeta,
    type MeetExtraLength,
    type MeetExtraMemory,
    type MeetExtraPov,
} from './meetExtra';
import { MeetExtraDB } from './meetExtraDb';

type Api = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'> & { temperature?: number };

// ── 正在写的那几本：流到哪了（不每个字都写库），页面订阅 LIVE 事件读 ──
export const MEET_EXTRA_LIVE_EVENT = 'em-meet-extra-live';
const live = new Map<string, string>();
const controllers = new Map<string, AbortController>();

const announceLive = (id: string) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MEET_EXTRA_LIVE_EVENT, { detail: { id } }));
};

/** 这一页里正在写这本吗；书架上 status=writing 但这里没有的，是上次页面中途关了 */
export const isMeetExtraWriting = (id: string) => controllers.has(id);
/** 正在写的那本流到哪了（含标题行的原始输出） */
export const meetExtraLiveText = (id: string) => live.get(id);

export const stopMeetExtra = (id: string) => controllers.get(id)?.abort();

const describeError = (error: unknown): string => {
    const text = String((error as { message?: string })?.message || error || '');
    if (/abort/i.test(text)) return '停下了';
    if (/timeout|超时/i.test(text)) return '等太久没回音';
    const status = text.match(/\b([45]\d\d)\b/)?.[1];
    if (status) return `模型返回 ${status}`;
    return text.slice(0, 60) || '请求失败';
};

/** 番外不读「现在」：去掉时间、情绪 buff、印象档案外的临时状态；persona 档连记忆一起去掉 */
const storyChar = (char: CharacterProfile, memory: MeetExtraMemory): CharacterProfile => {
    const base: CharacterProfile = { ...char, buffInjection: undefined, memoryPalaceInjection: undefined };
    if (memory === 'together') return base;
    return {
        ...base,
        refinedMemories: undefined,
        memories: [],
        activeMemoryMonths: [],
        impression: undefined,
        memoryPalaceEnabled: false,
        roomPlatesInjection: undefined,
        selfInsights: undefined,
    } as CharacterProfile;
};

/** 番外里不该出现的聊天：深谈原文、出戏的话、别的番外卡 */
const usableChat = (m: Message) => m.metadata?.source !== 'deep_talk' && !m.metadata?.ooc && m.metadata?.kind !== MEET_EXTRA_CARD_KIND;

/** system 提示：角色设定 + 她的人设（两档都带）；together 档再带记忆、召回、最近一天半的聊天 */
export const buildMeetExtraSystem = async (char: CharacterProfile, user: UserProfile, memory: MeetExtraMemory, synopsis: string): Promise<string> => {
    const story = storyChar(char, memory);
    if (memory === 'persona') {
        return ContextBuilder.buildCoreContext(story, user, false, undefined, undefined, { skipTimeAwareness: true });
    }
    const recent = recentMessagesForSchedule(
        await loadCharacterContextRange(char).then(s => s.messages).catch(() => [] as Message[]),
    ).filter(usableChat);
    try {
        await injectMemoryPalace(story as any, recent, synopsis, user?.name);
    } catch (error) {
        console.warn('[MeetExtra] 记忆召回失败，不带召回接着写', error);
    }
    const core = ContextBuilder.buildCoreContext(story, user, true, undefined, undefined, { skipTimeAwareness: true, worldbookMessages: recent });
    const emojis = await DB.getEmojis().catch(() => []);
    const chat = formatChatHistoryForSchedule(recent, char, user, emojis);
    return chat ? `${core}\n\n### 你们最近的聊天（现实里的，供你把握两个人现在的样子）\n${chat}` : core;
};

const callModel = async (input: {
    char: CharacterProfile;
    api: Api;
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    maxTokens: number;
    signal?: AbortSignal;
    onText?: (text: string) => void;
    purpose: string;
    temperature?: number;
}): Promise<{ text: string; finishReason?: string }> => {
    const { char, api } = input;
    if (!api.baseUrl) throw new Error('这个角色没接 API');
    const data = await safeFetchJson(
        `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: api.model,
                messages: input.messages,
                temperature: input.temperature ?? api.temperature ?? 0.9,
                max_tokens: input.maxTokens,
                stream: !!input.onText,
            }),
            signal: input.signal,
        },
        0,
        0,
        { appId: 'date', appName: '见面', charId: char.id, charName: char.name, purpose: input.purpose },
        input.onText ? { onDelta: (_d, full) => input.onText!(full) } : undefined,
    );
    const choice = data?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    return { text, finishReason: choice?.finish_reason };
};

/** 新建一本：先落库（status=writing），再开写 */
export const createMeetExtra = async (input: {
    char: CharacterProfile;
    user: UserProfile;
    api: Api;
    synopsis: string;
    memory: MeetExtraMemory;
    length: MeetExtraLength;
    pov: MeetExtraPov;
    extra?: string;
}): Promise<MeetExtra> => {
    const now = Date.now();
    const row: MeetExtra = {
        id: meetExtraId(now),
        charId: input.char.id,
        title: splitExtraTitle('', input.synopsis).title,
        synopsis: input.synopsis.trim(),
        memory: input.memory,
        length: input.length,
        pov: input.pov,
        extra: input.extra?.trim() || undefined,
        body: '',
        status: 'writing',
        createdAt: now,
        updatedAt: now,
    };
    await MeetExtraDB.save(row);
    void writeMeetExtra({ char: input.char, user: input.user, api: input.api, id: row.id, mode: 'fresh' });
    return row;
};

/**
 * 写这一本。mode：fresh = 从头写（新建 / 重写），continue = 接着已有正文往下写（可带一句提示）。
 * 断在半截会自动接，最多两次。写的过程中每 1.5 秒存一次库，停了 / 失败了也留着已经写出来的。
 */
export const writeMeetExtra = async (input: {
    char: CharacterProfile;
    user: UserProfile;
    api: Api;
    id: string;
    mode: 'fresh' | 'continue';
    hint?: string;
}): Promise<void> => {
    const { char, user, api, id } = input;
    if (controllers.has(id)) return;
    const existing = await MeetExtraDB.get(id);
    if (!existing) return;
    const controller = new AbortController();
    controllers.set(id, controller);

    let row: MeetExtra = { ...existing, status: 'writing', error: undefined, short: undefined, updatedAt: Date.now() };
    if (input.mode === 'fresh') row = { ...row, body: '', summary: undefined };
    await MeetExtraDB.save(row);

    let lastSave = Date.now();
    const persist = async (force = false) => {
        if (!force && Date.now() - lastSave < 1500) return;
        lastSave = Date.now();
        await MeetExtraDB.save({ ...row, updatedAt: Date.now() }, { quiet: !force });
    };

    try {
        const system = await buildMeetExtraSystem(char, user, row.memory, row.synopsis);
        const task = buildMeetExtraTask({
            charName: char.name, userName: user?.name || '', synopsis: row.synopsis,
            memory: row.memory, length: row.length, pov: row.pov, extra: row.extra,
        });
        const size = MEET_EXTRA_LENGTHS[row.length];
        let attempts = 0;
        let needMore = input.mode === 'continue';
        let rawTitleLine = row.body ? `# ${row.title}\n\n` : '';

        if (input.mode === 'fresh') {
            const first = await callModel({
                char, api, maxTokens: size.maxTokens, signal: controller.signal, purpose: '番外',
                messages: [{ role: 'system', content: system }, { role: 'user', content: task }],
                onText: text => {
                    const { title, body } = splitExtraTitle(text, row.synopsis);
                    row = { ...row, title, body };
                    live.set(id, body);
                    announceLive(id);
                    void persist();
                },
            });
            const { title, body } = splitExtraTitle(first.text, row.synopsis);
            row = { ...row, title, body };
            rawTitleLine = `# ${title}\n\n`;
            needMore = needsExtraContinue(body, first.finishReason, row.length, attempts);
        }

        while (needMore) {
            const before = row.body;
            const next = await callModel({
                char, api, maxTokens: size.maxTokens, signal: controller.signal, purpose: '番外 · 接着写',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: task },
                    { role: 'assistant', content: `${rawTitleLine}${before}` },
                    { role: 'user', content: buildMeetExtraContinueNote(attempts === 0 ? input.hint : undefined) },
                ],
                onText: text => {
                    row = { ...row, body: joinExtraParts(before, text) };
                    live.set(id, row.body);
                    announceLive(id);
                    void persist();
                },
            });
            row = { ...row, body: joinExtraParts(before, next.text) };
            attempts += 1;
            needMore = needsExtraContinue(row.body, next.finishReason, row.length, attempts);
        }

        if (!row.body.trim()) throw new Error('回了空的（可能拒绝了）');
        row = { ...row, status: 'done', short: countExtraChars(row.body) < size.min * 0.8 || undefined, updatedAt: Date.now() };
    } catch (error) {
        console.warn('[MeetExtra] 番外没写完', error);
        row = { ...row, status: row.body.trim() ? 'done' : 'failed', error: describeError(error), short: row.body.trim() ? true : undefined, updatedAt: Date.now() };
    } finally {
        controllers.delete(id);
        live.delete(id);
        await MeetExtraDB.save(row);
        announceLive(id);
    }
};

/** 总结：分享时才写（一次便宜调用），写完回填书架和聊天里那张卡 */
export const summarizeMeetExtra = async (input: { char: CharacterProfile; user: UserProfile; api: Api; id: string; cardMessageId?: number }): Promise<string | undefined> => {
    const row = await MeetExtraDB.get(input.id);
    if (!row?.body.trim()) return undefined;
    let summary = row.summary;
    if (!summary) {
        try {
            const { text } = await callModel({
                char: input.char, api: input.api, maxTokens: 1200, purpose: '番外 · 总结', temperature: 0.3,
                messages: [{ role: 'user', content: buildMeetExtraSummaryPrompt(row, input.char.name, input.user?.name || '') }],
            });
            summary = text.trim() || undefined;
        } catch (error) {
            console.warn('[MeetExtra] 总结没写出来，聊天里先用开头顶着', error);
        }
        if (!summary) return undefined;
        await MeetExtraDB.save({ ...row, summary, updatedAt: Date.now() });
    }
    if (input.cardMessageId) {
        await DB.updateMessageMetadata(input.cardMessageId, prev => ({
            ...(prev || {}),
            meetExtra: { ...(prev?.meetExtra || {}), summary },
        }));
        await DB.updateMessage(input.cardMessageId, meetExtraCardContent(row.title, summary));
    }
    return summary;
};

/** 分享到这个角色的私聊：插一张卡（她发的），总结在后台补上，不等它 */
export const shareMeetExtra = async (input: { char: CharacterProfile; user: UserProfile; api: Api; id: string }): Promise<number | null> => {
    const row = await MeetExtraDB.get(input.id);
    if (!row || row.status !== 'done' || !row.body.trim()) return null;
    const card: MeetExtraCardMeta = { id: row.id, title: row.title, synopsis: row.synopsis, body: row.body, summary: row.summary };
    const messageId = await DB.saveMessage({
        charId: row.charId,
        role: 'user',
        type: 'text',
        content: meetExtraCardContent(row.title, row.summary),
        metadata: { kind: MEET_EXTRA_CARD_KIND, meetExtra: card },
    });
    await MeetExtraDB.save({ ...row, sharedAt: Date.now(), updatedAt: Date.now() });
    if (!row.summary) void summarizeMeetExtra({ ...input, cardMessageId: messageId });
    return messageId;
};
// [EM-END: meet-extra]
