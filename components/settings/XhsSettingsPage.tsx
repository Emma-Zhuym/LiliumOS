// [EM-START: settings-subpages-f]
/**
 * 设置 → 小红书（角色能用的工具）。两种接法二选一：
 * - 本地：mini 上常驻的 xiaohongshu-mcp（第 28 节），填 Funnel 地址 + 访问令牌，在这里拿二维码扫码登录
 * - Lite：主代理 worker 的 /api 桥，粘一次 cookie
 * 只看不发（阿萌 2026-09-26 定）：发帖 / 评论在网关那边停用了，这里不再教。
 */

import React, { useState } from 'react';
import type { XhsMcpConfig } from '../../types';
import { XhsMcpClient, type XhsLoginQrcode } from '../../utils/xhsMcpClient';
import { getProxyWorkerUrl } from '../../utils/proxyWorker';
import { trackEvent } from '../../utils/analytics';
import { F, R, STATUS } from '../../utils/clayTokens';
import ClayDialog from '../os/ClayDialog';
import { SETTINGS_HUE } from './SettingsHome';
import { FieldRow, Group, Hero, HeroAction, Page, Row, Segmented, ToggleRow, resultSub, type TestResult } from './SettingsParts';
import { useRealtimeSettings } from './useRealtimeSettings';

type Mode = 'local' | 'lite';

const DEFAULT_LOCAL_URL = 'http://localhost:18060/mcp';
const RISK_TEXT = '这条路是网页爬虫，账号有被风控的可能。建议用小号，cookie 过几天到几周会失效，失效了重新复制一份。';
const COOKIE_GUIDE = [
    '【获取小红书 cookie 教程】',
    '1. 用电脑浏览器(Chrome/Edge)登录实际分配给你的站点：www.xiaohongshu.com 或 www.rednote.com',
    '2. 按 F12 打开开发者工具，切到「Network/网络」标签',
    '3. 刷新页面，点列表最上面那条「explore」(document 类型，发给当前网站的主请求)',
    '4. 右侧切到「Headers/标头」，往下滚到「Request Headers/请求标头」',
    '5. 找到 cookie: 开头那一行(很长一串)',
    '6. 复制它后面整段的值：可把 Request Headers 右边的「Raw」开关打开看纯文本更好选，或在值上右键 Copy value，或选中后 Ctrl+C',
    '7. 确认这串里有 a1= 和 web_session= 两个字段(最关键)，粘到 cookie 框',
    'Lite 会自动判断这串 Cookie 属于国内小红书还是全球 RedNote；不用自己补 gid、bRequestId 等会随站点变化的字段。',
    '注意：别用 Console 的 document.cookie，拿不到 web_session(httpOnly)。',
].join('\n');

/** lite 桥接地址带 /api，本地 MCP 不带（与 xhsMcpClient.detectMode 一致）。 */
const isLocalUrl = (url: string) => !!url && !url.includes('/api');

const XhsSettingsPage: React.FC = () => {
    const { config, commit, latest, addToast } = useRealtimeSettings();
    const saved = config.xhsMcpConfig;
    const liteUrl = `${getProxyWorkerUrl()}/api`;
    const [mode, setMode] = useState<Mode>(!saved?.serverUrl || isLocalUrl(saved.serverUrl) ? 'local' : 'lite'); // 没配过默认本地：阿萌用的是 mini 那台
    const [localUrl, setLocalUrl] = useState(isLocalUrl(saved?.serverUrl || '') ? saved!.serverUrl : DEFAULT_LOCAL_URL);
    const [result, setResult] = useState<TestResult>(null);
    const [qr, setQr] = useState<{ status: string; image?: string }>({ status: '' });
    const [guideOpen, setGuideOpen] = useState(false);
    const [confirmLite, setConfirmLite] = useState<null | (() => void)>(null);
    const on = !!(config.xhsEnabled && saved?.enabled);

    /** 按「这一页现在的样子」拼一份配置存下去；next 里给的优先。 */
    const save = (next: { enabled?: boolean; mode?: Mode; localUrl?: string } & Partial<XhsMcpConfig> = {}) => {
        const cur = latest.current.xhsMcpConfig;
        const m = next.mode ?? mode;
        const url = next.localUrl ?? localUrl;
        const enabled = next.enabled ?? on;
        const cfg: XhsMcpConfig = {
            ...cur,
            enabled,
            serverUrl: m === 'lite' ? liteUrl : url,
            cookie: m === 'lite' ? ((next.cookie ?? cur?.cookie) || '').trim() || undefined : undefined,
            authToken: m === 'local' ? ((next.authToken ?? cur?.authToken) || '').trim() || undefined : undefined, // [EM: xhs-mini-mcp]
            platform: m === 'lite' ? (next.platform ?? cur?.platform) : undefined,
            loggedInNickname: (next.loggedInNickname ?? cur?.loggedInNickname) || undefined,
            loggedInUserId: (next.loggedInUserId ?? cur?.loggedInUserId) || undefined,
            userXsecToken: next.userXsecToken ?? cur?.userXsecToken,
        };
        commit({ xhsEnabled: enabled, xhsMcpConfig: cfg });
    };

    /** 切到 / 打开 Lite 之前先讲清楚风险。 */
    const guardLite = (action: () => void) => setConfirmLite(() => action);

    const setEnabled = (next: boolean) => {
        if (next && mode === 'lite') { guardLite(() => save({ enabled: true })); return; }
        save({ enabled: next });
        setResult(null);
    };

    const switchMode = (m: Mode) => {
        if (m === mode) return;
        const apply = () => { setMode(m); save({ mode: m }); setResult(null); setQr({ status: '' }); };
        if (m === 'lite' && on) guardLite(apply); else apply();
    };

    const test = async () => {
        const cur = latest.current.xhsMcpConfig;
        const url = mode === 'lite' ? liteUrl : localUrl;
        const cookie = mode === 'lite' ? cur?.cookie?.trim() || undefined : undefined;
        if (!url) { setResult({ tone: 'bad', text: '先填服务地址' }); return; }
        if (mode === 'lite' && !cookie) { setResult({ tone: 'bad', text: '先粘贴小红书 cookie' }); return; }
        setResult({ tone: 'busy', text: '正在连…' });
        XhsMcpClient.setAuthToken(mode === 'local' ? cur?.authToken?.trim() || undefined : undefined); // [EM: xhs-mini-mcp]
        try {
            const r = await XhsMcpClient.testConnection(url, cookie);
            trackEvent('测试小红书桥接连接', { mode, result: r.connected ? 'connected' : 'failed' });
            if (!r.connected) { setResult({ tone: 'bad', text: `连不上：${r.error}` }); return; }
            const who = r.loggedIn ? (r.nickname ? `已登录 · ${r.nickname}` : '已登录') : '连上了，但没登录';
            const platform = r.platform ? (r.platform === 'rednote' ? ' · RedNote' : ' · 小红书') : '';
            setResult({ tone: r.loggedIn ? 'ok' : 'bad', text: `${who}${platform} · ${r.tools?.length || 0} 个功能可用` });
            // 昵称 / 用户 ID 只在还空着时自动补
            save({
                platform: r.platform,
                loggedInNickname: cur?.loggedInNickname || r.nickname,
                loggedInUserId: cur?.loggedInUserId || r.userId,
                userXsecToken: r.xsecToken,
            });
        } catch (e: any) {
            trackEvent('测试小红书桥接连接', { mode, result: 'network-error' });
            setResult({ tone: 'bad', text: `网络错误：${e?.message || e}` });
        }
    };

    // [EM-START: xhs-mini-mcp] 登录在服务器那个浏览器里：拿二维码用手机小红书扫
    const fetchQr = async () => {
        if (!localUrl) { setQr({ status: '先填服务地址' }); return; }
        setQr({ status: '正在向服务器要二维码…它要先打开小红书登录页，mini 在国外时一分钟左右很正常（最多等 2 分钟）' });
        XhsMcpClient.setAuthToken(latest.current.xhsMcpConfig?.authToken);
        const r = await XhsMcpClient.getQrcode(localUrl);
        if (!r.success) { setQr({ status: `没拿到：${r.error}` }); return; }
        const code = r.data as XhsLoginQrcode;
        if (code.loggedIn || !code.imageDataUrl) { setQr({ status: code.message || '服务器上已经是登录状态' }); return; }
        setQr({ status: `${code.message}\n扫完点一下「测试连接」确认。`, image: code.imageDataUrl });
    };
    // [EM-END: xhs-mini-mcp]

    const copyGuide = async () => {
        try {
            await navigator.clipboard.writeText(COOKIE_GUIDE);
            trackEvent('复制 cookie 教程文本', { result: 'copied' });
            addToast('教程复制好了', 'success');
        } catch {
            trackEvent('复制 cookie 教程文本', { result: 'clipboard-failed' });
            addToast('复制失败，长按手动选一下', 'error');
        }
    };

    const nickname = saved?.loggedInNickname;
    const heroTitle = result?.tone === 'ok' || result?.tone === 'bad' ? (result.tone === 'ok' ? '连上了' : '没连上')
        : nickname ? `上次登录的是 ${nickname}` : '还没测过';

    return (
        <Page testId="settings-xhs-page">
            <Group foot="角色只能刷首页、看笔记、点赞收藏；发帖和评论已经停用。">
                <ToggleRow title="让角色用小红书" sub="聊天里和心跳时都能去逛" checked={on} onChange={setEnabled} />
            </Group>

            {on && (
                <>
                    <Segmented standalone label="接在哪" value={mode} onChange={switchMode}
                        options={[{ value: 'local', label: '本地（Mac mini）' }, { value: 'lite', label: 'Lite（云端）' }]} />

                    <Hero title={heroTitle} sub={result ? resultSub(result) : (mode === 'local' ? 'mini 上那台 xiaohongshu-mcp' : '主代理 Worker 上的 Lite 桥')}
                        dot={result?.tone === 'ok' ? 'ok' : result?.tone === 'bad' ? 'bad' : null}
                        actions={<>
                            {mode === 'local' && <HeroAction onClick={() => void fetchQr()}>扫码登录</HeroAction>}
                            <HeroAction onClick={() => void test()} disabled={result?.tone === 'busy'}>测试连接</HeroAction>
                        </>} />

                    {mode === 'local' && qr.status && (
                        <Group title="扫码登录">
                            <div className="flex flex-col items-center" style={{ gap: 10, padding: 14 }}>
                                <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: F.textSecondary, whiteSpace: 'pre-wrap', alignSelf: 'stretch' }}>{qr.status}</p>
                                {qr.image && <img src={qr.image} alt="小红书登录二维码" style={{ width: 168, height: 168, borderRadius: R.small }} />}
                            </div>
                        </Group>
                    )}

                    {mode === 'local' ? (
                        <Group title="mini 上的服务" foot="跑在 mini 上时地址填 https://（mini 的 Funnel 域名）/xhs/mcp；令牌在 mini 的 xhs-mcp-token 文件里，本机直连可以不填。登录态存在 mini 上，换手机不用重新扫；二维码最好在电脑上打开这页扫。">
                            <FieldRow label="服务地址" value={localUrl} mono autoCommitMs={600} placeholder={DEFAULT_LOCAL_URL}
                                onCommit={v => { const url = v.trim(); setLocalUrl(url); save({ localUrl: url }); setResult(null); }} />
                            <FieldRow label="访问令牌" value={saved?.authToken || ''} secret mono autoCommitMs={600} placeholder="mini 上 xhs-mcp-token 那串"
                                onCommit={v => { save({ authToken: v }); setResult(null); }} />
                        </Group>
                    ) : (
                        <Group title="云端" foot="cookie 经 HTTPS 发到你的主代理 Worker，只用来给请求签名，服务器不保存、不记录。">
                            <FieldRow label="小红书 Cookie" value={saved?.cookie || ''} secret mono autoCommitMs={600} placeholder="a1=…; web_session=…"
                                onCommit={v => { save({ cookie: v, platform: undefined }); setResult(null); }} />
                            <Row title="怎么拿 cookie" value={guideOpen ? '收起' : undefined} onClick={() => { if (!guideOpen) trackEvent('展开获取 cookie 教程'); setGuideOpen(v => !v); }} />
                            {guideOpen && (
                                <pre style={{ margin: 0, padding: '10px 14px', fontFamily: 'inherit', fontSize: 12, lineHeight: '19px', color: F.textSecondary, whiteSpace: 'pre-wrap' }}>{COOKIE_GUIDE}</pre>
                            )}
                            {guideOpen && <Row title="复制教程" sub="可以粘去问别的 AI" tone="link" onClick={() => void copyGuide()} />}
                        </Group>
                    )}

                    <Group title="账号" foot="测试连接成功时会自动填上；也可以自己改。">
                        <FieldRow label="昵称" value={nickname || ''} placeholder="测试连接后自动获取" onCommit={v => save({ loggedInNickname: v.trim() })} />
                        <FieldRow label="用户 ID" value={saved?.loggedInUserId || ''} mono placeholder="用来打开主页" onCommit={v => save({ loggedInUserId: v.trim() })} />
                    </Group>
                </>
            )}

            <ClayDialog isOpen={!!confirmLite} title="用 Lite 接小红书？" onClose={() => setConfirmLite(null)}
                footer={<button type="button" className="w-full clay-press"
                    onClick={() => { const go = confirmLite; setConfirmLite(null); go?.(); setResult(null); }}
                    style={{ height: 46, borderRadius: R.button, background: SETTINGS_HUE.main, color: F.surface, fontSize: 15, fontWeight: 600, border: 'none' }}>
                    知道了，打开
                </button>}>
                <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: STATUS.warning.ink }}>{RISK_TEXT}</p>
            </ClayDialog>
        </Page>
    );
};

export default XhsSettingsPage;
// [EM-END: settings-subpages-f]
