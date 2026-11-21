import { describe, it, expect } from 'vitest';
import { DB } from './db';

// [EM: date-history-index] 见面历史按 [charId, metadata.source] 索引读，「加载更早」用 beforeId 接着往前读。
describe('getRecentMessagesByCharIdAndSource', () => {
  it('只取见面消息、按时间正序、beforeId 接着往前读不重不漏', async () => {
    const charId = 'date-hist-char';
    const dateIds: number[] = [];
    for (let i = 0; i < 12; i++) {
      const isDate = i % 2 === 0;
      const id = await DB.saveMessage({
        charId, role: i % 4 === 0 ? 'user' : 'assistant', type: 'text', content: `m${i}`,
        timestamp: 1_000 + i, metadata: isDate ? { source: 'date' } : undefined,
      } as any);
      if (isDate) dateIds.push(id);
    }
    await DB.saveMessage({ charId: 'other-char', role: 'user', type: 'text', content: 'x', metadata: { source: 'date' } } as any);
    await DB.saveMessage({ charId, groupId: 'g1', role: 'user', type: 'text', content: 'g', metadata: { source: 'date' } } as any);

    const newest = await DB.getRecentMessagesByCharIdAndSource(charId, 'date', 3);
    expect(newest.map(m => m.id)).toEqual(dateIds.slice(3));

    const older = await DB.getRecentMessagesByCharIdAndSource(charId, 'date', 2, newest[0].id);
    expect(older.map(m => m.id)).toEqual(dateIds.slice(1, 3));

    const rest = await DB.getRecentMessagesByCharIdAndSource(charId, 'date', 5, older[0].id);
    expect(rest.map(m => m.id)).toEqual(dateIds.slice(0, 1));

    const none = await DB.getRecentMessagesByCharIdAndSource(charId, 'date', 5, dateIds[0]);
    expect(none).toEqual([]);
  });
});
