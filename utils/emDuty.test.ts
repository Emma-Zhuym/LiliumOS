// [EM-START: char-duty]
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { emDutySection, emScheduleDuty } from './emPromptAddons';
import { buildScheduleInjection } from './scheduleInjection';

const schedule = {
    slots: [
        { startTime: '09:00', activity: '公司办公', availability: 'busy' as const },
        { startTime: '14:00', activity: '项目评审会', availability: 'busy' as const },
        { startTime: '19:00', activity: '回家做饭' },
    ],
};
// 本地时间上午十点：正在办公，下一条是评审会
const NOW = new Date(2026, 9, 1, 10, 0, 0);
const chatBlock = () => buildScheduleInjection(schedule, undefined, NOW, { includeFullDay: true, includeChangeInstruction: true });

describe('做事的分寸：聊天提示词', () => {
    it('三档轻重都写明：紧急严重可以赶过去，日常和情绪上的事不丢下工作', () => {
        const rule = emDutySection('阿萌');
        expect(rule).toContain('阿萌受伤、急病、出了事故');
        expect(rule).toContain('阿萌想逛超市');
        expect(rule).toContain('不早退、不翘班、不改掉定好的工作安排');
        expect(rule).toContain('阿萌生气、委屈、你们吵架');
        expect(rule).toContain('不靠推掉工作连夜赶过去、跨城跨国飞过去');
        expect(rule).toContain('本来就没有工作或固定安排，就按你实际的生活来');
    });

    it('上游的日程块确实在教「日程不是命令」并拿「去超市」当例子——这是要压住的那句', () => {
        const upstream = chatBlock();
        expect(upstream).toContain('不是必须履行的命令');
        expect(upstream).toContain('[[ACTION:CHANGE_SCHEDULE | 14:00 | 去超市]]');
    });

    it('聊天里的日程块：例子换掉，块尾补上「工作和约好的事不在此列」', () => {
        const patched = emScheduleDuty(chatBlock());
        expect(patched).not.toContain('去超市');
        expect(patched).toContain('[[ACTION:CHANGE_SCHEDULE | 14:00 | 在家看书]]');
        expect(patched).toContain('表上的工作、上课、会议、和别人约好的事，是你对别人的责任');
        // 原来的内容一行不少
        expect(patched).toContain('当前时段：09:00 你正在公司办公');
        expect(patched).toContain('你今天的完整日程');
        // 补的那句在块尾
        expect(patched.trimEnd().endsWith('只关你自己的安排。）')).toBe(true);
    });

    it('没有日程块就什么都不加', () => {
        expect(emScheduleDuty('')).toBe('');
    });

    it('聊天提示词里接上了这两处', () => {
        const source = readFileSync('utils/chatPrompts.ts', 'utf8');
        expect(source).toContain('${emDutySection(userProfile.name)}');
        expect(source).toContain('${emScheduleDuty(scheduleContext)}');
    });
});
// [EM-END: char-duty]
