// [EM-START: chat-user-clock]
import { describe, expect, it } from 'vitest';

import { HISTORY_STAMP_LEGEND, timeDifferenceNote, userClockNote, userSideStamp } from './emUserClock';
import { placeName } from './openMeteo';

const NOW = Date.parse('2026-09-29T19:37:00.000Z'); // 芝加哥下午 2:37，上海凌晨 3:37

describe('聊天里告诉角色对方那边几点', () => {
    it('角色在上海、手机在芝加哥：写出对方那边的钟', () => {
        const note = userClockNote('Asia/Shanghai', NOW, 'America/Chicago');
        expect(note).toContain('【双城时钟｜程序已换算，禁止自行心算】');
        expect(note).toContain('你（角色）当地：2026年9月30日 周三 凌晨 03:37');
        expect(note).toContain('对方（用户）当地：2026年9月29日 周二 下午 14:37');
        expect(note).toContain('判断对方是否醒着、是否在上课');
    });

    it('同一个时区、没开自定义时区：不写', () => {
        expect(userClockNote('America/Chicago', NOW, 'America/Chicago')).toBe('');
        expect(userClockNote(undefined, NOW, 'America/Chicago')).toBe('');
    });
});

describe('时差直接算成一句话', () => {
    it('上海比芝加哥快 13 小时，此刻上海已是第二天', () => {
        const note = timeDifferenceNote('Asia/Shanghai', 'America/Chicago', NOW);
        expect(note).toContain('你（角色）当地比对方当地快 13 小时');
        expect(note).toContain('你（角色）当地已经是后一天');
        expect(userClockNote('Asia/Shanghai', NOW, 'America/Chicago')).toContain('你（角色）当地比对方当地快 13 小时');
    });

    it('同一天、角色在西边、半小时时区', () => {
        const noon = Date.parse('2026-09-29T17:00:00.000Z'); // 芝加哥中午，洛杉矶上午，印度晚上 10:30
        expect(timeDifferenceNote('America/Los_Angeles', 'America/Chicago', noon)).toContain('对方当地比你（角色）当地快 2 小时；两边当前是同一个日历日');
        expect(timeDifferenceNote('Asia/Kolkata', 'America/Chicago', noon)).toContain('你（角色）当地比对方当地快 10 小时 30 分钟');
    });
});

describe('聊天记录的时间戳标明是谁的钟（2026-10-30 时差还是搞错）', () => {
    it('她发的话另标她当地几点；双城时钟下面说明怎么看', () => {
        const morning = Date.parse('2026-10-30T13:00:00.000Z'); // 芝加哥早上 8 点，上海晚上 9 点
        expect(userSideStamp({ role: 'user', timestamp: morning }, 'Asia/Shanghai', 'America/Chicago')).toBe('｜对方当地 10-30 08:00');
        expect(userSideStamp({ role: 'assistant', timestamp: morning }, 'Asia/Shanghai', 'America/Chicago')).toBe('');
        expect(userSideStamp({ role: 'user', timestamp: morning }, undefined, 'America/Chicago')).toBe('');
        expect(userSideStamp({ role: 'user', timestamp: morning }, 'America/Chicago', 'America/Chicago')).toBe('');
        expect(userClockNote('Asia/Shanghai', NOW, 'America/Chicago')).toContain(HISTORY_STAMP_LEGEND);
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
