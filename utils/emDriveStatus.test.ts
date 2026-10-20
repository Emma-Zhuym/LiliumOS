import { describe, expect, it } from 'vitest';
import { statusPhrase } from './emDriveStatus';

describe('查手机状态小组件', () => {
    it('最强的一两股写成一句话，不出现数字；不认识的跳过', () => {
        expect(statusPhrase([{ drive: 'miss', level: 'high' }, { drive: 'stress', level: 'mid' }])).toBe('很想你 · 工作上有点烦');
        expect(statusPhrase([{ drive: 'nope', level: 'mid' }])).toBe('');
        expect(statusPhrase([])).toBe('');
    });
});
