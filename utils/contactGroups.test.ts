// [EM-START: contact-groups]
import { describe, expect, it } from 'vitest';

import type { PhoneContact } from '../types';
import {
    CONTACT_GROUPS, groupContacts, inferContactGroup, normalizeContactGroup, resolveContactGroup,
} from './contactGroups';

const contact = (overrides: Partial<PhoneContact>): PhoneContact => ({
    id: overrides.name ?? 'x', name: 'X', kind: 'npc', affinity: 0, status: 'friend', createdAt: 0, ...overrides,
});

describe('inferContactGroup：按关系备注关键词推断', () => {
    it.each([
        ['母亲', 'family'], ['姐夫', 'family'], ['妻子', 'family'], ['表哥', 'family'],
        ['发小', 'friend'], ['大学室友的哥们', 'friend'], ['损友', 'friend'],
        ['同事·程序组', 'work'], ['上司', 'work'], ['秘书', 'work'], ['合作方客户', 'work'],
        ['辅导员', 'school'], ['学长', 'school'], ['社团同学', 'school'],
        ['邻居家的姑娘', 'service'], ['姑姑', 'family'],
        ['司机', 'service'], ['家庭医生', 'service'], ['楼下便利店老板', 'service'],
        ['彼方网友', 'online'], ['游戏队友', 'online'],
    ])('%s → %s', (identity, expected) => {
        expect(inferContactGroup(identity)).toBe(expected);
    });

    it('线上词优先：带「友」的网友不会被当成朋友，带「游戏」的同事不会被当成网友', () => {
        expect(inferContactGroup('彼方网友')).toBe('online');
        expect(inferContactGroup('游戏公司同事')).toBe('work');
    });

    it('对不上就是 undefined；没有关系备注时才退而看备注开头', () => {
        expect(inferContactGroup('前任')).toBeUndefined();
        expect(inferContactGroup(undefined)).toBeUndefined();
        expect(inferContactGroup('', '公司里带我入行的前辈，很照顾我')).toBe('work');
        // 有关系备注时，备注里提到别的关系不能带偏它
        expect(inferContactGroup('前任', '现在是我的同事')).toBeUndefined();
    });
});

describe('normalizeContactGroup：模型吐中文/近义词也认', () => {
    it('id、中文名、大小写、近义词', () => {
        expect(normalizeContactGroup('family')).toBe('family');
        expect(normalizeContactGroup('同事')).toBe('work');
        expect(normalizeContactGroup(' Friend ')).toBe('friend');
        expect(normalizeContactGroup('生活服务')).toBe('service');
    });
    it('认不出的返回 undefined，非字符串也不炸', () => {
        expect(normalizeContactGroup('boss')).toBeUndefined();
        expect(normalizeContactGroup(undefined)).toBeUndefined();
        expect(normalizeContactGroup(3)).toBeUndefined();
    });
});

describe('resolveContactGroup / groupContacts', () => {
    it('明确指定的分组优先于推断，都没有就是其他', () => {
        expect(resolveContactGroup(contact({ group: 'family', identity: '同事' }))).toBe('family');
        expect(resolveContactGroup(contact({ identity: '同事' }))).toBe('work');
        expect(resolveContactGroup(contact({}))).toBe('other');
    });

    it('按固定顺序切段，空组不出现，组内保持原顺序', () => {
        const sections = groupContacts([
            contact({ name: 'a', identity: '同事' }),
            contact({ name: 'b', identity: '妈妈' }),
            contact({ name: 'c', identity: '上司' }),
            contact({ name: 'd' }),
        ]);
        expect(sections.map(section => section.group.id)).toEqual(['family', 'work', 'other']);
        expect(sections[1].contacts.map(item => item.name)).toEqual(['a', 'c']);
    });

    it('分组清单没有重复 id', () => {
        expect(new Set(CONTACT_GROUPS.map(group => group.id)).size).toBe(CONTACT_GROUPS.length);
    });
});
// [EM-END: contact-groups]
