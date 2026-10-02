// [EM-START: char-duty]
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 走真正的聊天提示词生成流程，确认「做事的分寸」落在该落的位置：
//   - 行为规范里（稳定段，主动消息打包时也带着）；
//   - 日程块里（每轮都在、贴着生成点）：例子不再是「去超市」，块尾有「工作和约好的事不在此列」。

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
        const duty = stable.indexOf('2.1 **做事的分寸');
        const quality = stable.indexOf('2.5 **对话质量');
        expect(mode).toBeGreaterThan(-1);
        expect(duty).toBeGreaterThan(mode);
        expect(quality).toBeGreaterThan(duty);
        expect(stable).toContain('阿萌想逛超市');
        expect(stable).toContain('阿萌生气、委屈、你们吵架');
    });

    it('日程块：教改日程的例子不再是「去超市」，块尾写明工作和约好的事不在此列', async () => {
        const { volatileState } = await build();
        expect(volatileState).toContain('当前时段：09:00 你正在公司办公');
        expect(volatileState).toContain('[[ACTION:CHANGE_SCHEDULE | 14:00 | 在家看书]]');
        expect(volatileState).not.toContain('去超市');
        expect(volatileState).toContain('表上的工作、上课、会议、和别人约好的事，是你对别人的责任');
    });

    it('主动消息打包的那份提示词也带着这条规矩', async () => {
        const { stable } = await build(true);
        expect(stable).toContain('2.1 **做事的分寸');
    });
});
// [EM-END: char-duty]
