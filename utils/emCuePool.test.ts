import { beforeEach, describe, expect, it } from 'vitest';
import {
    buildCueInjection, CUE_KEY_COOLDOWN_MS, CUE_MIN_GAP_MS, CUE_SOURCE_COOLDOWN_MS, CUE_SOURCE_WEIGHTS, formatCueInjection,
    getPendingCue, loadCueState, noteCueToolUse, pickCue, recordCuePicked, setPendingCue, shouldRollCue, type Cue,
} from './emCuePool';

const NOW = Date.parse('2026-10-14T20:00:00.000Z');
const cue = (source: Cue['source'], key = `${source}:1`, extra: Partial<Cue> = {}): Cue => ({ source, dedupeKey: key, text: `${source} 的念头`, ...extra });
const empty = () => ({ lastAt: 0, bySource: {}, byKey: {}, log: [] });

describe('契机池', () => {
    beforeEach(() => localStorage.clear());

    it('权重合计 1', () => {
        const total = Object.values(CUE_SOURCE_WEIGHTS).reduce((sum, w) => sum + Math.round(w * 1000), 0);
        expect(total).toBe(1000);
    });

    it('先掷有没有念头；离上一个太近就不闪', () => {
        expect(shouldRollCue(empty(), NOW, () => 0.05)).toBe(true);
        expect(shouldRollCue(empty(), NOW, () => 0.5)).toBe(false);
        expect(shouldRollCue({ ...empty(), lastAt: NOW - CUE_MIN_GAP_MS + 1 }, NOW, () => 0)).toBe(false);
    });

    it('按来源权重抽，四种都抽得到；冷却里的不抽', () => {
        const all = [cue('finance'), cue('kitchen'), cue('calendar'), cue('own_life')];
        const seen = new Set<string>();
        for (let i = 0; i < 100; i += 1) seen.add(pickCue(all, empty(), NOW, () => i / 100)!.source);
        expect(seen).toEqual(new Set(['finance', 'kitchen', 'calendar', 'own_life']));

        const cooled = { ...empty(), bySource: { finance: NOW - CUE_SOURCE_COOLDOWN_MS + 1000 } };
        for (let i = 0; i < 20; i += 1) expect(pickCue(all, cooled, NOW, () => i / 20)!.source).not.toBe('finance');
        const sameKey = { ...empty(), byKey: { 'kitchen:1': NOW - CUE_KEY_COOLDOWN_MS + 1000 } };
        expect(pickCue([cue('kitchen')], sameKey, NOW)).toBeNull();
        expect(pickCue([], empty(), NOW)).toBeNull();
    });

    it('抽中了记冷却和账；带工具组的真用了工具再记一笔', () => {
        const c = cue('finance', 'finance:a', { toolGroup: 'finance' });
        recordCuePicked('lumi', c, 'local', NOW);
        const state = loadCueState('lumi');
        expect(state.lastAt).toBe(NOW);
        expect(state.bySource.finance).toBe(NOW);
        expect(state.log).toEqual([{ at: NOW, source: 'finance', key: 'finance:a', route: 'local' }]);

        setPendingCue('lumi', c);
        noteCueToolUse('lumi', 'finance', NOW + 1000);
        expect(loadCueState('lumi').log[0].toolUsed).toBe(true);
    });

    it('写给模型的只是闪过了什么，没有命令', () => {
        const text = formatCueInjection(cue('kitchen'));
        expect(text).toContain('你脑子里忽然闪过：kitchen 的念头');
        expect(text).toContain('也可以先放着');
        expect(text).not.toMatch(/必须|一定要/);
    });

    it('这一轮没抽中就是空，不把上一轮的带过来', () => {
        setPendingCue('lumi', cue('calendar'));
        expect(buildCueInjection('lumi')).toContain('calendar 的念头');
        setPendingCue('lumi', null);
        expect(buildCueInjection('lumi')).toBe('');
        expect(buildCueInjection('nobody')).toBe('');
    });

    it('念头只拼进第一份提示词：之后的主动消息、小小窝拼同一个角色时不再带上', () => {
        const c = cue('finance');
        setPendingCue('lumi', c);
        expect(buildCueInjection('lumi')).toContain('finance 的念头');
        expect(buildCueInjection('lumi')).toBe('');
        expect(getPendingCue('lumi')).toEqual(c);
    });
});

describe('契机池按劲儿加权', () => {
    it('哪股劲儿强，跟它沾边的来源权重高；没劲儿数据就是原表', async () => {
        const { driveWeightedWeights, driveCueChance, CUE_CHANCE_MAX, CHAT_CUE_CHANCE } = await import('./emCuePool');
        expect(driveWeightedWeights([])).toEqual(CUE_SOURCE_WEIGHTS);
        const caring = driveWeightedWeights([{ drive: 'concern', level: 'high' }]);
        expect(caring.kitchen).toBeCloseTo(CUE_SOURCE_WEIGHTS.kitchen * 3);
        expect(caring.own_life).toBeCloseTo(CUE_SOURCE_WEIGHTS.own_life);
        expect(driveCueChance([])).toBe(CHAT_CUE_CHANCE);
        expect(driveCueChance([{ drive: 'miss', level: 'high' }, { drive: 'stress', level: 'mid' }, { drive: 'x', level: 'mid' }])).toBe(CUE_CHANCE_MAX);
    });
});
