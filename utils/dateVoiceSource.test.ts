import { describe, expect, it } from 'vitest';
import { resolveCurrentDateVoiceLine } from './dateVoiceSource';

describe('GAL voice favorite source identity', () => {
    const parsed = [{ text: '“嗯。”', sourceLineIndex: 0 }, { text: '他望向窗外。', sourceLineIndex: 2 }, { text: '“嗯。”', sourceLineIndex: 3 }];
    // A legacy saved batch did not include original line indexes.
    const batch = parsed.map(({ text }) => ({ text }));
    it('keeps repeated dialogue as two distinct rows across reading and GAL mode', () => {
        expect(resolveCurrentDateVoiceLine(parsed, batch, 2, '“嗯。”')).toBe(0);
        expect(resolveCurrentDateVoiceLine(parsed, batch, 0, '“嗯。”')).toBe(3);
    });
    it('rejects an unrelated message that happens to contain the same last line', () => {
        expect(resolveCurrentDateVoiceLine([{ text: '“嗯。”', sourceLineIndex: 0 }], batch, 0, '“嗯。”')).toBeNull();
    });
    it('refuses a stale cursor or missing source instead of inventing a duplicate identity', () => {
        expect(resolveCurrentDateVoiceLine(parsed, batch, 1, '“嗯。”')).toBeNull();
        expect(resolveCurrentDateVoiceLine(batch, batch, 0, '“嗯。”')).toBeNull();
    });
});
