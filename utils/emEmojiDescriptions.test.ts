// [EM-START: emoji-descriptions]
import { describe, expect, it } from 'vitest';

import type { APIConfig, ApiPreset, Emoji } from '../types';
import { ChatPrompts } from './chatPrompts';
import { DB } from './db';
import {
    cleanEmojiDescription, describeEmojisInBatch, emojisMissingDescription, listEmojiVisionChoices, pickEmojiVisionChoice,
    stickerLabelWithDescription,
} from './emEmojiDescriptions';

const DOG = 'blobref:b_dog';
const emojis: Emoji[] = [
    { name: '乖乖当狗', url: DOG, description: '一只小狗叼着空食盆，眼巴巴往上看' },
    { name: '亲亲', url: 'blobref:b_kiss' },
];

describe('给角色看的那一行', () => {
    it('有描述就带上，没有就只有名字；描述清掉前缀、压成一行、限长', () => {
        expect(stickerLabelWithDescription('乖乖当狗', '一只小狗')).toBe('乖乖当狗（图上：一只小狗）');
        expect(stickerLabelWithDescription('亲亲', '  ')).toBe('亲亲');
        expect(cleanEmojiDescription('描述：一只\n小狗')).toBe('一只 小狗');
        expect(cleanEmojiDescription('字'.repeat(300))).toHaveLength(120);
    });

    it('私聊：只在阿萌发的表情后带描述，角色自己发的仍只有名字', () => {
        const char = { id: 'c1', name: '狐狐' } as any;
        const history = [
            { id: 1, charId: 'c1', role: 'user', type: 'emoji', content: DOG, timestamp: Date.now() - 120_000 },
            { id: 2, charId: 'c1', role: 'assistant', type: 'emoji', content: DOG, timestamp: Date.now() - 60_000 },
        ] as any[];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, { name: '阿萌' } as any, emojis);
        const user = apiMessages.find((m: any) => m.role === 'user')!.content as string;
        const assistant = apiMessages.find((m: any) => m.role === 'assistant')!.content as string;
        expect(user).toContain('乖乖当狗（图上：一只小狗叼着空食盆，眼巴巴往上看）');
        expect(assistant).toContain('乖乖当狗');
        expect(assistant).not.toContain('图上');
    });

    it('角色挑表情用的表情清单不带描述（省 token）', () => {
        expect(ChatPrompts.buildEmojiContext(emojis, [])).not.toContain('图上');
    });
});

describe('读图用哪个 API', () => {
    const api = (model: string): APIConfig => ({ baseUrl: 'https://api.example/v1', apiKey: 'k', model } as APIConfig);
    const presets: ApiPreset[] = [{ id: 'p1', name: '看图专用', config: api('gpt-4o') }, { id: 'p2', name: '没填完', config: { ...api(''), model: '' } }];

    it('识图 API 开着就排第一；主 API、填完整的预设跟在后面', () => {
        const withVision = { ...api('deepseek-chat'), visionApi: { enabled: true, baseUrl: 'https://v.example', apiKey: 'v', model: 'qwen-vl' } };
        const choices = listEmojiVisionChoices(withVision, presets);
        expect(choices.map(c => c.id)).toEqual(['vision', 'main', 'preset:p1']);
        expect(pickEmojiVisionChoice(choices, null)?.id).toBe('vision');
        expect(pickEmojiVisionChoice(choices, 'preset:p1')?.id).toBe('preset:p1');
        expect(pickEmojiVisionChoice(choices, 'preset:gone')?.id).toBe('vision');
    });

    it('识图 API 关着就不列', () => {
        const choices = listEmojiVisionChoices({ ...api('m'), visionApi: { enabled: false, baseUrl: 'x', apiKey: 'y', model: 'z' } }, []);
        expect(choices.map(c => c.id)).toEqual(['main']);
    });
});

describe('一批写描述', () => {
    const list = (n: number): Emoji[] => Array.from({ length: n }, (_, i) => ({ name: `e${i}`, url: `blobref:b_${i}` }));

    it('开头 3 个全失败就停（API 不行），后面的记成没再试', async () => {
        const saved: string[] = [];
        const result = await describeEmojisInBatch(list(6), {
            describe: async () => { throw new Error('模型看不了图'); },
            save: async name => { saved.push(name); },
        });
        expect(result.done).toBe(0);
        expect(result.failed).toHaveLength(6);
        expect(result.failed[5].reason).toContain('没再试');
    });

    it('成功过以后，中间一串图打不开也继续往下写', async () => {
        const saved: string[] = [];
        const result = await describeEmojisInBatch(list(6), {
            describe: async url => { if (/b_[1-4]$/.test(url)) throw new Error('图打不开'); return '一只猫'; },
            save: async name => { saved.push(name); },
        });
        expect(saved).toEqual(['e0', 'e5']);
        expect(result.failed.map(f => f.name)).toEqual(['e1', 'e2', 'e3', 'e4']);
    });

    it('只挑还没写的', () => {
        expect(emojisMissingDescription(emojis).map(e => e.name)).toEqual(['亲亲']);
    });
});

describe('存库', () => {
    it('改图 / 换分类（saveEmoji）不抹掉描述；setEmojiDescription 空串就清掉', async () => {
        await DB.saveEmoji('测试描述', 'blobref:b_a', 'c1');
        await DB.setEmojiDescription('测试描述', '一只小狗');
        await DB.saveEmoji('测试描述', 'blobref:b_b', 'c2');
        let row = (await DB.getEmojis()).find(e => e.name === '测试描述');
        expect(row).toMatchObject({ url: 'blobref:b_b', categoryId: 'c2', description: '一只小狗' });

        await DB.renameEmoji('测试描述', '测试描述2');
        row = (await DB.getEmojis()).find(e => e.name === '测试描述2');
        expect(row?.description).toBe('一只小狗');

        await DB.setEmojiDescription('测试描述2', '');
        row = (await DB.getEmojis()).find(e => e.name === '测试描述2');
        expect(row && 'description' in row).toBe(false);
        await expect(DB.setEmojiDescription('不存在的', 'x')).rejects.toThrow('找不到');
    });
});
// [EM-END: emoji-descriptions]
