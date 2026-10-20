import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./emAgentBackend', () => ({
    isAgentPaired: vi.fn(() => true),
    AgentBackend: { driveEvents: vi.fn(async () => ({ accepted: 1 })) },
}));

import { AgentBackend, isAgentPaired } from './emAgentBackend';
import { buildDriveEventsEvalSection, sanitizeDriveEvents, sendDriveEventsFromEval } from './emDriveEvents';

describe('劲儿事件标签（手机侧）', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.mocked(AgentBackend.driveEvents).mockReset().mockResolvedValue({ accepted: 1 });
        vi.mocked(isAgentPaired).mockReturnValue(true);
    });

    it('评估提示词：配对了才加那一段，写明负面要引原话', () => {
        expect(buildDriveEventsEvalSection()).toContain('"driveEvents"');
        expect(buildDriveEventsEvalSection()).toContain('一字不差');
        vi.mocked(isAgentPaired).mockReturnValue(false);
        expect(buildDriveEventsEvalSection()).toBe('');
    });

    it('整理：不认识的、没原话的负面丢掉，最多三个', () => {
        expect(sanitizeDriveEvents([
            { label: 'cold' }, { label: 'vulnerable', quote: '好难受' }, { label: 'oops' },
            { label: 'broken_promise', quote: '我忘了' }, { label: 'sharing' }, { label: 'affectionate' },
        ])).toEqual([{ label: 'vulnerable', quote: '好难受' }, { label: 'broken_promise', quote: '我忘了' }, { label: 'sharing' }]);
        expect(sanitizeDriveEvents(undefined)).toEqual([]);
    });

    it('送不出去就排队，下次一起送', async () => {
        vi.mocked(AgentBackend.driveEvents).mockRejectedValueOnce(new Error('offline'));
        await sendDriveEventsFromEval({ driveEvents: [{ label: 'vulnerable', quote: '好难受' }] }, 'lumi', 1000);
        expect(JSON.parse(localStorage.getItem('em_drive_events_queue_v1') || '[]')).toHaveLength(1);
        await sendDriveEventsFromEval({ driveEvents: [{ label: 'sharing' }] }, 'lumi', 2000);
        expect(AgentBackend.driveEvents).toHaveBeenCalledTimes(3);
        expect(JSON.parse(localStorage.getItem('em_drive_events_queue_v1') || '[]')).toHaveLength(0);
    });
});
