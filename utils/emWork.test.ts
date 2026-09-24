// [EM-START: work-app]
import { describe, expect, it } from 'vitest';

import {
    MAX_MESSAGES_PER_CHANNEL, MAX_THREADS, applyWorkEpisode, channelMessages, emptyWorkState, formatWorkTime,
    listChannels, listThreads, type WorkEvent,
} from './emWork';

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 8, 24, hour, minute)).toISOString();

const group = (id: string, when: string, extra: Partial<WorkEvent> = {}): WorkEvent => ({
    messageId: id,
    createdAt: when,
    episode: {
        channel: 'group', with: '美术组日常',
        lines: [{ who: '小林', text: '第二版出了' }, { who: '我', text: '看到了，领口还要改' }],
    },
    ...extra,
});

describe('applyWorkEpisode', () => {
    it('把一段往来拆成几句，按顺序排开，「我」标成自己', () => {
        const state = applyWorkEpisode(undefined, group('hb:1:work', at(15)));
        const messages = channelMessages(state, 'g:美术组日常');
        expect(messages.map(message => message.text)).toEqual(['第二版出了', '看到了，领口还要改']);
        expect(messages.map(message => message.mine)).toEqual([false, true]);
        expect(messages[1].at).toBeGreaterThan(messages[0].at);
    });

    it('幂等：同一段往来被取回两次，不会变成两段', () => {
        const once = applyWorkEpisode(undefined, group('hb:1:work', at(15)));
        const twice = applyWorkEpisode(once, group('hb:1:work', at(15)));
        expect(twice).toBe(once);
        expect(twice.messages).toHaveLength(2);
    });

    it('群 / 私聊 / 邮件各归各的会话，邮件用主题当会话名', () => {
        let state = applyWorkEpisode(undefined, group('a', at(9)));
        state = applyWorkEpisode(state, { messageId: 'b', createdAt: at(10), episode: { channel: 'dm', with: '李文', lines: [{ who: '李文', text: '下午的会提前了' }] } });
        state = applyWorkEpisode(state, { messageId: 'c', createdAt: at(11), episode: { channel: 'email', with: '合作方', subject: '排期确认', lines: [{ who: '合作方', text: '请确认' }] } });
        const channels = listChannels(state);
        expect(channels.map(channel => channel.key)).toEqual(['e:排期确认', 'd:李文', 'g:美术组日常']);
        expect(channels[0].title).toBe('排期确认');
        expect(channels[0].kind).toBe('email');
    });

    it('事项：新开、接着写、收尾；进展一条条记下来', () => {
        let state = applyWorkEpisode(undefined, group('a', at(9), { thread: { id: 't1', title: '角色设计修改', summary: '配色通过', status: 'open' } }));
        state = applyWorkEpisode(state, group('b', at(11), { thread: { id: 't1', title: '角色设计修改', summary: '领口待改', status: 'open' } }));
        state = applyWorkEpisode(state, group('c', at(14), { thread: { id: 't1', title: '角色设计修改', summary: '定稿', status: 'done' } }));
        const [thread] = listThreads(state);
        expect(state.threads).toHaveLength(1);
        expect(thread.status).toBe('done');
        expect(thread.summary).toBe('定稿');
        expect(thread.history.map(entry => entry.text)).toEqual(['配色通过', '领口待改', '定稿']);
    });

    it('事项列表：没做完的在前', () => {
        let state = applyWorkEpisode(undefined, group('a', at(9), { thread: { id: 'old', title: '旧的', summary: '', status: 'done' } }));
        state = applyWorkEpisode(state, group('b', at(8), { thread: { id: 'new', title: '新的', summary: '', status: 'open' } }));
        expect(listThreads(state).map(thread => thread.id)).toEqual(['new', 'old']);
    });

    it('单个会话超上限只砍这个会话最旧的，别的会话不受影响', () => {
        let state = applyWorkEpisode(undefined, { messageId: 'other', createdAt: at(1), episode: { channel: 'dm', with: '李文', lines: [{ who: '李文', text: '在吗' }] } });
        for (let index = 0; index < MAX_MESSAGES_PER_CHANNEL; index += 1) {
            state = applyWorkEpisode(state, group(`m${index}`, at(2, index % 60)));
        }
        expect(channelMessages(state, 'g:美术组日常')).toHaveLength(MAX_MESSAGES_PER_CHANNEL);
        expect(channelMessages(state, 'd:李文')).toHaveLength(1);
    });

    it('事项超上限先丢做完的最旧的', () => {
        let state = emptyWorkState();
        for (let index = 0; index < MAX_THREADS + 3; index += 1) {
            state = applyWorkEpisode(state, group(`t${index}`, at(5, index % 60), {
                thread: { id: `id${index}`, title: `事${index}`, summary: '', status: index < 5 ? 'done' : 'open' },
            }));
        }
        expect(state.threads).toHaveLength(MAX_THREADS);
        expect(state.threads.some(thread => thread.id === 'id0')).toBe(false);
        expect(state.threads.some(thread => thread.id === `id${MAX_THREADS + 2}`)).toBe(true);
    });

    it('没有 id 的事项（模型写坏）只记往来，不记事项', () => {
        const state = applyWorkEpisode(undefined, group('a', at(9), { thread: null }));
        expect(state.threads).toEqual([]);
        expect(state.messages).toHaveLength(2);
    });
});

describe('formatWorkTime', () => {
    const now = Date.parse('2026-09-24T18:00:00');
    it('今天显示钟点，昨天写昨天，更早写月日', () => {
        expect(formatWorkTime(Date.parse('2026-09-24T09:05:00'), now)).toMatch(/09:05|9:05/);
        expect(formatWorkTime(Date.parse('2026-09-23T09:05:00'), now)).toBe('昨天');
        expect(formatWorkTime(Date.parse('2026-09-10T09:05:00'), now)).toBe('9/10');
    });
});
// [EM-END: work-app]
