import { describe, expect, it } from 'vitest';
import type { ApiPreset } from '../types';
import { planApiChainSync } from './emApiChain';

const preset = (id: string, apiKey = 'k'): ApiPreset => ({ id, name: `预设${id}`, config: { baseUrl: `https://${id}.example/v1`, apiKey, model: `m-${id}` } as ApiPreset['config'] });

describe('planApiChainSync', () => {
    it('空位和没填全的跳过，后面的往前补；没用上的固定名都删', () => {
        const plan = planApiChainSync(
            { main: ['', 'a', 'gone', 'b'], sub: ['c', '', '', ''] },
            [preset('a'), preset('b'), preset('c'), preset('x', '')],
        );
        expect(plan.order).toEqual({ main: ['chain-main-1', 'chain-main-2'], sub: ['chain-sub-1'] });
        expect(plan.puts.map(p => [p.ref, p.model])).toEqual([['chain-main-1', 'm-a'], ['chain-main-2', 'm-b'], ['chain-sub-1', 'm-c']]);
        expect(plan.deletes).toEqual(['chain-main-3', 'chain-main-4', 'chain-sub-2', 'chain-sub-3', 'chain-sub-4']);
        expect(plan.skipped).toEqual(['gone']);
    });
    it('全空：两串都清掉', () => {
        const plan = planApiChainSync({ main: [], sub: [] }, []);
        expect(plan.order).toEqual({ main: [], sub: [] });
        expect(plan.deletes).toHaveLength(8);
    });
});
