// [EM-START: mounted-worldbook-groups]
import { describe, expect, it } from 'vitest';
import { groupMountedWorldbooks } from './mountedWorldbookGroups';

const wb = (id: string, category?: string) => ({ id, title: id, content: '', category } as any);

describe('mounted worldbooks grouped by book', () => {
    it('keeps the order books were first mounted, entries in mount order, ungrouped together', () => {
        const groups = groupMountedWorldbooks([wb('a1', '活人感'), wb('b1', '分寸'), wb('a2', '活人感'), wb('x'), wb('y', '  ')]);
        expect(groups.map(([c, rows]) => [c, rows.map(r => r.id)])).toEqual([
            ['活人感', ['a1', 'a2']],
            ['分寸', ['b1']],
            ['未分类设定 (General)', ['x', 'y']],
        ]);
    });
});
// [EM-END: mounted-worldbook-groups]
