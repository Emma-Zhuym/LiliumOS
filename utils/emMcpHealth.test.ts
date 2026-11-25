import { describe, expect, it } from 'vitest';
import { parseLoginStatus } from './emMcpHealth';

describe('parseLoginStatus', () => {
    it('B 站工具回的 JSON：登着 / 没登 / 没配', () => {
        expect(parseLoginStatus(JSON.stringify({ configured: true, source: 'global_config', logged_in: true }))).toBe('ok');
        expect(parseLoginStatus(JSON.stringify({ configured: true, logged_in: false }))).toBe('expired');
        expect(parseLoginStatus(JSON.stringify({ configured: false, logged_in: false }))).toBe('expired');
    });

    it('文字报错里带未登录也算过期', () => {
        expect(parseLoginStatus('COOKIE_EXPIRED: 凭证已过期')).toBe('expired');
    });

    it('认不出来就不下结论', () => {
        expect(parseLoginStatus('Bilibili 412 请求被拒')).toBeUndefined();
        expect(parseLoginStatus('{"ok":true}')).toBeUndefined();
    });
});
