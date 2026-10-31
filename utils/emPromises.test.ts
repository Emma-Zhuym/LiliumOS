import { beforeEach, describe, expect, it } from 'vitest';

import {
    addPromise, buildPromisesInjection, executePromiseDirectives, importPromises, loadPromises, openPromises,
    parsePromiseDirectives, promiseCode, promiseDue, promisesForSnapshot, retractPromisesSince, settlePromise,
} from './emPromises';

const NOW = new Date(2026, 9, 30, 23, 0); // 周五

beforeEach(() => localStorage.clear());

describe('认标签', () => {
    it('认日期、时间，剥掉标签', () => {
        const { content, ops } = parsePromiseDirectives('好\n[[PROMISE: 周四 晚上8点 | 陪你去拿巧克力]]\n就这样', NOW);
        expect(content).toBe('好\n\n就这样');
        expect(ops).toEqual([{ kind: 'add', what: '陪你去拿巧克力', date: '2026-11-05', time: '20:00' }]);
    });
    it('周末算周六；认不出日期也记，留原话；只写一件事也行', () => {
        expect(parsePromiseDirectives('[[PROMISE: 这周末 | 陪你]]', NOW).ops[0]).toMatchObject({ date: '2026-10-31' });
        expect(parsePromiseDirectives('[[PROMISE: 等你忙完 | 陪你]]', NOW).ops[0]).toEqual({ kind: 'add', what: '陪你', whenText: '等你忙完' });
        expect(parsePromiseDirectives('[[PROMISE: 陪你]]', NOW).ops[0]).toEqual({ kind: 'add', what: '陪你' });
    });
});

describe('记下和结清', () => {
    it('同一件事写两遍只留一条', () => {
        addPromise({ charId: 'a', what: '陪你' });
        addPromise({ charId: 'a', what: '陪你' });
        expect(loadPromises()).toHaveLength(1);
    });
    it('TA 用编号标做到了；别的角色的编号不算', () => {
        const p = addPromise({ charId: 'a', what: '陪你' });
        executePromiseDirectives(`[[PROMISE_DONE: ${promiseCode(p)}]]`, 'b', 'B');
        expect(loadPromises()[0].status).toBe('open');
        executePromiseDirectives(`[[PROMISE_DONE: ${promiseCode(p)}]]`, 'a', 'A');
        expect(loadPromises()[0]).toMatchObject({ status: 'done', settledBy: 'char' });
    });
    it('做不到要留原因', () => {
        const p = addPromise({ charId: 'a', what: '陪你' });
        executePromiseDirectives(`[[PROMISE_DROP: ${promiseCode(p)} | 航班取消]]`, 'a', 'A');
        expect(loadPromises()[0]).toMatchObject({ status: 'dropped', reason: '航班取消' });
    });
    it('恢复备份按 id 合并', () => {
        const p = addPromise({ charId: 'a', what: '陪你' });
        importPromises([{ ...p, status: 'done' }, { ...p, id: 'pr-other', what: '另一件' }]);
        expect(loadPromises()).toHaveLength(2);
        expect(openPromises(loadPromises())).toHaveLength(1);
    });
});

describe('提示', () => {
    it('一次答应几件只弹一条', () => {
        const calls: string[] = [];
        executePromiseDirectives('[[PROMISE: 陪你]][[PROMISE: 修灯]]', 'a', 'A', msg => calls.push(msg));
        expect(calls).toEqual(['A 记下了：陪你；A 记下了：修灯']);
    });
});

describe('重写时撤回', () => {
    it('只撤这之后新记的、还没结的', () => {
        addPromise({ charId: 'a', what: '早就答应的' }, 100);
        const done = addPromise({ charId: 'a', what: '已经做到的' }, 300);
        settlePromise(done.id, 'done', 'char');
        addPromise({ charId: 'a', what: '刚才那段答应的' }, 300);
        addPromise({ charId: 'b', what: '别的角色的' }, 300);
        retractPromisesSince('a', 200);
        expect(loadPromises().map(p => p.what).sort()).toEqual(['别的角色的', '已经做到的', '早就答应的'].sort());
    });
});

describe('给 TA 看', () => {
    it('过期和今天的单独点出来，别等她问', () => {
        const list = [
            addPromise({ charId: 'a', what: '修灯', date: '2026-10-28' }),
            addPromise({ charId: 'a', what: '陪你', date: '2026-10-30', time: '20:00' }),
        ];
        const text = buildPromisesInjection('a', { userName: '阿萌', now: NOW, list });
        expect(text).toContain('过期 2 天：修灯');
        expect(text).toContain('今天要做：陪你（20:00）');
        expect(text).toContain('别等阿萌来问');
    });
    it('带现实处境的烛下承诺只留在烛下', () => {
        executePromiseDirectives('[[PROMISE: 明天 | 想办法回国陪你]]', 'a', 'A', undefined, { deepTalk: true });
        const list = loadPromises();
        expect(list[0].candleOnly).toBe(true);
        expect(buildPromisesInjection('a', { now: NOW, list })).not.toContain('回国');
        expect(buildPromisesInjection('a', { now: NOW, list, inCandle: true })).toContain('回国');
        expect(promisesForSnapshot('a', new Date(), list)).toEqual([]);
    });
    it('快照只带有日期、两天内和过期的', () => {
        const list = [
            addPromise({ charId: 'a', what: '今天', date: '2026-10-30' }),
            addPromise({ charId: 'a', what: '很久以后', date: '2026-11-20' }),
            addPromise({ charId: 'a', what: '没定' }),
        ];
        expect(promisesForSnapshot('a', NOW, list).map(p => p.what)).toEqual(['今天']);
        expect(promiseDue({ date: '2026-10-20' }, '2026-10-30')).toBe('overdue');
    });
    it('阿萌标过的不再提醒', () => {
        const p = addPromise({ charId: 'a', what: '陪你', date: '2026-10-30' });
        settlePromise(p.id, 'dropped', 'user');
        const text = buildPromisesInjection('a', { now: new Date(), list: loadPromises() });
        expect(text).not.toContain('今天要做');
        expect(text).toContain('标成了你没做到：「陪你」');
    });
});
