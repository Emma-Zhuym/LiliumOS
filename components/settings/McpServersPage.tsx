// [EM-START: settings-subpages-f]
/**
 * 设置 → MCP 工具。原来是「状态面板 + 一张紫色说明卡 + 一大张服务器卡片」，合成一页分组列表：
 * - 状态卡：几台在线（emMcpHealth 体检，5 分钟内不重测），右下「全部重测」
 * - 服务器：一台一行，右边开关；点一行在原地展开它的设置（地址、鉴权、代理、给哪些聊天用、测试、删除）
 * - 原生 tools 开关、说明链接
 *
 * 逻辑从 apps/Settings.tsx 的 McpServersCard 原样搬来：配置存本机（utils/mcpClient），
 * 改了就存并调 onMcpConfigChanged（Settings 那边攒一下再把 tool_config 重传上云，离开这一页时立刻传）。
 */

import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import {
    createMcpServer, getMcpUseNativeTools, loadMcpServers, resetMcpSession, saveMcpServers, setMcpUseNativeTools, testMcpConnection,
    type McpServerConfig,
} from '../../utils/mcpClient';
import { checkMcpHealth, getMcpHealth, subscribeMcpHealth } from '../../utils/emMcpHealth';
import { relativeAgo } from '../../utils/emSettingsPages';
import { trackEvent } from '../../utils/analytics';
import { F } from '../../utils/clayTokens';
import { Chips, FieldRow, Group, Hero, HeroAction, Page, Row, Toggle, ToggleRow, resultSub, type TestResult } from './SettingsParts';

const ALL = '__all__';

const McpServersPage: React.FC<{
    addToast: (msg: string, type?: any) => void;
    onMcpConfigChanged?: () => void;
    onHelp: () => void;
    guideUrl: string;
}> = ({ addToast, onMcpConfigChanged, onHelp, guideUrl }) => {
    const { characters, groups } = useOS();
    const [servers, setServers] = useState<McpServerConfig[]>(() => loadMcpServers());
    const serversRef = useRef(servers);
    const [openId, setOpenId] = useState<string | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [results, setResults] = useState<Record<string, TestResult>>({});
    const [nativeTools, setNativeTools] = useState<boolean>(() => getMcpUseNativeTools());
    const [{ health, checking }, setHealth] = useState(getMcpHealth);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const off = subscribeMcpHealth((h, c) => { setHealth({ health: h, checking: c }); setNow(Date.now()); });
        void checkMcpHealth();
        return off;
    }, []);

    const persist = (next: McpServerConfig[]) => {
        serversRef.current = next;
        setServers(next);
        saveMcpServers(next);
        onMcpConfigChanged?.();
    };

    // 读 ref 而不是闭包里的 servers：测试连接是 await 回来才写工具清单，那时清单可能已经被改过
    const update = (id: string, patch: Partial<McpServerConfig>) => {
        persist(serversRef.current.map(s => s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s));
        // URL / 鉴权头 / 代理变了，旧 session 不能再用
        if (patch.url !== undefined || patch.token !== undefined || patch.customHeaders !== undefined || patch.proxyUrl !== undefined || patch.proxyKey !== undefined) {
            resetMcpSession(id);
        }
    };

    const addServer = () => {
        const s = createMcpServer(`MCP 服务器 ${serversRef.current.length + 1}`, '');
        persist([...serversRef.current, s]);
        setOpenId(s.id);
    };

    const removeServer = (id: string) => {
        resetMcpSession(id);
        persist(serversRef.current.filter(s => s.id !== id));
        setOpenId(null);
    };

    const discover = async (id: string) => {
        const server = serversRef.current.find(s => s.id === id);
        if (!server) return;
        if (!server.url.trim()) { addToast('请先填写服务器 URL', 'error'); return; }
        setTestingId(id);
        setResults(prev => ({ ...prev, [id]: { tone: 'busy', text: '正在连…' } }));
        try {
            const r = await testMcpConnection(server);
            setResults(prev => ({ ...prev, [id]: { tone: r.ok ? 'ok' : 'bad', text: r.message } }));
            // 失败原因只上报归类后的固定枚举：原始报错里可能带服务器地址和返回内容，不能外发
            if (r.ok) {
                trackEvent('测试 MCP 服务器连接', { result: r.tools?.length ? 'connected' : 'connected-no-tools' });
            } else {
                const msg = r.message || '';
                const failureKind = /超时/.test(msg) ? 'timeout'
                    : /鉴权失败/.test(msg) ? 'auth-failed'
                    : /请求失败/.test(msg) ? 'fetch-failed'
                    : /MCP HTTP/.test(msg) ? 'http-error'
                    : 'other';
                trackEvent('测试 MCP 服务器连接', { result: 'failed', failureKind });
            }
            if (r.ok && r.tools) update(id, { tools: r.tools });
        } finally {
            setTestingId(null);
        }
    };

    const setEnabled = (server: McpServerConfig, on: boolean) => {
        if (on && !(server.tools?.length)) {
            addToast('先点「测试连接」拿到工具清单再启用', 'error');
            trackEvent('启用未测通的 MCP 服务器被拦下');
            return;
        }
        update(server.id, { enabled: on });
    };

    const healthOf = (id: string) => health?.results.find(r => r.id === id);
    const checked = health?.results ?? [];
    const online = checked.filter(r => r.ok).length;
    const bindOptions = [
        { value: ALL, label: '所有聊天' },
        ...characters.map(c => ({ value: c.id, label: c.name })),
        ...groups.map(g => ({ value: g.id, label: `群 · ${g.name}` })),
    ];

    return (
        <Page testId="settings-mcp-page">
            {servers.length ? (
                <Hero title={checking && !health ? '正在测…' : checked.length ? `${online}/${checked.length} 在线` : '都关着'}
                    sub={checking ? '挨个连一遍，几秒钟' : health ? `${relativeAgo(health.checkedAt, now)}测过 · 只算开着的` : '打开的服务器才会测'}
                    dot={checked.length ? (online === checked.length ? 'ok' : 'bad') : null}
                    actions={<HeroAction onClick={() => void checkMcpHealth(true)} disabled={checking}>{checking ? '测试中…' : '全部重测'}</HeroAction>} />
            ) : (
                <Hero title="还没接 MCP 服务器"
                    sub="给角色外接工具服务器：记忆库、搜索、笔记、智能家居……接上什么，角色就多什么本事。服务器要自己准备。"
                    actions={<HeroAction onClick={onHelp}>MCP 是什么</HeroAction>} />
            )}

            <Group title="服务器" foot="填地址 → 测试连接拿到工具 → 打开开关，角色就能在聊天里用。被浏览器跨域拦住时填「代理 URL」。">
                {servers.map(server => {
                    const h = healthOf(server.id);
                    const open = openId === server.id;
                    const bound = server.charIds?.length ? `给 ${server.charIds.length} 个聊天` : '所有聊天';
                    const staleBinding = !!server.charIds?.some(id => !characters.some(c => c.id === id) && !groups.some(g => g.id === id));
                    return (
                        <React.Fragment key={server.id}>
                            <div className="flex items-center" style={{ minHeight: 56, paddingRight: 14, gap: 12 }}>
                                <button type="button" onClick={() => setOpenId(open ? null : server.id)} aria-expanded={open}
                                    className="flex-1 min-w-0 text-left active:opacity-60 transition-opacity"
                                    style={{ padding: '8px 0 8px 14px', background: 'transparent', border: 'none' }}>
                                    <span className="block truncate" style={{ fontSize: 15, lineHeight: '21px', color: F.textPrimary }}>{server.name || '没起名的服务器'}</span>
                                    <span className="block truncate" style={{ fontSize: 12, lineHeight: '17px', color: h && !h.ok ? undefined : F.textTertiary }}>
                                        {h ? (h.ok ? `在线 · ${h.toolCount || server.tools?.length || 0} 个工具` : resultSub({ tone: 'bad', text: `连不上 · ${h.message}` }))
                                            : server.tools?.length ? `${server.tools.length} 个工具 · ${bound}` : (server.url ? '还没测过' : '没填地址')}
                                    </span>
                                </button>
                                <Toggle checked={server.enabled} onChange={on => setEnabled(server, on)} label={`启用 ${server.name || '服务器'}`} />
                            </div>
                            {open && (
                                <>
                                    <FieldRow label="名称" value={server.name} placeholder="比如 Notion" onCommit={v => update(server.id, { name: v.trim() })} />
                                    <FieldRow label="服务器 URL" value={server.url} mono placeholder="https://mcp.example.com/mcp" autoCommitMs={600} onCommit={v => update(server.id, { url: v.trim() })} />
                                    <FieldRow label="Bearer Token（可选）" value={server.token || ''} secret mono placeholder="服务器要鉴权时填" autoCommitMs={600} onCommit={v => update(server.id, { token: v.trim() })} />
                                    {(server.customHeaders || []).map((header, index) => (
                                        <React.Fragment key={`h${index}`}>
                                            <FieldRow label={`请求头 ${index + 1} 名称`} value={header.name} mono placeholder="X-API-Key" autoCommitMs={600}
                                                onCommit={v => update(server.id, { customHeaders: (server.customHeaders || []).map((item, i) => i === index ? { ...item, name: v } : item) })} />
                                            <FieldRow label={`请求头 ${index + 1} 的值`} value={header.value} secret mono placeholder="值" autoCommitMs={600}
                                                onCommit={v => update(server.id, { customHeaders: (server.customHeaders || []).map((item, i) => i === index ? { ...item, value: v } : item) })} />
                                            <Row title={`删掉请求头 ${index + 1}`} tone="danger"
                                                onClick={() => update(server.id, { customHeaders: (server.customHeaders || []).filter((_, i) => i !== index) })} />
                                        </React.Fragment>
                                    ))}
                                    <Row title="添加请求头" sub="X-API-Key 这类不是 Bearer 的鉴权；名称或值空着的不会发" tone="link"
                                        onClick={() => update(server.id, { customHeaders: [...(server.customHeaders || []), { name: '', value: '' }] })} />
                                    <FieldRow label="代理 URL（可选，空着 = 直连）" value={server.proxyUrl || ''} mono placeholder="http://localhost:18061 或你的 Worker" autoCommitMs={600}
                                        onCommit={v => update(server.id, { proxyUrl: v.trim() })} />
                                    {(server.proxyUrl || '').trim() && (
                                        <FieldRow label="代理密钥（自部署 Worker 的 PROXY_KEY）" value={server.proxyKey || ''} secret mono placeholder="没设就空着" autoCommitMs={600}
                                            onCommit={v => update(server.id, { proxyKey: v.trim() })} />
                                    )}
                                    <div style={{ padding: '10px 14px 0', fontSize: 12, color: staleBinding ? undefined : F.textTertiary }}>
                                        {staleBinding ? resultSub({ tone: 'bad', text: '绑定里有已经删掉的角色或群，点一下清掉' }) : '给哪些聊天用'}
                                    </div>
                                    <Chips options={bindOptions} selected={server.charIds?.length ? server.charIds : [ALL]}
                                        onToggle={id => {
                                            if (id === ALL) { update(server.id, { charIds: [] }); return; }
                                            const cur = server.charIds || [];
                                            update(server.id, { charIds: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
                                        }} />
                                    <Row title={testingId === server.id ? '测试中…' : '测试连接'} tone="link" disabled={testingId === server.id}
                                        sub={results[server.id] ? resultSub(results[server.id]) : (server.tools?.length ? `工具：${server.tools.map(t => t.name).join('、')}` : undefined)}
                                        onClick={() => void discover(server.id)} />
                                    <Row title="删除这台服务器" tone="danger" onClick={() => removeServer(server.id)} />
                                </>
                            )}
                        </React.Fragment>
                    );
                })}
                <Row title="添加服务器" tone="link" onClick={addServer} />
            </Group>

            <Group foot="Token、请求头和配置只存这台手机；走代理时请求会经过你自己配的代理。会真的对外做事的工具（发布、下单、删除），角色会先问你。">
                <ToggleRow title="原生 tools 工具调用" sub="调用更稳；模型或中转不支持 function calling 才关，退回文字兼容"
                    checked={nativeTools}
                    onChange={next => {
                        setNativeTools(next);
                        setMcpUseNativeTools(next);
                        onMcpConfigChanged?.();
                        trackEvent('切换原生工具调用', { state: next ? 'on' : 'off' });
                    }} />
            </Group>

            <Group>
                <Row title="MCP 是什么" onClick={onHelp} />
                <Row title="接入教程" tone="link" href={guideUrl} />
            </Group>
        </Page>
    );
};

export default McpServersPage;
// [EM-END: settings-subpages-f]
