import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalNotifications } from '@capacitor/local-notifications';
import { DB } from './db';
import { stripAndSaveScheduledMessages } from './chatParser';

vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: {
        checkPermissions: vi.fn(),
        schedule: vi.fn(),
    },
}));

describe('stripAndSaveScheduledMessages', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' });
    });

    it('combines tolerant EM tag parsing with the character wall-clock timezone', async () => {
        const save = vi.spyOn(DB, 'saveScheduledMessage').mockResolvedValue();
        const addToast = vi.fn();

        const cleaned = await stripAndSaveScheduledMessages(
            '晚点见。\n[[ schedule_message | 2030/07/26 21:00 | fixed | 到点找你 ]]',
            'char-1',
            '小鱼',
            addToast,
            'America/New_York',
        );

        expect(cleaned).toBe('晚点见。');
        expect(save).toHaveBeenCalledOnce();
        expect(save.mock.calls[0][0]).toMatchObject({
            charId: 'char-1',
            content: '到点找你',
            dueAt: new Date('2030-07-27T01:00:00.000Z').getTime(),
        });
    });
});
