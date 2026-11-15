import { describe, expect, it } from 'vitest';
import type { ApiPreset } from '../types';
import { chatFallbackApis, planApiChainSync } from './emApiChain';

const preset = (id: string, apiKey = 'k'): ApiPreset => ({ id, name: `预设${id}`, config: { baseUrl: `https://${id}.example/v1`, apiKey, model: `m-${id}` } as ApiPreset['config'] });

describe('planApiChainSync', () => {
    it('只同步副（心跳）：空位和没填全的跳过，后面的往前补；主 API 不推给 mini', () => {
        const plan = planApiChainSync(
            { main: ['a', 'b', '', ''], sub: ['', 'a', 'gone', 'c'] },
            [preset('a'), preset('b'), preset('c'), preset('x', '')],
        );
        expect(plan.order).toEqual({ main: [], sub: ['chain-sub-1', 'chain-sub-2'] });
        expect(plan.puts.map(p => [p.ref, p.model])).toEqual([['chain-sub-1', 'm-a'], ['chain-sub-2', 'm-c']]);
        expect(plan.deletes).toEqual(['chain-sub-3', 'chain-sub-4']);
        expect(plan.skipped).toEqual(['gone']);
    });
    it('全空：副的都清掉', () => {
        const plan = planApiChainSync({ main: [], sub: [] }, []);
        expect(plan.order).toEqual({ main: [], sub: [] });
        expect(plan.deletes).toHaveLength(4);
    });
});

describe('chatFallbackApis', () => {
    it('按主 1→4，跟本来那条一样的、重复的、没填全的跳过', () => {
        const list = chatFallbackApis(
            { baseUrl: 'https://a.example/v1/', model: 'm-a' },
            [preset('a'), preset('b'), preset('c'), preset('x', '')],
            { main: ['a', 'x', 'b', 'b'], sub: [] },
        );
        expect(list.map(api => api.model)).toEqual(['m-b']);
    });
});
