import { beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
    beginTietieSession,
    buildTietieCardContent,
    buildTietieMaterials,
    buildTietiePrompt,
    clearTietieSession,
    expiredTietieSession,
    formatTietieDuration,
    nextTietieNo,
    parseTietieResult,
    readTietieSession,
    sessionStartFor,
    tietieMinutes,
} from './tietie';

const names = { userName: '阿萌', charName: '他' };
let nextId = 1;
const msg = (role: 'user' | 'assistant' | 'system', content: string, timestamp: number, metadata: Record<string, unknown> = {}): Message =>
    ({ id: nextId++, charId: 'c1', role, type: 'text', content, timestamp, metadata } as Message);

describe('本机记的开始时刻', () => {
    beforeEach(() => localStorage.clear());

    it('再点一次延长时保留最早的开始', () => {
        beginTietieSession('c1', 10_000, 1_000);
        const s = beginTietieSession('c1', 20_000, 5_000);
        expect(s).toEqual({ startedAt: 1_000, until: 20_000 });
    });

    it('上一次早就过期了就重新算', () => {
        beginTietieSession('c1', 2_000, 1_000);
        expect(beginTietieSession('c1', 9_000, 5_000).startedAt).toBe(5_000);
    });

    it('没记就往前推一小时；过了 until 才算忘了点', () => {
        expect(sessionStartFor(null, 4_000_000)).toBe(4_000_000 - 3_600_000);
        beginTietieSession('c1', 10_000, 1_000);
        const s = readTietieSession('c1');
        expect(expiredTietieSession(s, 9_999)).toBeNull();
        expect(expiredTietieSession(s, 10_000)).toEqual(s);
        clearTietieSession('c1');
        expect(readTietieSession('c1')).toBeNull();
    });
});

describe('材料', () => {
    it('分开前面在聊的和这段时间里的，烛下和系统消息不要，见面带标记', () => {
        const all = [
            msg('user', '快点来', 100),
            msg('assistant', '在床上等你', 200),
            msg('user', '烛下的话', 250, { source: 'deep_talk' }),
            msg('system', '系统', 260),
            msg('user', '她推开门', 400, { source: 'date' }),
        ];
        const { lead, inside } = buildTietieMaterials(all, { startedAt: 300, endedAt: 500 }, names);
        expect(lead).toBe('阿萌：快点来\n他：在床上等你');
        expect(inside).toBe('［见面］阿萌：她推开门');
    });

    it('这段时间没写东西时提示词让 TA 自己写，有就照实记', () => {
        const base = { names, persona: '', lead: '阿萌：快点来', startedAt: 0, endedAt: 3_600_000, endedBy: 'manual' as const, recentMemories: ['上次在沙发'] };
        expect(buildTietiePrompt({ ...base, inside: '' })).toContain('由你来写');
        const withText = buildTietiePrompt({ ...base, inside: '阿萌：推开门' });
        expect(withText).toContain('照实记');
        expect(withText).toContain('上次在沙发');
        expect(withText).toContain('大约 60 分钟');
    });
});

describe('解析', () => {
    it('读出 JSON，剥掉思考块和代码围栏', () => {
        const raw = '<think>想想</think>```json\n{"title":"浴室起雾","oneLine":"手腕还疼","place":"卧室","minutes":"75","story":["一","二"],"memory":"十点在卧室","after":["别动","我去倒水","多的"]}\n```';
        const r = parseTietieResult(raw)!;
        expect(r.title).toBe('浴室起雾');
        expect(r.minutes).toBe(75);
        expect(r.story).toEqual(['一', '二']);
        expect(r.after).toEqual(['别动', '我去倒水']);
    });

    it('story 是一整段字符串也能按空行拆', () => {
        expect(parseTietieResult('{"story":"一\\n\\n二","memory":"m"}')!.story).toEqual(['一', '二']);
    });

    it('没有正文或记忆（多半被拒了）算没写出来', () => {
        expect(parseTietieResult('抱歉，我不能写这个')).toBeNull();
        expect(parseTietieResult('{"title":"x","story":["a"]}')).toBeNull();
    });
});

describe('显示和上下文', () => {
    it('点了结束按真实时长，忘了点用 TA 估的', () => {
        expect(tietieMinutes({ startedAt: 0, endedAt: 75 * 60_000, endedBy: 'manual', minutes: 10 })).toBe(75);
        expect(tietieMinutes({ startedAt: 0, endedAt: 2 * 3_600_000, endedBy: 'timeout', minutes: 40 })).toBe(40);
        expect(formatTietieDuration(75)).toBe('1 时 15 分');
        expect(formatTietieDuration(30)).toBe('30 分钟');
        expect(formatTietieDuration(null)).toBe('—');
    });

    it('卡片那一行带名字和记忆；没写出来只说有过', () => {
        expect(buildTietieCardContent({ status: 'done', no: 7, title: '浴室起雾', memory: '十点在卧室' }))
            .toBe('（你们刚度过了两个人的时间 · 第7次《浴室起雾》：十点在卧室）');
        expect(buildTietieCardContent({ status: 'failed' })).toBe('（你们刚度过了两个人的时间）');
        expect(nextTietieNo([{ no: 2 }, {}, { no: 5 }])).toBe(6);
    });
});
