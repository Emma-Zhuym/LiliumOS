// [EM-START: char-duty]
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 走真正的聊天提示词生成流程，确认「你是活在社会里的人」落在行为规范里（主动消息打包时也带着）。

vi.mock('./dailySchedule', () => ({
    getDailyScheduleForChar: vi.fn(async () => ({
        id: 'char-duty_2026-10-01',
        charId: 'char-duty',
        date: '2026-10-01',
        generatedAt: Date.now(),
        slots: [
            { startTime: '09:00', activity: '公司办公', availability: 'busy' },
            { startTime: '14:00', activity: '项目评审会', availability: 'busy' },
            { startTime: '19:00', activity: '回家做饭' },
        ],
    })),
}));

import { ChatPrompts } from './chatPrompts';

const userProfile = { name: '阿萌' } as any;
const char = { id: 'char-duty', name: '陈照', scheduleFeatureEnabled: true } as any;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 10, 0, 0)); // 上午十点：正在办公，下一条是评审会
});

afterEach(() => {
    vi.useRealTimers();
});

const build = (forFirePack = false) => ChatPrompts.buildSystemPromptParts(
    char, userProfile, [], [], [], [],
    undefined, undefined, undefined, undefined, undefined, undefined,
    forFirePack ? { forFirePack: true } : undefined,
);

describe('做事的分寸：真实的聊天提示词', () => {
    it('行为规范里有这一条，夹在「行为模式」和「对话质量」之间', async () => {
        const { stable } = await build();
        const mode = stable.indexOf('2. **行为模式**');
        const duty = stable.indexOf('2.1 **你是活在社会里的人');
        const quality = stable.indexOf('2.5 **对话质量');
        expect(mode).toBeGreaterThan(-1);
        expect(duty).toBeGreaterThan(mode);
        expect(quality).toBeGreaterThan(duty);
        expect(stable).toContain('有人指望着你');
        expect(stable).toContain('阿萌想逛超市');
    });

    it('日程块不动：改日程本身没问题，这条规矩不靠日程规则', async () => {
        const { volatileState } = await build();
        expect(volatileState).toContain('当前时段：09:00 你正在公司办公');
        expect(volatileState).toContain('CHANGE_SCHEDULE');
    });

    it('主动消息打包的那份提示词也带着这条规矩', async () => {
        const { stable } = await build(true);
        expect(stable).toContain('2.1 **你是活在社会里的人');
    });
});
// [EM-END: char-duty]
