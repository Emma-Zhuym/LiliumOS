// [EM-START: db-reconnect]
import { describe, expect, it, vi } from 'vitest';

import { createReconnectingReader } from './dbReconnect';

const bad = () => Promise.reject(new Error('Attempt to get records from database without an in-progress transaction'));

describe('createReconnectingReader', () => {
    it('读成功就不重连', async () => {
        const reset = vi.fn(async () => {});
        const read = createReconnectingReader(reset, { delayMs: 0 });
        await expect(read(async () => 1)).resolves.toBe(1);
        expect(reset).not.toHaveBeenCalled();
    });

    it('失败一次：换新连接后重读成功', async () => {
        let healthy = false;
        const reset = vi.fn(async () => { healthy = true; });
        const read = createReconnectingReader(reset, { delayMs: 0 });
        await expect(read(() => (healthy ? Promise.resolve('ok') : bad()))).resolves.toBe('ok');
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it('一批读同时失败，只重连一次，大家都重读成功', async () => {
        let healthy = false;
        const reset = vi.fn(async () => { healthy = true; });
        const read = createReconnectingReader(reset, { delayMs: 0 });
        const one = (v: string) => read(() => (healthy ? Promise.resolve(v) : bad()));
        await expect(Promise.all([one('themes'), one('songs'), one('novels')])).resolves.toEqual(['themes', 'songs', 'novels']);
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it('重连后还失败就把错误交给调用方去降级', async () => {
        const read = createReconnectingReader(async () => {}, { delayMs: 0 });
        await expect(read(bad)).rejects.toThrow('in-progress transaction');
    });

    it('重连本身出错也照样重读', async () => {
        let calls = 0;
        const read = createReconnectingReader(async () => { throw new Error('close failed'); }, { delayMs: 0 });
        await expect(read(() => (calls++ === 0 ? bad() : Promise.resolve(7)))).resolves.toBe(7);
    });
});
// [EM-END: db-reconnect]
