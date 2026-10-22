import { describe, expect, it } from 'vitest';
import {
    buildCardContent,
    buildOpenTurnBlock,
    buildPastNightsBlock,
    isSafeKeptLine,
    keptLineMemoryContent,
    buildMaterialsBlock,
    cleanDeepTalkReply,
    DEEP_TALK_IDLE_MS,
    isDeepTalkIdle,
    isNightAt,
    keepInPromptHistory,
    nextNightNo,
    parseDeepTalkAnswer,
    parseEndResult,
    resolveDeepTalkTheme,
    resolveLaterTime,
    toParagraphs,
    type DeepTalkNight,
} from './deepTalk';

describe('parseDeepTalkAnswer', () => {
    it('reads accept and strips the marker', () => {
        const r = parseDeepTalkAnswer('好啊\n现在就聊\n[[DEEP_TALK: accept]]');
        expect(r.answer).toEqual({ kind: 'accept' });
        expect(r.cleaned).toBe('好啊\n现在就聊');
    });

    it('reads later with a time, full-width separators too', () => {
        expect(parseDeepTalkAnswer('还在公司\n[[DEEP_TALK：later｜23:00]]').answer).toEqual({ kind: 'later', time: '23:00' });
    });

    it('treats later without a time as no answer', () => {
        expect(parseDeepTalkAnswer('晚点 [[DEEP_TALK: later]]').answer).toBeNull();
    });

    it('takes the last marker when there are several', () => {
        expect(parseDeepTalkAnswer('[[DEEP_TALK: accept]] 算了 [[DEEP_TALK: decline]]').answer).toEqual({ kind: 'decline' });
    });

    it('returns null when there is no marker', () => {
        const r = parseDeepTalkAnswer('嗯？怎么了');
        expect(r.answer).toBeNull();
        expect(r.cleaned).toBe('嗯？怎么了');
    });
});

describe('resolveLaterTime', () => {
    const tz = 'America/Chicago';
    // 2026-10-22 22:00 Chicago = 2026-10-23 03:00 UTC
    const now = new Date('2026-10-23T03:00:00Z');

    it('picks the next 23:00 tonight', () => {
        expect(resolveLaterTime('23:00', now, tz)).toBe(new Date('2026-10-23T04:00:00Z').getTime());
    });

    it('rolls a passed time over to tomorrow', () => {
        expect(resolveLaterTime('21:30', now, tz)).toBe(new Date('2026-10-24T02:30:00Z').getTime());
    });

    it('understands 点 / 半 / 晚上', () => {
        expect(resolveLaterTime('晚上11点半', now, tz)).toBe(new Date('2026-10-23T04:30:00Z').getTime());
    });

    it('returns null for nonsense', () => {
        expect(resolveLaterTime('等我忙完', now, tz)).toBeNull();
    });
});

describe('theme', () => {
    it('counts 19:00–06:00 in the character time zone as night', () => {
        expect(isNightAt(new Date('2026-10-23T00:30:00Z'), 'America/Chicago')).toBe(true); // 19:30
        expect(isNightAt(new Date('2026-10-22T17:00:00Z'), 'America/Chicago')).toBe(false); // 12:00
        expect(isNightAt(new Date('2026-10-22T11:00:00Z'), 'America/Chicago')).toBe(false); // 06:00
    });

    it('lets a manual choice win', () => {
        const noon = new Date('2026-10-22T17:00:00Z');
        expect(resolveDeepTalkTheme('night', noon, 'America/Chicago')).toBe('night');
        expect(resolveDeepTalkTheme('auto', noon, 'America/Chicago')).toBe('day');
    });
});

describe('idle and numbering', () => {
    const night: DeepTalkNight = { id: 'n', charId: 'c', status: 'open', invitedBy: 'user', invitedAt: 0, startedAt: 1000 };

    it('is idle only after three quiet hours', () => {
        expect(isDeepTalkIdle(night, 5000, 5000 + DEEP_TALK_IDLE_MS - 1)).toBe(false);
        expect(isDeepTalkIdle(night, 5000, 5000 + DEEP_TALK_IDLE_MS + 1)).toBe(true);
        expect(isDeepTalkIdle({ ...night, status: 'closed' }, null, Number.MAX_SAFE_INTEGER)).toBe(false);
    });

    it('numbers the next night after the highest closed one', () => {
        expect(nextNightNo([])).toBe(1);
        expect(nextNightNo([{ status: 'closed', nightNo: 6 }, { status: 'declined' }, { status: 'closed', nightNo: 3 }])).toBe(7);
    });
});

describe('history folding', () => {
    const seg = (id: string) => ({ metadata: { source: 'deep_talk', deepTalkId: id } });

    it('keeps the open night and drops closed ones', () => {
        expect(keepInPromptHistory(seg('a'), 'a')).toBe(true);
        expect(keepInPromptHistory(seg('b'), 'a')).toBe(false);
        expect(keepInPromptHistory(seg('b'), null)).toBe(false);
        expect(keepInPromptHistory({ metadata: { kind: 'deep_talk_card' } }, null)).toBe(true);
        expect(keepInPromptHistory({ metadata: undefined }, null)).toBe(true);
    });

    it('writes the card line with number, title and summary', () => {
        expect(buildCardContent({ nightNo: 7, title: '原地打转', summary: '聊了要不要离开这座城市。' }))
            .toBe('（你们在烛下深谈过一夜 · 第07夜《原地打转》：聊了要不要离开这座城市。）');
    });
});

describe('prompt pieces', () => {
    it('leaves materials out when there are none', () => {
        expect(buildMaterialsBlock({ attic: [], windowsill: ['  '] })).toBe('');
        expect(buildMaterialsBlock({ attic: ['项目收尾那天心里空了'], windowsill: [] })).toContain('没想通的：项目收尾那天心里空了');
    });

    it('parses the end JSON even inside a code fence', () => {
        expect(parseEndResult('```json\n{"title":"《原地打转》","oneLine":"我第一次跟人说那件事。","summary":"她有点迷茫。","candleSummary":"她在想要不要走。","kept":[]}\n```'))
            .toEqual({ title: '原地打转', oneLine: '我第一次跟人说那件事。', summary: '她有点迷茫。', candleSummary: '她在想要不要走。', kept: [] });
        expect(parseEndResult('没有 JSON')).toBeNull();
    });

    it('keeps only lines that were really said, by that speaker, and safe to bring back', () => {
        const segments = [
            { role: 'user' as const, content: '我最近老在想要不要走。我在这边回不去，一个人在宿舍。' },
            { role: 'assistant' as const, content: '累的时候不用被安慰，可以只是累。\n\n我在。' },
        ];
        const raw = JSON.stringify({
            title: '原地打转', oneLine: '', summary: '她有点累。', candleSummary: '',
            kept: [
                { speaker: 'char', text: '「累的时候不用被安慰，可以只是累。」' },
                { speaker: 'user', text: '我在这边回不去' },          // 现实处境：不带回去
                { speaker: 'char', text: '我会一直陪着你' },          // 没说过：不收
                { speaker: 'user', text: '累的时候不用被安慰，可以只是累。' }, // 不是她说的
                { speaker: 'user', text: '我最近老在想要不要走。' },
                { speaker: 'char', text: '我在。' },                  // 已经两句了
            ],
        });
        expect(parseEndResult(raw, segments)?.kept).toEqual([
            { speaker: 'char', text: '累的时候不用被安慰，可以只是累。' },
            { speaker: 'user', text: '我最近老在想要不要走。' },
        ]);
    });

    it('cleans a reply down to paragraphs', () => {
        const cleaned = cleanDeepTalkReply('<think>想想</think>既白：想过。\n\n\n\n[[SEND_EMOJI: 抱抱]]后来不算了。', '既白');
        expect(cleaned).toBe('想过。\n\n后来不算了。');
        expect(toParagraphs(cleaned)).toEqual(['想过。', '后来不算了。']);
    });
});

describe('truth-telling nights', () => {
    const names = { userName: '阿萌', charName: '既白' };

    it('tells TA reality and the shared world are both true', () => {
        const block = buildOpenTurnBlock(names);
        expect(block).toContain('烛下是可以说真话的地方');
        expect(block).toContain('不要用现实去推翻你们世界里的事');
    });

    it('lets later candle nights see what earlier ones really said', () => {
        const block = buildPastNightsBlock([
            { nightNo: 7, title: '原地打转', candleSummary: '她说在国外回不去。', summary: '她有点孤单。', kept: [{ speaker: 'char', text: '可以只是累' }] },
        ], names);
        expect(block).toContain('第07夜《原地打转》：她说在国外回不去。');
        expect(block).toContain('你说「可以只是累」');
        expect(buildPastNightsBlock([], names)).toBe('');
        expect(buildOpenTurnBlock(names, null, [{ nightNo: 1, title: 'x', candleSummary: '聊了很多' }])).toContain('只在烛下记得');
    });

    it('screens out lines that would give away reality', () => {
        expect(isSafeKeptLine('你回不了国也没关系')).toBe(false);
        expect(isSafeKeptLine('我们隔着时差')).toBe(false);
        expect(isSafeKeptLine('累的时候不用被安慰')).toBe(true);
    });

    it('writes a kept line as TA\'s own memory', () => {
        expect(keptLineMemoryContent({ speaker: 'user', text: '想被允许累' }, '阿萌')).toBe('点着蜡烛那一夜，阿萌跟我说：「想被允许累」');
        expect(keptLineMemoryContent({ speaker: 'char', text: '我在' }, '阿萌')).toBe('点着蜡烛那一夜，我跟阿萌说：「我在」');
    });
});
