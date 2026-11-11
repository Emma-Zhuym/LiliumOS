import { beforeEach, describe, expect, it, vi } from 'vitest';

// 她最近说过的话（核对原话是不是她的）
vi.mock('./db', () => ({
    DB: { getRecentMessagesByCharId: vi.fn(async () => ['好难受', '今天发生了一件好玩的事', '想你啦', '你在干嘛呢'].map(content => ({ role: 'user', content }))) },
}));

vi.mock('./emAgentBackend', () => ({
    isAgentPaired: vi.fn(() => true),
    AgentBackend: { driveEvents: vi.fn(async () => ({ accepted: 1 })) },
}));

import { AgentBackend, isAgentPaired } from './emAgentBackend';
import { buildDriveEventsEvalSection, keepHerQuotes, sanitizeDriveEvents, sendDriveEventsFromEval } from './emDriveEvents';

describe('心思事件标签（手机侧）', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.mocked(AgentBackend.driveEvents).mockReset().mockResolvedValue({ accepted: 1 });
        vi.mocked(isAgentPaired).mockReturnValue(true);
    });

    it('原话得是她说的：TA 的「去躺好」不算她说要开始了（2026-11-10）', () => {
        const hers = ['我困了', '上次吵架那么久，你会不会怪我呀'];
        expect(keepHerQuotes([
            { label: 'getting_intimate', quote: '去躺好' },
            { label: 'reassuring', quote: '你会不会怪我呀' },
            { label: 'reminiscing', quote: '上次吵架那么久，' },
        ], hers)).toEqual([{ label: 'reassuring', quote: '你会不会怪我呀' }, { label: 'reminiscing', quote: '上次吵架那么久，' }]);
    });

    it('难受、挂心的事实也要原话，没有就丢（2026-11-10）', () => {
        expect(sanitizeDriveEvents([{ label: 'vulnerable' }, { label: 'concern_fact' }, { label: 'concern_fact', quote: '明天考试' }]))
            .toEqual([{ label: 'concern_fact', quote: '明天考试' }]);
    });

    it('评估提示词：配对了才加那一段，写明负面要引原话', () => {
        expect(buildDriveEventsEvalSection()).toContain('"driveEvents"');
        expect(buildDriveEventsEvalSection()).toContain('一字不差');
        vi.mocked(isAgentPaired).mockReturnValue(false);
        expect(buildDriveEventsEvalSection()).toBe('');
    });

    it('整理：不认识的、没原话的丢掉（2026-11-10 起每个标签都要原话），最多三个', () => {
        expect(sanitizeDriveEvents([
            { label: 'cold' }, { label: 'vulnerable', quote: '好难受' }, { label: 'oops' },
            { label: 'broken_promise', quote: '我忘了' }, { label: 'sharing' }, { label: 'affectionate', quote: '想你啦' }, { label: 'flirt', quote: '嘿' },
        ])).toEqual([{ label: 'vulnerable', quote: '好难受' }, { label: 'broken_promise', quote: '我忘了' }, { label: 'affectionate', quote: '想你啦' }]);
        expect(sanitizeDriveEvents(undefined)).toEqual([]);
    });

    it('送不出去就排队，下次一起送', async () => {
        vi.mocked(AgentBackend.driveEvents).mockRejectedValueOnce(new Error('offline'));
        await sendDriveEventsFromEval({ driveEvents: [{ label: 'vulnerable', quote: '好难受' }] }, 'lumi', 1000);
        expect(JSON.parse(localStorage.getItem('em_drive_events_queue_v1') || '[]')).toHaveLength(1);
        await sendDriveEventsFromEval({ driveEvents: [{ label: 'sharing', quote: '今天发生了一件好玩的事' }] }, 'lumi', 2000);
        expect(AgentBackend.driveEvents).toHaveBeenCalledTimes(3);
        expect(JSON.parse(localStorage.getItem('em_drive_events_queue_v1') || '[]')).toHaveLength(0);
        // 排着的那批带的是它真发生的时刻，不是补送的时刻
        expect(vi.mocked(AgentBackend.driveEvents).mock.calls[1][1]).toEqual([{ label: 'vulnerable', quote: '好难受', at: new Date(1000).toISOString() }]);
    });

    it('两次评估挨着落地：排着的那批只送一遍', async () => {
        vi.mocked(AgentBackend.driveEvents).mockRejectedValueOnce(new Error('offline'));
        await sendDriveEventsFromEval({ driveEvents: [{ label: 'affectionate', quote: '想你啦' }] }, 'lumi', 1000);
        vi.mocked(AgentBackend.driveEvents).mockClear();
        await Promise.all([
            sendDriveEventsFromEval({ driveEvents: [{ label: 'sharing', quote: '今天发生了一件好玩的事' }] }, 'lumi', 2000),
            sendDriveEventsFromEval({ driveEvents: [{ label: 'reassuring', quote: '你在干嘛呢' }] }, 'lumi', 2001),
        ]);
        const sent = vi.mocked(AgentBackend.driveEvents).mock.calls.map(call => call[1][0].label);
        expect(sent.filter(label => label === 'affectionate')).toHaveLength(1);
    });
});
