// [EM-START: chat-user-clock]
import { describe, expect, it } from 'vitest';

import { userClockNote } from './emUserClock';
import { placeName } from './openMeteo';

const NOW = Date.parse('2026-09-29T19:37:00.000Z'); // 芝加哥下午 2:37，上海凌晨 3:37

describe('聊天里告诉角色对方那边几点', () => {
    it('角色在上海、手机在芝加哥：写出对方那边的钟', () => {
        const note = userClockNote('Asia/Shanghai', NOW, 'America/Chicago');
        expect(note).toContain('对方那边现在是 9月29日');
        expect(note).toContain('14:37');
        expect(note).toContain('别拿自己这边的钟');
    });

    it('同一个时区、没开自定义时区：不写', () => {
        expect(userClockNote('America/Chicago', NOW, 'America/Chicago')).toBe('');
        expect(userClockNote(undefined, NOW, 'America/Chicago')).toBe('');
    });
});

describe('天气里的地名带上州和国家', () => {
    it('伯明翰 → 伯明翰，亚拉巴马州，美国', () => {
        expect(placeName({ name: '伯明翰', admin1: '亚拉巴马州', country: '美国' })).toBe('伯明翰，亚拉巴马州，美国');
    });

    it('缺的段跳过，重复的只留一个', () => {
        expect(placeName({ name: '新加坡', country: '新加坡' })).toBe('新加坡');
    });
});
// [EM-END: chat-user-clock]
