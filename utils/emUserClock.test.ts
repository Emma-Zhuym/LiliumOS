// [EM-START: chat-user-clock]
import { describe, expect, it } from 'vitest';

import { timeDifferenceNote, userClockNote } from './emUserClock';
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

describe('时差直接算成一句话', () => {
    it('上海比芝加哥快 13 小时，此刻上海已是第二天', () => {
        const note = timeDifferenceNote('Asia/Shanghai', 'America/Chicago', NOW);
        expect(note).toContain('你那边比对方快 13 小时');
        expect(note).toContain('你这边已经是第二天了');
        expect(userClockNote('Asia/Shanghai', NOW, 'America/Chicago')).toContain('你那边比对方快 13 小时');
    });

    it('同一天、角色在西边、半小时时区', () => {
        const noon = Date.parse('2026-09-29T17:00:00.000Z'); // 芝加哥中午，洛杉矶上午，印度晚上 10:30
        expect(timeDifferenceNote('America/Los_Angeles', 'America/Chicago', noon)).toContain('对方那边比你快 2 小时，此刻两边是同一天');
        expect(timeDifferenceNote('Asia/Kolkata', 'America/Chicago', noon)).toContain('你那边比对方快 10 小时 30 分钟');
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
