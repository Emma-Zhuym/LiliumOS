// [EM-START: xhs-mini-mcp]
// mini 上自托管的 xiaohongshu-mcp：无状态服务器（不发 Mcp-Session-Id）、Bearer 令牌、扫码登录。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SERVER = 'https://mini.example.ts.net/xhs/mcp';
const PNG = 'iVBORw0KGgo=';

type Seen = { method: string; auth: string | null; session: string | null };

/** 新版上游的行为：Stateless，initialize 不回 session 头；可选开 AUTH_TOKEN。 */
const statelessServer = ({ token = '', qr = 'image' as 'image' | 'loggedIn' } = {}) => {
    const seen: Seen[] = [];
    const reply = (status: number, body: unknown) => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
        text: async () => JSON.stringify(body),
        json: async () => body,
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        const headers = init.headers || {};
        seen.push({ method: body.method, auth: headers.Authorization ?? null, session: headers['Mcp-Session-Id'] ?? null });
        if (token && headers.Authorization !== `Bearer ${token}`) return reply(401, { error: 'UNAUTHORIZED' });
        const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26' }
            : body.method === 'tools/list' ? { tools: [{ name: 'check_login_status' }, { name: 'get_login_qrcode' }, { name: 'search_feeds' }] }
                : body.params?.name === 'get_login_qrcode'
                    ? { content: qr === 'image'
                        ? [{ type: 'text', text: '请用小红书 App 在 2026-09-26 18:04:00 前扫码登录 👇' }, { type: 'image', mimeType: 'image/png', data: PNG }]
                        : [{ type: 'text', text: '你当前已处于登录状态' }] }
                    : body.params?.name === 'check_login_status'
                        ? { content: [{ type: 'text', text: '✅ 已登录\n用户名: 阿萌\n\n你可以使用其他功能了。' }] }
                        : { content: [{ type: 'text', text: '{"feeds":[]}' }] };
        return reply(200, { jsonrpc: '2.0', id: body.id, result });
    }));
    return { seen };
};

describe('自托管 xiaohongshu-mcp（mini）', () => {
    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('无状态服务器不发 Mcp-Session-Id 也能连上（原来会误报 CORS）', async () => {
        const { seen } = statelessServer();
        const { XhsMcpClient } = await import('./xhsMcpClient');
        const result = await XhsMcpClient.testConnection(SERVER);
        expect(result.error).toBeUndefined();
        expect(result.connected).toBe(true);
        expect(result.loggedIn).toBe(true);
        expect(result.nickname).toBe('阿萌');
        expect(result.tools).toContain('search_feeds');
        expect(seen.every(s => s.session === null)).toBe(true);
        // 工具名照样按别名映射到上游的名字
        expect((await XhsMcpClient.search(SERVER, '咖啡')).success).toBe(true);
        expect(seen.some(s => s.method === 'tools/call')).toBe(true);
    });

    it('每个请求都带 Bearer：设置页 set 的优先，否则读持久化配置', async () => {
        const { seen } = statelessServer({ token: 'secret' });
        localStorage.setItem('os_realtime_config', JSON.stringify({ xhsMcpConfig: { serverUrl: SERVER, authToken: 'secret' } }));
        const { XhsMcpClient } = await import('./xhsMcpClient');
        expect((await XhsMcpClient.search(SERVER, '咖啡')).success).toBe(true);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every(s => s.auth === 'Bearer secret')).toBe(true);
    });

    it('令牌不对：说清楚是令牌的问题，不说成 CORS', async () => {
        statelessServer({ token: 'secret' });
        const { XhsMcpClient } = await import('./xhsMcpClient');
        XhsMcpClient.setAuthToken('wrong');
        const result = await XhsMcpClient.testConnection(SERVER);
        expect(result.connected).toBe(false);
        expect(result.error).toContain('访问令牌');
        expect(result.error).not.toContain('CORS');
    });

    it('扫码登录：把 MCP 图片内容转成 data URL；已登录时没有图', async () => {
        statelessServer();
        const { XhsMcpClient } = await import('./xhsMcpClient');
        const qr = await XhsMcpClient.getQrcode(SERVER);
        expect(qr.success).toBe(true);
        expect(qr.data).toMatchObject({ loggedIn: false, imageDataUrl: `data:image/png;base64,${PNG}` });
        expect(qr.data.message).toContain('扫码登录');

        vi.resetModules();
        statelessServer({ qr: 'loggedIn' });
        const again = await (await import('./xhsMcpClient')).XhsMcpClient.getQrcode(SERVER);
        expect(again.data).toMatchObject({ loggedIn: true });
        expect(again.data.imageDataUrl).toBeUndefined();
    });
});
// [EM-END: xhs-mini-mcp]
