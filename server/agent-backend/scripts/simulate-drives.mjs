#!/usr/bin/env node
/**
 * 劲儿曲线回放（docs/spec-character-drives.md 第 11 节）：虚拟时钟、不碰数据库，人看形状。
 *
 *   node server/agent-backend/scripts/simulate-drives.mjs            # 全部场景
 *   node server/agent-backend/scripts/simulate-drives.mjs 异国          # 名字里带「异国」的
 *
 * 每个场景一串事件（几点、发生了什么），每小时打一行最关心的那几股。调 drives.mjs 里的表之后跑一遍，
 * 看曲线有没有离谱：别扭会不会过夜、异国一天不说话「想你」顶到多高、同居的晚上会不会反而越来越想。
 */

import {
    DEFAULT_BASELINE, applyLabel, evolve, formatFeelings, freshState, grievanceOf, inPrivateMoment, withApartness,
} from '../drives.mjs';

const H = 3_600_000;
const START = new Date('2026-10-20T13:00:00.000Z'); // 芝加哥早上 8 点

const scenarios = [
    {
        name: '同居的一天：白天各忙各的，晚上回家，调情 → 洗澡 → 事后',
        events: [
            [0, 'apart', 'today'], [10, 'apart', 'together'], [10, 'chat', 'affectionate'],
            [13, 'chat', 'flirt'], [13.2, 'chat', 'getting_intimate'], [14.4, 'chat', 'intimacy_done'],
        ],
        chatAt: [0, 10, 13, 14.4],
    },
    {
        name: '异国：一整天没说话，晚上她撒娇',
        events: [[0, 'apart', 'far'], [20, 'chat', 'affectionate']],
        chatAt: [0, 20],
    },
    {
        name: '她失约了一次，四小时后安抚',
        events: [[0, 'apart', 'today'], [1, 'chat', 'broken_promise', '晚上视频我忘了'], [5, 'chat', 'reassuring']],
        chatAt: [0, 1, 5],
    },
    {
        name: '她失约后一直没提，第二天',
        events: [[0, 'apart', 'today'], [1, 'chat', 'broken_promise', '晚上视频我忘了']],
        chatAt: [0, 1],
    },
    {
        name: '加班的一天：工作接连出状况',
        events: [[0, 'apart', 'today'], [2, 'self', 'work_trouble'], [4, 'self', 'work_trouble'], [7, 'self', 'tired_day'], [9, 'self', 'work_win']],
        chatAt: [0],
    },
];

const pick = process.argv[2];
const cols = ['miss', 'sulk', 'stress', 'desire', 'tired'];
const pad = (v, n = 6) => String(v).padStart(n);

for (const sc of scenarios.filter(s => !pick || s.name.includes(pick))) {
    console.log(`\n## ${sc.name}`);
    console.log(`时刻  ${cols.map(c => pad(c)).join('')}   在一块    主动提?  两人时间  感受`);
    let state = freshState(DEFAULT_BASELINE, START);
    const events = sc.events.slice().sort((a, b) => a[0] - b[0]);
    for (let h = 0; h <= 26; h += 1) {
        const now = new Date(START.getTime() + h * H);
        const lastChat = Math.max(...sc.chatAt.filter(t => t <= h), 0);
        const localHour = (8 + h) % 24;
        state = evolve(state, now, { silenceHours: h - lastChat, localHour, busy: localHour >= 9 && localHour < 18 });
        for (const [t, kind, value, quote] of events.filter(e => e[0] > h - 1 && e[0] <= h)) {
            const at = new Date(START.getTime() + t * H);
            if (kind === 'apart') state = withApartness(state, value, at);
            else state = applyLabel(state, { label: value, quote, now: at, source: kind }).state;
        }
        const feel = formatFeelings(state, { userName: '她' }).text.split('\n').slice(1).map(l => l.replace(/^- /, '')).join(' ');
        console.log(`${pad(`${localHour}:00`, 5)} ${cols.map(c => pad(state.values[c].toFixed(2))).join('')}   ${pad(state.apartness?.value ?? '-', 8)}  ${grievanceOf(state) ? '  是  ' : '      '}  ${inPrivateMoment(state, now) ? '  是  ' : '      '}  ${feel}`);
    }
}
