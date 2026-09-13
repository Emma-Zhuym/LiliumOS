import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
import { StoryVariantStore } from './storyVariantStore';
import { generateStoryVariantCard, generateStoryVariantTurn, buildStoryVariantArchiveMarkdown, buildStoryVariantCharacterShareText } from './storyVariant';
import { STORY_VARIANT_OPTIONS, STORY_WORLD_OPTIONS, randomStoryVariantCombination } from './storyVariantCatalog';
import { safeFetchJson } from './safeApi';
import type { CharacterProfile, UserProfile, APIConfig } from '../types';

vi.mock('./safeApi', async importOriginal => ({ ...await importOriginal<typeof import('./safeApi')>(), safeFetchJson: vi.fn() }));
const char = { id: 'variant-test-char', name: '角色', systemPrompt: '保留我的说话方式', avatar: '', chatApiPresetId: 'own' } as CharacterProfile;
const userProfile = { name: '测试用户', bio: '现实身份仅用于创建面具' } as UserProfile;
const apiConfig = { baseUrl: 'https://global.invalid/v1', model: 'global', apiKey: 'fake-global' } as APIConfig;
const apiPresets = [{ id: 'own', name: '角色预设', config: { ...apiConfig, baseUrl: 'https://character.invalid/v1', model: 'own', apiKey: 'fake-own' } }];
const profile = Object.fromEntries(['title', 'logline', 'identity', 'lifePatch', 'relationship', 'steelSeal', 'patchCost', 'behaviorShift', 'userMaskTitle', 'userIdentity', 'userLifePatch', 'openingScene', 'openingLine', 'playerPrompt', 'worldName', 'worldPremise', 'arrivalPoint', 'activeCrisis', 'sharedObjective', 'countdown', 'hiddenTruth', 'climaxChoice'].map(key => [key, `设定-${key}`]));
const reply = { worldNarration: '门外传来脚步声。', character: '先坐一会儿吧。', directorState: { sceneFacts: ['门关着'], openThreads: [], offscreenFacts: ['未公开的世界秘密'], declinedHooks: [], revealedFacts: [] } };
const respond = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] });
beforeEach(async () => {
    vi.restoreAllMocks(); vi.mocked(safeFetchJson).mockReset(); localStorage.clear();
    const db = await openDB();
    await new Promise<void>((resolve, reject) => { const tx = db.transaction(['story_variants', 'messages', 'characters'], 'readwrite'); for (const name of ['story_variants', 'messages', 'characters']) tx.objectStore(name).clear(); tx.objectStore('characters').put(char); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
});

describe('独立异格的请求、保存与备份', () => {
    it('直接选择和随机不请求模型；一次创建一次续写，保存失败后的重试不再生成', async () => {
        expect([STORY_VARIANT_OPTIONS.length, STORY_WORLD_OPTIONS.length]).toEqual([25, 24]);
        const combination = randomStoryVariantCombination();
        expect(safeFetchJson).not.toHaveBeenCalled();
        vi.mocked(safeFetchJson).mockResolvedValueOnce(respond(profile)).mockResolvedValueOnce(respond(reply));
        const card = await generateStoryVariantCard({ char, userProfile, apiConfig, apiPresets, ...combination });
        expect(vi.mocked(safeFetchJson).mock.calls[0][0]).toBe('https://character.invalid/v1/chat/completions');
        await StoryVariantStore.saveCard(card);
        const run = await StoryVariantStore.start(card.id);
        const result = await generateStoryVariantTurn({ card, run, char, userProfile, apiConfig, apiPresets, userText: '我走到窗边。' });
        const body = JSON.parse(String(vi.mocked(safeFetchJson).mock.calls[1][1]?.body));
        expect(JSON.stringify(body)).not.toContain(userProfile.bio);
        const original = IDBObjectStore.prototype.add;
        const fail = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, value: any, key?: IDBValidKey) {
            if (this.name === 'messages' && value.role === 'assistant') throw new Error('模拟落盘失败');
            return original.call(this, value, key);
        });
        await expect(StoryVariantStore.commitTurn(result)).rejects.toThrow('模拟落盘失败'); fail.mockRestore();
        expect(await StoryVariantStore.messages(run.id)).toHaveLength(0);
        expect((await StoryVariantStore.getRun(run.id)).interactionsUsed).toBe(0);
        await StoryVariantStore.commitTurn(result); await StoryVariantStore.commitTurn(result);
        expect(await StoryVariantStore.messages(run.id)).toHaveLength(2);
        expect(safeFetchJson).toHaveBeenCalledTimes(2);
        const archived = await StoryVariantStore.archive(run.id), messages = await StoryVariantStore.messages(run.id);
        const share = buildStoryVariantCharacterShareText(card, archived, messages, userProfile.name);
        expect(buildStoryVariantArchiveMarkdown(card, archived, messages, userProfile.name) + share).not.toContain('未公开的世界秘密');
        await StoryVariantStore.share(run.id, share); await StoryVariantStore.share(run.id, share);
        expect(await DB.countMessagesByCharId(char.id)).toBe(1);
        expect(safeFetchJson).toHaveBeenCalledTimes(2);
    });

    it('第 50 轮封存，备份恢复保留身份、全部正文和连续性；旧主历史恢复清理已失去正文的状态', async () => {
        vi.mocked(safeFetchJson).mockResolvedValueOnce(respond(profile));
        const card = await generateStoryVariantCard({ char, userProfile, apiConfig, apiPresets, variantId: 'variant-01', storyId: 'story-01' });
        await StoryVariantStore.saveCard(card); let run = await StoryVariantStore.start(card.id);
        for (let index = 0; index < 50; index++) run = await StoryVariantStore.commitTurn({ runId: run.id, cardId: card.id, expectedTurn: index, operationId: `turn-${index}`, userText: `继续 ${index}`, reply });
        expect(run.status).toBe('archived');
        const exported = await DB.exportFullData();
        expect(exported.storyVariants).toHaveLength(2);
        const backup = { characters: [char], storyVariants: exported.storyVariants, messages: exported.messages };
        await DB.importFullData(JSON.parse(JSON.stringify(backup)));
        expect((await StoryVariantStore.getRun(run.id)).interactionsUsed).toBe(50);
        const messages = await StoryVariantStore.messages(run.id);
        expect(messages).toHaveLength(100);
        expect(messages.at(-1)?.metadata?.storyVariantDirectorState.offscreenFacts).toEqual(['未公开的世界秘密']);
        await DB.importFullData({ version: 72, timestamp: Date.now(), characters: [char], messages: [] });
        expect(await StoryVariantStore.list()).toEqual([]);
    });
});
