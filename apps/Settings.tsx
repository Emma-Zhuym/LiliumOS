import AppearanceEmergency from '../components/settings/AppearanceEmergency';
import AgentBackendSection from '../components/settings/AgentBackendSection'; // [EM: agent-backend-panel]
import FirecrawlSettings from '../components/settings/FirecrawlSettings';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { configFromPreset, findActivePresetId, type PresetSwitchPatch } from '../utils/apiPresetSwitch';
import type { APIConfig } from '../types';
import { useOS } from '../context/OSContext';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { extractContent, safeResponseJson } from '../utils/safeApi';
import { extractModelIds, normalizeModelIds } from '../utils/modelList';
import { EXPORT_CHUNK_SIZE, sliceRanges } from '../utils/backupExport';
import { bucketRetryCount, trackEvent } from '../utils/analytics';
import Modal from '../components/os/Modal';
import { getProxyWorkerUrl, setProxyWorkerUrl, DEFAULT_PROXY_WORKER } from '../utils/proxyWorker';
import { VOICE_ACTING_GUIDE } from '../utils/minimaxTts';
import { FISH_VOICE_ACTING_GUIDE } from '../utils/fishAudioTts';
import { DATE_VOICE_GUIDE } from '../utils/datePrompts';
import { PlugsConnected, ImageSquare, PencilSimple, X } from '@phosphor-icons/react';
import { loadMcpServers, saveMcpServers, createMcpServer, testMcpConnection, resetMcpSession, getMcpUseNativeTools, setMcpUseNativeTools, type McpServerConfig } from '../utils/mcpClient';
import { loadPushConfig, savePushConfig, registerScheduleOnWorker, startHeartbeat, stopHeartbeat, isPushConfigAvailable, ensureSubscribed, sendTestPush, getPushDiagnostics, resetSubscription, deepResetSubscription, type PushDiagnostics } from '../utils/proactivePushConfig';
import { ProactiveChat } from '../utils/proactiveChat';
import { InstantPushSettingsModal } from '../components/settings/InstantPushSettingsModal';
import { PushVapidSettingsModal } from '../components/settings/PushVapidSettingsModal';
import PushSubscriptionPanel from '../components/settings/PushSubscriptionPanel';
import ActiveMsgGlobalSettingsModal from '../components/settings/ActiveMsgGlobalSettingsModal';
import { syncAmsgLlmCredentials, syncAmsgToolConfig, syncAmsgToolConfigAndPrompts } from '../utils/amsgStateSync';
import { ActiveMsgClient } from '../utils/activeMsgClient';
import VersionInfo from '../components/settings/VersionInfo';
import { LoyalUserRecruitmentController } from '../components/LoyalUserRecruitmentEvent';
import { isPushVapidReady } from '../utils/pushVapid';
import ApiCallLogModal from '../components/settings/ApiCallLogModal';
import StorageUsagePanel from '../components/settings/StorageUsagePanel';
import ExternalImagesPanel from '../components/settings/ExternalImagesPanel'; // [EM: external-images-rescue]
import { DB } from '../utils/db';
import { getBackupReminderState, setBackupReminderIntervalDays, daysSinceLastBackup, BACKUP_REMINDER_MIN_DAYS, BACKUP_REMINDER_MAX_DAYS } from '../utils/backupReminder';
import {
    createAvatarModelBackup,
    getAvatarModelBackupInventory,
    restoreAvatarModelBackup,
    type AvatarModelBackupInventory,
    type AvatarModelBackupProgress,
} from '../utils/avatarModelBackup';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from '../utils/apiConfigNormalize';
import { describeImageWithVisionApi, VISION_API_TEST_IMAGE_DATA_URL, visionApiConfigFromPreset } from '../utils/visionApi';
import { buildImageModelsUrl, generateChatImage, resolveImageGenerationConfig } from '../utils/imageGeneration';
import { F, FONT, HUE, OVERLAY, R, S, SP, STATUS, iconButtonBare } from '../utils/clayTokens'; // [EM: settings-ios-list] FONT、iconButtonBare
import { askRestoreBackendConnection } from '../utils/activeMsgStore';
// [EM-START: github-backup-status]
import { shouldUseGithubProxy } from '../utils/githubClient';
import CloudBackupRestoreList, { type CloudBackupListState } from '../components/settings/CloudBackupRestoreList';
import GithubBackupRoute from '../components/settings/GithubBackupRoute';
import ClayDialog from '../components/os/ClayDialog';
import { groupApiPresets, listPresetGroups } from '../utils/apiPresetGroups'; // [EM: api-preset-group]
// [EM-END: github-backup-status]
// [EM-START: settings-ios-list]
import SettingsHome, { type SettingsHomeValues } from '../components/settings/SettingsHome';
import McpStatusPanel from '../components/settings/McpStatusPanel';
import ProfileSettingsPage from '../components/settings/ProfileSettingsPage';
import { CaretLeft } from '@phosphor-icons/react';
import { MULTI_SECTION_PAGES, SETTINGS_PAGE_TITLES, relativeAgo, type SettingsPageId } from '../utils/emSettingsPages';
import { staleBackupDays } from '../utils/autoCloudBackup';
import { loadInstantConfig } from '../utils/instantPushClient';
import { APP_VERSION } from '../utils/buildInfo';
import { SETTINGS_F_CLASS, SETTINGS_F_VARS } from '../components/settings/settingsF'; // [EM: settings-skin-f]
import SettingsSheet, { SettingsInlineSlotContext } from '../components/settings/SettingsSheet'; // [EM: settings-inline-config]
import RealtimeSensePage from '../components/settings/RealtimeSensePage'; // [EM: settings-subpages-f]
import DiarySyncPage from '../components/settings/DiarySyncPage'; // [EM: settings-subpages-f]
import XhsSettingsPage from '../components/settings/XhsSettingsPage'; // [EM: settings-subpages-f]
import BackupSettingsPage from '../components/settings/BackupSettingsPage'; // [EM: settings-subpages-f]
import IntifaceSettingsPage from '../components/settings/IntifaceSettingsPage'; // [EM: settings-subpages-f]
import ProxySettingsPage from '../components/settings/ProxySettingsPage'; // [EM: settings-subpages-f]
import MainApiPage from '../components/settings/MainApiPage'; // [EM: settings-subpages-f]
import VisionApiPage from '../components/settings/VisionApiPage'; // [EM: settings-subpages-f]
import ImageApiPage from '../components/settings/ImageApiPage'; // [EM: settings-subpages-f]
import VoiceApiPage from '../components/settings/VoiceApiPage'; // [EM: settings-subpages-f]
// [EM-END: settings-ios-list]

// 「主动消息 Push 加速」面板入口开关。底层逻辑（心跳、订阅、诊断）全部保留，
// 这里设为 false 只是把设置页里的入口隐藏掉，想恢复改回 true 即可。
const SHOW_PROACTIVE_PUSH_ACCEL_UI = false;
const VISION_MODEL_LIST_STORAGE_KEY = 'os_vision_available_models';
const IMAGE_MODEL_LIST_STORAGE_KEY = 'os_image_available_models';

const readStoredVisionModels = (): string[] => {
    try {
        return normalizeModelIds(JSON.parse(localStorage.getItem(VISION_MODEL_LIST_STORAGE_KEY) || '[]'));
    } catch {
        return [];
    }
};

const readStoredImageModels = (): string[] => {
    try {
        return normalizeModelIds(JSON.parse(localStorage.getItem(IMAGE_MODEL_LIST_STORAGE_KEY) || '[]'));
    } catch {
        return [];
    }
};

const buildModelPickerView = (models: unknown[], filter: string) => {
    const q = filter.trim().toLowerCase();
    const safeModels = normalizeModelIds(models);
    const filtered = q ? safeModels.filter(model => model.toLowerCase().includes(q)) : safeModels;
    let commonPrefix = '';
    if (filtered.length >= 2) {
        let prefix = filtered[0];
        for (let index = 1; index < filtered.length; index += 1) {
            const candidate = filtered[index];
            let cursor = 0;
            while (cursor < prefix.length && cursor < candidate.length && prefix[cursor] === candidate[cursor]) cursor += 1;
            prefix = prefix.slice(0, cursor);
            if (!prefix) break;
        }
        const cut = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('-'));
        if (cut > 3) prefix = prefix.slice(0, cut + 1);
        if (prefix.length >= 4) commonPrefix = prefix;
    }
    return { filtered, commonPrefix };
};

const DiagRow: React.FC<{ label: string; value: string; bad?: boolean }> = ({ label, value, bad }) => (
    <div className="flex items-start justify-between gap-3">
        <span className="text-slate-500 shrink-0">{label}</span>
        <span className={`text-right ${bad ? 'text-rose-600 font-medium' : 'text-slate-700'}`}>{value}</span>
    </div>
);

// 用户版 MCP 教程（自包含，写给用户和他们的 AI 助手看的）。静态部署的站点
// 看不到仓库内文档，所以帮助弹窗只能跳 GitHub 的 blob 页。
const MCP_USER_GUIDE_URL = 'https://github.com/qegj567-cloud/SullyOS/blob/master/docs/mcp-user-guide.md';

const formatBackupBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
};

// [EM-START: settings-ios-list]
/** 一页里放了不止一块时（备份页、推送页）才露出每块的小标题；单块的页面顶栏标题就够了。 */
const SettingsSectionTitleContext = React.createContext(false);

/**
 * 设置大板块的外壳。原来是原地折叠的长卡片（展开两屏还得划回去收），
 * 现在每块都推进成子页，这里只剩一张白卡 + 右上角的动作（配置按钮 / 状态 chip / 问号）。
 */
const SettingsSection: React.FC<{
    icon: React.ReactNode;
    title: string;
    badge?: React.ReactNode;
    actions?: React.ReactNode;
    sectionProps?: Record<string, any>;
    children: React.ReactNode;
}> = ({ title, badge, actions, sectionProps, children }) => {
    const showTitle = React.useContext(SettingsSectionTitleContext);
    return (
        <section {...sectionProps} className="flex flex-col" style={{ gap: 8, ...(sectionProps?.style || {}) }}>
            {/* 只有一块的页面，顶栏已经写了标题：小标题留给读屏 */}
            {!showTitle && <h2 className="sr-only">{title}</h2>}
            {(showTitle || badge || actions) && (
                <div className="flex items-center justify-between gap-2 px-1" style={{ minHeight: 28 }}>
                    <div className="flex items-center gap-2 min-w-0">
                        {showTitle && <h2 style={{ ...FONT.sectionTitle, fontFamily: FONT.heading, color: F.textPrimary, margin: 0 }}>{title}</h2>}
                        {badge}
                    </div>
                    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
                </div>
            )}
            <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: 16 }}>
                {children}
            </div>
        </section>
    );
};
// [EM-END: settings-ios-list]

let mcpToolConfigSyncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMcpToolConfigSync: (() => void) | null = null;

const runMcpToolConfigSync = () => {
    const sync = pendingMcpToolConfigSync;
    mcpToolConfigSyncTimer = null;
    pendingMcpToolConfigSync = null;
    // 上传本身的失败重试与底账在 syncAmsgToolConfig 里（见 amsgStateSync），这儿只管节流。
    sync?.();
};

/**
 * MCP 卡片没有「保存」按钮，改一个字就落盘一次；直接每次都上云就变成一次按键一个请求。
 * 攒到停手 800ms 再传一次，中途继续改就顺延。
 */
const scheduleMcpToolConfigSync = (sync: () => void) => {
    pendingMcpToolConfigSync = sync;
    if (mcpToolConfigSyncTimer) clearTimeout(mcpToolConfigSyncTimer);
    mcpToolConfigSyncTimer = setTimeout(runMcpToolConfigSync, 800);
};

/** 关掉 MCP 设置就别让那 800ms 继续吊着了，攒着的改动当场传上去。 */
const flushMcpToolConfigSync = () => {
    if (!mcpToolConfigSyncTimer) return;
    clearTimeout(mcpToolConfigSyncTimer);
    runMcpToolConfigSync();
};

/**
 * 通用 MCP 工具服务器管理卡片（对标麦当劳/瑞幸卡片的样式，但服务器是用户自配的列表）。
 * 配置存 localStorage（utils/mcpClient），启用且发现过工具的服务器会在聊天里
 * 以 function-calling 注入，详见 docs/mcp-client.md。
 */
const McpServersCard: React.FC<{
    addToast: (msg: string, type?: any) => void;
    /** 服务器清单或「原生 tools」开关变了 → 让主动消息那边把新配置重传上云 */
    onMcpConfigChanged?: () => void;
}> = ({ addToast, onMcpConfigChanged }) => {
    const { characters, groups } = useOS();
    const [servers, setServers] = useState<McpServerConfig[]>(() => loadMcpServers());
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [testStatus, setTestStatus] = useState<Record<string, string>>({});
    const [useNativeTools, setUseNativeToolsState] = useState<boolean>(() => getMcpUseNativeTools());

    const persist = (next: McpServerConfig[]) => {
        setServers(next);
        saveMcpServers(next);
        onMcpConfigChanged?.();
    };

    const update = (id: string, patch: Partial<McpServerConfig>) => {
        persist(servers.map(s => s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s));
        // URL / 鉴权头 / 代理变了，旧 session 不能再用
        if (patch.url !== undefined || patch.token !== undefined || patch.customHeaders !== undefined || patch.proxyUrl !== undefined || patch.proxyKey !== undefined) {
            resetMcpSession(id);
        }
    };

    const addServer = () => {
        const s = createMcpServer(`MCP 服务器 ${servers.length + 1}`, '');
        persist([...servers, s]);
        setExpandedId(s.id);
    };

    const removeServer = (id: string) => {
        resetMcpSession(id);
        persist(servers.filter(s => s.id !== id));
    };

    const discover = async (server: McpServerConfig) => {
        if (!server.url.trim()) { addToast('请先填写服务器 URL', 'error'); return; }
        setTestingId(server.id);
        setTestStatus(prev => ({ ...prev, [server.id]: '' }));
        try {
            const r = await testMcpConnection(server);
            setTestStatus(prev => ({ ...prev, [server.id]: r.ok ? `✅ ${r.message}` : `❌ ${r.message}` }));
            // 失败原因只上报归类后的固定枚举：原始报错里可能带服务器地址和返回内容，不能外发
            if (r.ok) {
                trackEvent('测试 MCP 服务器连接', { result: r.tools?.length ? 'connected' : 'connected-no-tools' });
            } else {
                const msg = r.message || '';
                const failureKind =
                    /超时/.test(msg) ? 'timeout'
                    : /鉴权失败/.test(msg) ? 'auth-failed'
                    : /请求失败/.test(msg) ? 'fetch-failed'
                    : /MCP HTTP/.test(msg) ? 'http-error'
                    : 'other';
                trackEvent('测试 MCP 服务器连接', { result: 'failed', failureKind });
            }
            if (r.ok && r.tools) {
                update(server.id, { tools: r.tools });
            }
        } finally {
            setTestingId(null);
        }
    };

    return (
        <div className="bg-violet-50/60 p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <PlugsConnected size={20} weight="fill" className="text-violet-600" />
                    <span className="text-sm font-bold text-violet-700">MCP 工具服务器</span>
                    <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">通用</span>
                </div>
                <button onClick={addServer} className="text-[11px] font-bold text-violet-600 bg-violet-100 px-2.5 py-1 rounded-lg active:scale-95 transition-transform">+ 添加</button>
            </div>
            <p className="text-[10px] text-violet-700/70 leading-relaxed">
                接入任意标准 MCP 服务器（Streamable HTTP）：填 URL → 测试连接 → 打开开关，角色就能在聊天里调用这些工具。
                被浏览器 CORS 拦住时配「代理 URL」：本地跑 <code className="bg-violet-100/80 px-1 rounded">node scripts/mcp-proxy.mjs</code>，或把 <code className="bg-violet-100/80 px-1 rounded">worker/mcp-proxy</code> 部署到你自己的 Cloudflare 账号。配置只存本机，详见 docs/mcp-client.md。
            </p>
            <div className="flex items-center justify-between gap-3 bg-white/70 border border-violet-100 rounded-xl px-3 py-2.5">
                <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-700">原生 tools 工具调用</div>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        开启后发送标准 tools，调用更稳定、参数更可靠。只有模型或中转明确不支持 function calling 时才关闭，退回文字兼容模式。
                    </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" checked={useNativeTools} onChange={e => {
                        const next = e.target.checked;
                        setUseNativeToolsState(next);
                        setMcpUseNativeTools(next);
                        onMcpConfigChanged?.();
                        trackEvent('切换原生工具调用', { state: next ? 'on' : 'off' });
                    }} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
                </label>
            </div>
            {servers.map(server => (
                <div key={server.id} className="bg-white/70 border border-violet-100 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <button className="flex-1 text-left min-w-0" onClick={() => setExpandedId(expandedId === server.id ? null : server.id)}>
                            <div className="text-xs font-bold text-slate-700 truncate">{server.name || '(未命名)'}</div>
                            <div className="text-[10px] text-slate-400 truncate">
                                {server.url || '未填 URL'}{server.tools?.length ? ` · ${server.tools.length} 个工具` : ' · 未获取工具'}{server.charIds?.length ? ` · 绑定 ${server.charIds.length} 个聊天` : ''}
                            </div>
                        </button>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                            <input type="checkbox" checked={server.enabled} onChange={e => {
                                if (e.target.checked && !(server.tools?.length)) {
                                    addToast('先点「测试连接」拿到工具清单再启用', 'error');
                                    trackEvent('启用未测通的 MCP 服务器被拦下');
                                    return;
                                }
                                update(server.id, { enabled: e.target.checked });
                            }} className="sr-only peer" />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
                        </label>
                    </div>
                    {expandedId === server.id && (
                        <div className="space-y-2 pt-1">
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">名称</label>
                                <input type="text" value={server.name} onChange={e => update(server.id, { name: e.target.value })} className="w-full bg-white/80 border border-violet-200 rounded-xl px-3 py-2 text-sm" placeholder="例如：Notion" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">服务器 URL</label>
                                <input type="text" value={server.url} onChange={e => update(server.id, { url: e.target.value.trim() })} className="w-full bg-white/80 border border-violet-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="https://mcp.example.com/mcp" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Bearer Token（可选）</label>
                                <input type="password" value={server.token || ''} onChange={e => update(server.id, { token: e.target.value.trim() })} className="w-full bg-white/80 border border-violet-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="服务器要求鉴权时填" />
                            </div>
                            <div>
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">自定义请求头（可选）</label>
                                    <button
                                        type="button"
                                        onClick={() => update(server.id, { customHeaders: [...(server.customHeaders || []), { name: '', value: '' }] })}
                                        className="text-[10px] font-bold text-violet-600"
                                    >+ 添加请求头</button>
                                </div>
                                {(server.customHeaders || []).map((header, index) => (
                                    <div key={index} className="flex gap-1.5 mb-1.5">
                                        <input
                                            type="text"
                                            value={header.name}
                                            onChange={e => update(server.id, { customHeaders: (server.customHeaders || []).map((item, i) => i === index ? { ...item, name: e.target.value } : item) })}
                                            className="min-w-0 flex-[0.9] bg-white/80 border border-violet-200 rounded-xl px-2.5 py-2 text-xs font-mono"
                                            placeholder="XBY-APIKEY"
                                            aria-label={`自定义请求头 ${index + 1} 名称`}
                                        />
                                        <input
                                            type="password"
                                            value={header.value}
                                            onChange={e => update(server.id, { customHeaders: (server.customHeaders || []).map((item, i) => i === index ? { ...item, value: e.target.value } : item) })}
                                            className="min-w-0 flex-1 bg-white/80 border border-violet-200 rounded-xl px-2.5 py-2 text-xs font-mono"
                                            placeholder="请求头的值"
                                            aria-label={`自定义请求头 ${index + 1} 值`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => update(server.id, { customHeaders: (server.customHeaders || []).filter((_, i) => i !== index) })}
                                            className="w-9 shrink-0 rounded-xl bg-red-50 text-red-500 text-base"
                                            aria-label={`删除自定义请求头 ${index + 1}`}
                                        >×</button>
                                    </div>
                                ))}
                                <p className="text-[10px] text-slate-400 leading-relaxed">
                                    用于 X-API-Key、XBY-APIKEY 等非 Bearer 鉴权；名称或值留空的行不会发送。
                                </p>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">代理 URL（可选，留空 = 直连）</label>
                                <input type="text" value={server.proxyUrl || ''} onChange={e => update(server.id, { proxyUrl: e.target.value.trim() })} className="w-full bg-white/80 border border-violet-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="http://localhost:18061 或你的 Worker 地址" />
                            </div>
                            {(server.proxyUrl || '').trim() && (
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">代理密钥（可选，自部署 Worker 的 PROXY_KEY）</label>
                                    <input type="password" value={server.proxyKey || ''} onChange={e => update(server.id, { proxyKey: e.target.value.trim() })} className="w-full bg-white/80 border border-violet-200 rounded-xl px-3 py-2 text-sm font-mono" placeholder="没设就留空" />
                                </div>
                            )}
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">可用聊天</label>
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => update(server.id, { charIds: [] })}
                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${!server.charIds?.length ? 'bg-violet-500 text-white' : 'bg-white/80 border border-violet-200 text-slate-500'}`}
                                    >通用（所有私聊和群聊）</button>
                                </div>
                                {characters.length > 0 && <div className="text-[10px] text-slate-400 mt-2 mb-1">角色</div>}
                                <div className="flex flex-wrap gap-1.5">
                                    {characters.map(c => {
                                        const bound = !!server.charIds?.includes(c.id);
                                        return (
                                            <button
                                                key={c.id}
                                                type="button"
                                                onClick={() => {
                                                    const cur = server.charIds || [];
                                                    update(server.id, { charIds: bound ? cur.filter(id => id !== c.id) : [...cur, c.id] });
                                                }}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${bound ? 'bg-violet-500 text-white' : 'bg-white/80 border border-violet-200 text-slate-500'}`}
                                            >{c.name}</button>
                                        );
                                    })}
                                </div>
                                {groups.length > 0 && <div className="text-[10px] text-slate-400 mt-2 mb-1">群聊</div>}
                                <div className="flex flex-wrap gap-1.5">
                                    {groups.map(group => {
                                        const bound = !!server.charIds?.includes(group.id);
                                        return (
                                            <button
                                                key={group.id}
                                                type="button"
                                                onClick={() => {
                                                    const cur = server.charIds || [];
                                                    update(server.id, { charIds: bound ? cur.filter(id => id !== group.id) : [...cur, group.id] });
                                                }}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${bound ? 'bg-violet-500 text-white' : 'bg-white/80 border border-violet-200 text-slate-500'}`}
                                            >{group.name}</button>
                                        );
                                    })}
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                                    通用 = 所有私聊和群聊都能用；绑定后只有选中的角色或群聊能看到这批工具。
                                </p>
                                {!!server.charIds?.length && server.charIds.some(id => !characters.some(c => c.id === id) && !groups.some(g => g.id === id)) && (
                                    <p className="text-[10px] text-amber-600 mt-1">
                                        ⚠️ 绑定里有已删除的角色或群聊，对应绑定不再生效，可重新点选清理。
                                    </p>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => discover(server)} disabled={testingId === server.id} className="flex-1 py-2 bg-violet-100 text-violet-700 text-xs font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-60">
                                    {testingId === server.id ? '测试中…' : '测试连接'}
                                </button>
                                <button onClick={() => removeServer(server.id)} className="px-4 py-2 bg-red-50 text-red-500 text-xs font-bold rounded-xl active:scale-95 transition-transform">删除</button>
                            </div>
                            {testStatus[server.id] && (
                                <div className={`p-2 rounded-lg text-[11px] whitespace-pre-line leading-relaxed ${testStatus[server.id].startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                    {testStatus[server.id]}
                                </div>
                            )}
                            {!!server.tools?.length && (
                                <p className="text-[10px] text-slate-400 leading-relaxed">
                                    工具：{server.tools.map(t => t.name).join('、')}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            ))}
            <p className="text-[10px] text-violet-700/60 leading-relaxed bg-violet-100/40 rounded-lg px-2 py-1.5">
                ⚠️ 本机/内网 Home Assistant 只在智能家居控制或健康数据查询等相关轮次走本地请求；普通闲聊仍可走 Instant Chat。工具轮次的思考链会让位给工具调用；涉及真实副作用的工具（发布/下单/删除）角色会先跟你确认。Token、自定义请求头与配置<b>只存本机、不上传</b>；走代理时请求会经过你自己配置的代理。
            </p>
        </div>
    );
};

const Settings: React.FC = () => {
  const {
      apiConfig, updateApiConfig, closeApp, availableModels, setAvailableModels,
      exportSystem, importSystem, addToast, showError, resetSystem, updateCharacter,
      apiPresets, addApiPreset, updateApiPreset, removeApiPreset,
      sysOperation, // Get progress state
      realtimeConfig, updateRealtimeConfig, // 实时感知配置
      // 改工具凭据时要连云端提示词一起刷（见 syncAmsgToolConfigAndPrompts）
      characters, groups, userProfile,
      cloudBackupConfig, updateCloudBackupConfig,
      cloudBackupToWebDAV, cloudRestoreFromWebDAV, listCloudBackups,
  } = useOS();
  
  const [localKey, setLocalKey] = useState(apiConfig.apiKey);
  const [localUrl, setLocalUrl] = useState(apiConfig.baseUrl);
  const [localModel, setLocalModel] = useState(String(apiConfig.model || ''));
  const [localStream, setLocalStream] = useState<boolean>(apiConfig.stream === true);
  const [localTemperature, setLocalTemperature] = useState<number>(
    typeof apiConfig.temperature === 'number' ? apiConfig.temperature : 0.85
  );
  const [localVisionEnabled, setLocalVisionEnabled] = useState(apiConfig.visionApi?.enabled === true);
  const [localVisionUrl, setLocalVisionUrl] = useState(apiConfig.visionApi?.baseUrl || '');
  const [localVisionKey, setLocalVisionKey] = useState(apiConfig.visionApi?.apiKey || '');
  const [localVisionModel, setLocalVisionModel] = useState(apiConfig.visionApi?.model || '');
  const [availableVisionModels, setAvailableVisionModels] = useState<string[]>(readStoredVisionModels);
  const [selectedVisionPresetId, setSelectedVisionPresetId] = useState<string | null>(null);
  const [visionStatusMsg, setVisionStatusMsg] = useState('');
  const [testingVisionApi, setTestingVisionApi] = useState(false);
  const [visionTestResult, setVisionTestResult] = useState<string | null>(null);
  const [localImageProvider, setLocalImageProvider] = useState<'pollinations-free' | 'openai-compatible'>(
    () => resolveImageGenerationConfig(apiConfig.imageGeneration).provider,
  );
  const [localImageUrl, setLocalImageUrl] = useState(() => resolveImageGenerationConfig(apiConfig.imageGeneration).baseUrl);
  const [localImageKey, setLocalImageKey] = useState(() => resolveImageGenerationConfig(apiConfig.imageGeneration).apiKey);
  const [localImageModel, setLocalImageModel] = useState(() => resolveImageGenerationConfig(apiConfig.imageGeneration).model);
  const [localImageRequestMode, setLocalImageRequestMode] = useState(() => resolveImageGenerationConfig(apiConfig.imageGeneration).requestMode);
  const [availableImageModels, setAvailableImageModels] = useState<string[]>(readStoredImageModels);
  const [localUseCharacterReference, setLocalUseCharacterReference] = useState(
    () => resolveImageGenerationConfig(apiConfig.imageGeneration).useCharacterReference,
  );
  const [imageGenerationStatusMsg, setImageGenerationStatusMsg] = useState('');
  const [testingImageGeneration, setTestingImageGeneration] = useState(false);
  const [imageGenerationPreview, setImageGenerationPreview] = useState<string | null>(null);
  const [localMiniMaxKey, setLocalMiniMaxKey] = useState(apiConfig.minimaxApiKey || '');
  const [localMiniMaxGroupId, setLocalMiniMaxGroupId] = useState(apiConfig.minimaxGroupId || '');
  const [localMiniMaxRegion, setLocalMiniMaxRegion] = useState<'domestic' | 'overseas'>(
    apiConfig.minimaxRegion === 'overseas' ? 'overseas' : 'domestic'
  );
  const [localAceStepKey, setLocalAceStepKey] = useState(apiConfig.aceStepApiKey || '');
  const [localTtsProvider, setLocalTtsProvider] = useState<'minimax' | 'fishaudio'>(
    apiConfig.ttsProvider === 'fishaudio' ? 'fishaudio' : 'minimax'
  );
  const [localFishKey, setLocalFishKey] = useState(apiConfig.fishAudioApiKey || '');
  const [localFishModel, setLocalFishModel] = useState(apiConfig.fishAudioModel || 's2.1-pro');
  // 自定义语音表演指南（留空 → 用内置默认）。按服务商分两份。
  const [localVoicePromptMinimax, setLocalVoicePromptMinimax] = useState(apiConfig.voicePrompts?.minimax || '');
  const [localVoicePromptFish, setLocalVoicePromptFish] = useState(apiConfig.voicePrompts?.fishaudio || '');
  const [localVoicePromptDate, setLocalVoicePromptDate] = useState(apiConfig.voicePrompts?.dateVoice || '');
  const [showVoicePrompts, setShowVoicePrompts] = useState(false);
  const [showAceStepGuide, setShowAceStepGuide] = useState(false);
  const [otherStatusMsg, setOtherStatusMsg] = useState('');

  // [EM: settings-subpages-f] Intiface 那一页的状态搬进 components/settings/IntifaceSettingsPage.tsx
  // 高级设置（流式/温度）默认折叠 — 大多数用户不需要碰
  const [showApiAdvanced, setShowApiAdvanced] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isLoadingVisionModels, setIsLoadingVisionModels] = useState(false);
  const [isLoadingImageModels, setIsLoadingImageModels] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editPresetName, setEditPresetName] = useState('');
  const [editPresetGroup, setEditPresetGroup] = useState(''); // [EM: api-preset-group]
  const [editPresetUrl, setEditPresetUrl] = useState('');
  const [editPresetKey, setEditPresetKey] = useState('');
  const [editPresetModel, setEditPresetModel] = useState('');
  const [editPresetStream, setEditPresetStream] = useState(false);
  const [editPresetTemperature, setEditPresetTemperature] = useState(0.85);
  
  // UI States
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [showVisionModelModal, setShowVisionModelModal] = useState(false);
  const [visionModelFilter, setVisionModelFilter] = useState('');
  const [showImageModelModal, setShowImageModelModal] = useState(false);
  const [imageModelFilter, setImageModelFilter] = useState('');
  const [showExportModal, setShowExportModal] = useState(false); // Used for completion now
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showApiCallLog, setShowApiCallLog] = useState(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showMcpHelp, setShowMcpHelp] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [showCloudRestoreModal, setShowCloudRestoreModal] = useState(false);
  const [showCommunityMigration, setShowCommunityMigration] = useState(false);
  const [cloudBackupFiles, setCloudBackupFiles] = useState<import('../types').CloudBackupFile[]>([]);
  // [EM-START: github-backup-status]
  const [cloudBackupListState, setCloudBackupListState] = useState<CloudBackupListState>('idle');
  const [cloudBackupListError, setCloudBackupListError] = useState('');
  const cloudBackupListVersion = useRef(0);
  useEffect(() => () => { cloudBackupListVersion.current++; }, []);
  // [EM-END: github-backup-status]
  const [cloudTestResult, setCloudTestResult] = useState<string>('');
  const [cloudTesting, setCloudTesting] = useState(false);
  const [avatarModelInventory, setAvatarModelInventory] = useState<AvatarModelBackupInventory | null>(null);
  const [avatarModelBackupBusy, setAvatarModelBackupBusy] = useState(false);
  const [avatarModelBackupProgress, setAvatarModelBackupProgress] = useState<AvatarModelBackupProgress | null>(null);

  // 「该备份啦」提醒频率（1~30 天）。改动即落 localStorage（backupReminder 模块自管持久化）。
  const [backupReminderDays, setBackupReminderDays] = useState<number>(() => getBackupReminderState().intervalDays);
  const backupDaysAgo = daysSinceLastBackup();

  // Cloud backup local config state (WebDAV)
  const [cbUrl, setCbUrl] = useState(cloudBackupConfig.webdavUrl);
  const [cbUsername, setCbUsername] = useState(cloudBackupConfig.username);
  const [cbPassword, setCbPassword] = useState(cloudBackupConfig.password);
  const [cbPath, setCbPath] = useState(cloudBackupConfig.remotePath || '/SullyBackup/');

  // GitHub local state
  const [ghToken, setGhToken] = useState(cloudBackupConfig.githubToken || '');
  const [ghRepo, setGhRepo] = useState(cloudBackupConfig.githubRepo || 'sully-backup');
  const [ghUseProxy, setGhUseProxy] = useState(() => shouldUseGithubProxy(cloudBackupConfig));
  useEffect(() => {
      setGhUseProxy(shouldUseGithubProxy(cloudBackupConfig));
  }, [cloudBackupConfig.githubUseProxy, cloudBackupConfig.githubProxyConsentVersion]);
  const [ghShowAdvanced, setGhShowAdvanced] = useState(false);
  const [ghTesting, setGhTesting] = useState(false);
  const [ghTestResult, setGhTestResult] = useState<string>('');

  // 主代理 Worker 地址（联网搜索 / 备份代理 / Notion / 飞书 / MCD·瑞幸 MCP / 网页抓取 / 出图都走它）。
  // 入口刻意低调：默认折叠，普通用户不需要碰，开箱即用。
  const [proxyWorkerInput, setProxyWorkerInput] = useState(getProxyWorkerUrl());

  // Proactive Push 加速器（Worker URL / VAPID 公钥写死在 proactivePushConfig.ts 常量里）
  const initialPushCfg = loadPushConfig();
  const ppAvailable = isPushConfigAvailable();
  const [ppEnabled, setPpEnabled] = useState(initialPushCfg.enabled);
  const [ppStatus, setPpStatus] = useState<string>('');
  const [ppBusy, setPpBusy] = useState(false);
  const [showPpConfirm, setShowPpConfirm] = useState(false);
  const [ppDiag, setPpDiag] = useState<PushDiagnostics | null>(null);
  const [ppTestBusy, setPpTestBusy] = useState(false);
  const [ppResetBusy, setPpResetBusy] = useState(false);
  const [ppDeepResetBusy, setPpDeepResetBusy] = useState(false);
  // 连续 zombie 重置失败次数 — 累计 >= 3 时, "重置订阅" 按钮自动 morph 成
  // "深度重置". 不持久化, 刷新页面归零 (用户原话: "刷新页面正常消失").
  const [ppZombieStreak, setPpZombieStreak] = useState(0);
  const [showInstantModal, setShowInstantModal] = useState(false);
  const [showAmsg2Modal, setShowAmsg2Modal] = useState(false);
  /**
   * 导出时带不带主动消息 2.0 的后端连接（Worker 地址 + 密钥 + 用户 id）。
   * 默认不带：备份是会被分享出去的，带上就等于把自己那台 Worker 的钥匙一起发了。换设备恢复自己的备份才需要它。
   */
  const [exportBackendConnection, setExportBackendConnection] = useState(false);
  const [showVapidModal, setShowVapidModal] = useState(false);
  const [vapidReadyTick, setVapidReadyTick] = useState(0); // 关闭 VAPID 弹窗后刷新顶层徽标

  // 模型选择 Modal 的过滤 + 公共前缀（memo 掉，避免每次 Settings 重渲染都重算）
  const modelPickerView = useMemo(
      () => buildModelPickerView(availableModels, modelFilter),
      [modelFilter, availableModels],
  );
  const visionModelPickerView = useMemo(
      () => buildModelPickerView(availableVisionModels, visionModelFilter),
      [visionModelFilter, availableVisionModels],
  );
  const imageModelPickerView = useMemo(
      () => buildModelPickerView(availableImageModels, imageModelFilter),
      [imageModelFilter, availableImageModels],
  );

  const refreshPpDiag = useCallback(async () => {
      try { setPpDiag(await getPushDiagnostics()); } catch { /* ignore */ }
  }, []);

  const doEnablePushAccelerator = async () => {
      if (ppBusy) return;
      setPpBusy(true);
      setPpStatus('正在连接 Worker…');
      try {
          const res = await fetch(`${initialPushCfg.workerUrl}/health`);
          if (!res.ok) {
              trackEvent('启用主动消息 Push 加速', { result: 'fail', failStage: 'worker_health' });
              trackEvent('启用 Push 加速器的结果', { result: 'worker-unreachable' });
              setPpStatus(`失败：Worker HTTP ${res.status}`); setPpBusy(false); return;
          }
      } catch (e: any) {
          trackEvent('启用主动消息 Push 加速', { result: 'fail', failStage: 'network' });
          trackEvent('启用 Push 加速器的结果', { result: 'worker-unreachable' });
          setPpStatus(`失败：${e?.message || '网络错误'}`); setPpBusy(false); return;
      }

      // Step 1: ensure permission + subscription up front, regardless of schedules.
      // This is the fix for the old bug where toggle "succeeded" without ever
      // requesting permission when the user hadn't enabled any character timer yet.
      setPpStatus('正在请求通知权限并创建订阅…');
      const sub = await ensureSubscribed();
      if (!sub.ok) {
          trackEvent('启用主动消息 Push 加速', { result: 'fail', failStage: 'subscribe' });
          trackEvent('启用 Push 加速器的结果', { result: 'subscribe-failed' });
          setPpStatus(`失败：${sub.reason || '订阅创建失败'}`);
          setPpBusy(false);
          await refreshPpDiag();
          return;
      }

      // Step 2: persist enabled flag and start heartbeat.
      savePushConfig(true);
      setPpEnabled(true);
      startHeartbeat();

      // Step 3: register any existing per-character schedules.
      const schedules = ProactiveChat.getSchedules();
      let okCount = 0;
      for (const s of schedules) {
          if (await registerScheduleOnWorker(s.charId, s.intervalMs)) okCount++;
      }

      if (schedules.length === 0) {
          trackEvent('启用主动消息 Push 加速', { result: 'success' });
          trackEvent('启用 Push 加速器的结果', { result: 'ok-no-schedule' });
          setPpStatus('已启用（订阅已建立。暂无主动消息定时，下次开启角色主动消息时会自动注册）');
      } else if (okCount < schedules.length) {
          trackEvent('启用主动消息 Push 加速', { result: 'partial' });
          trackEvent('启用 Push 加速器的结果', { result: 'ok-partial-schedule' });
          setPpStatus(`已启用：${okCount}/${schedules.length} 个定时注册成功`);
      } else {
          trackEvent('启用主动消息 Push 加速', { result: 'success' });
          trackEvent('启用 Push 加速器的结果', { result: 'ok' });
          setPpStatus(`已启用，${okCount} 个主动消息定时已注册`);
      }
      setPpBusy(false);
      await refreshPpDiag();
  };

  const doDisablePushAccelerator = async () => {
      trackEvent('关闭主动消息 Push 加速');
      savePushConfig(false);
      setPpEnabled(false);
      stopHeartbeat();
      setPpStatus('已关闭（主动消息退回本地计时器）');
      await refreshPpDiag();
  };

  const doSendTestPush = async () => {
      if (ppTestBusy) return;
      setPpTestBusy(true);
      setPpStatus('正在让 Worker 发一条测试推送…');
      const res = await sendTestPush();
      if (res.ok) {
          trackEvent('发送测试推送（主动消息加速）', { result: 'sent' });
          trackEvent('发一条测试推送', { result: 'sent' });
          setPpStatus('测试推送已发出。如果 5 秒内系统通知里没出现"推送测试成功"，说明送达环节有问题——看下方诊断面板。');
      } else if (res.deadSubscription) {
          trackEvent('发送测试推送（主动消息加速）', { result: 'dead_subscription' });
          trackEvent('发一条测试推送', { result: 'dead-subscription' });
          setPpStatus('订阅已被浏览器吊销（zombie endpoint）。请点下方"重置订阅"重建一次再测。');
      } else {
          trackEvent('发送测试推送（主动消息加速）', { result: 'fail' });
          trackEvent('发一条测试推送', { result: 'failed' });
          setPpStatus(`测试失败：${res.reason || '未知错误'}${res.status ? `（HTTP ${res.status}）` : ''}`);
      }
      setPpTestBusy(false);
      await refreshPpDiag();
  };

  const doResetSubscription = async () => {
      if (ppResetBusy || ppDeepResetBusy) return;
      setPpResetBusy(true);
      setPpStatus('正在重置订阅…');
      const res = await resetSubscription();
      if (res.ok) {
          trackEvent('重置推送订阅', { result: 'success', attempt: bucketRetryCount(ppZombieStreak) });
          setPpZombieStreak(0);
          setPpStatus('订阅已重建。可以再点"发一条测试推送"试一下。');
      } else {
          const reason = res.reason || '';
          // 失败原因指向 zombie endpoint 时累计, 达到 3 次后按钮自动 morph 成深度重置
          if (/permanently-removed|zombie/i.test(reason)) {
              setPpZombieStreak(c => c + 1);
          }
          // 只上报归类后的固定枚举，失败原文一个字都不带；重试次数同样先分桶
          trackEvent('重置推送订阅', {
              result: /permanently-removed|zombie/i.test(reason) ? 'fail_zombie' : 'fail_other',
              attempt: bucketRetryCount(ppZombieStreak),
          });
          setPpStatus(`重置失败：${reason || '未知错误'}`);
      }
      setPpResetBusy(false);
      await refreshPpDiag();
  };

  const doDeepResetSubscription = async () => {
      if (ppDeepResetBusy || ppResetBusy) return;
      setPpDeepResetBusy(true);
      setPpStatus('正在深度重置…');
      const res = await deepResetSubscription();
      // 无论成败, 按钮都回归"重置订阅" — 下次出问题再次累计触发 morph
      setPpZombieStreak(0);
      if (res.ok) {
          // ProactiveChat.resume() 把所有 schedule 推回新 SW. deepResetSubscription 内部
          // 不调它是为了避免循环依赖 (ProactiveChat 反向依赖 proactivePushConfig).
          try { ProactiveChat.resume(); } catch (e) { console.warn('[Settings] ProactiveChat.resume failed', e); }
          trackEvent('深度重置推送订阅', { result: 'success' });
          setPpStatus('订阅已重建。可以再点"发一条测试推送"试一下。');
      } else {
          trackEvent('深度重置推送订阅', { result: 'fail' });
          setPpStatus(`深度重置失败：${res.reason || '未知错误'}`);
      }
      setPpDeepResetBusy(false);
      await refreshPpDiag();
  };

  // Refresh diagnostics whenever the panel is mounted or the toggle changes.
  useEffect(() => {
      void refreshPpDiag();
  }, [refreshPpDiag, ppEnabled]);

  // For web download link
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [downloadFileName, setDownloadFileName] = useState('Sully_Backup.zip');
  // 用 ref 跟住当前的 object URL，关弹窗 / 重新导出 / 卸载时都能 revoke 到最新那个，
  // 不受 state 闭包过期影响。
  const downloadUrlRef = useRef<string>('');
  const revokeDownloadUrl = useCallback(() => {
      if (downloadUrlRef.current) {
          URL.revokeObjectURL(downloadUrlRef.current);
          downloadUrlRef.current = '';
      }
      setDownloadUrl('');
  }, []);
  useEffect(() => () => {
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
  }, []);

  const [statusMsg, setStatusMsg] = useState('');
  const [testingApi, setTestingApi] = useState(false);
  const [testApiResult, setTestApiResult] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const avatarModelBackupInputRef = useRef<HTMLInputElement>(null);
  const refreshAvatarModelInventory = useCallback(async () => {
      try {
          setAvatarModelInventory(await getAvatarModelBackupInventory());
      } catch (error) {
          console.warn('[Settings] 读取模型备份清单失败', error);
      }
  }, []);
  useEffect(() => { void refreshAvatarModelInventory(); }, [refreshAvatarModelInventory]);

  // 独立表单只跟随自己的已保存字段；保存识图或生图时保留主 API 草稿。
  useEffect(() => {
      setLocalUrl(apiConfig.baseUrl);
      setLocalKey(apiConfig.apiKey);
      setLocalModel(String(apiConfig.model || ''));
      setLocalStream(apiConfig.stream === true);
      setLocalTemperature(typeof apiConfig.temperature === 'number' ? apiConfig.temperature : 0.85);
  }, [apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model, apiConfig.stream, apiConfig.temperature]);
  useEffect(() => {
      setLocalVisionEnabled(apiConfig.visionApi?.enabled === true);
  }, [apiConfig.visionApi?.enabled]);
  useEffect(() => {
      setLocalVisionUrl(apiConfig.visionApi?.baseUrl || '');
      setLocalVisionKey(apiConfig.visionApi?.apiKey || '');
      setLocalVisionModel(apiConfig.visionApi?.model || '');
  }, [apiConfig.visionApi?.baseUrl, apiConfig.visionApi?.apiKey, apiConfig.visionApi?.model]);
  useEffect(() => {
      const imageGeneration = resolveImageGenerationConfig(apiConfig.imageGeneration);
      setLocalImageProvider(imageGeneration.provider);
      setLocalImageUrl(imageGeneration.baseUrl);
      setLocalImageKey(imageGeneration.apiKey);
      setLocalImageModel(imageGeneration.model);
      setLocalImageRequestMode(imageGeneration.requestMode);
      setLocalUseCharacterReference(imageGeneration.useCharacterReference);
  }, [apiConfig.imageGeneration?.provider, apiConfig.imageGeneration?.baseUrl,
      apiConfig.imageGeneration?.apiKey, apiConfig.imageGeneration?.model,
      apiConfig.imageGeneration?.requestMode, apiConfig.imageGeneration?.useCharacterReference]);
  useEffect(() => {
      setLocalMiniMaxKey(apiConfig.minimaxApiKey || '');
      setLocalMiniMaxGroupId(apiConfig.minimaxGroupId || '');
      setLocalMiniMaxRegion(apiConfig.minimaxRegion === 'overseas' ? 'overseas' : 'domestic');
      setLocalAceStepKey(apiConfig.aceStepApiKey || '');
      setLocalTtsProvider(apiConfig.ttsProvider === 'fishaudio' ? 'fishaudio' : 'minimax');
      setLocalFishKey(apiConfig.fishAudioApiKey || '');
      setLocalFishModel(apiConfig.fishAudioModel || 's2.1-pro');
      setLocalVoicePromptMinimax(apiConfig.voicePrompts?.minimax || '');
      setLocalVoicePromptFish(apiConfig.voicePrompts?.fishaudio || '');
      setLocalVoicePromptDate(apiConfig.voicePrompts?.dateVoice || '');
  }, [apiConfig.minimaxApiKey, apiConfig.minimaxGroupId, apiConfig.minimaxRegion,
      apiConfig.aceStepApiKey, apiConfig.ttsProvider, apiConfig.fishAudioApiKey,
      apiConfig.fishAudioModel, apiConfig.voicePrompts?.minimax,
      apiConfig.voicePrompts?.fishaudio, apiConfig.voicePrompts?.dateVoice]);

  // 当前生效的是哪条预设 —— 按已保存的配置反查，不额外记状态。
  // 这样刷新、手改 URL、导入备份之后，界面上的「使用中」永远等于请求真的会发去哪。
  const activePresetId = useMemo(
      () => findActivePresetId(apiPresets, apiConfig),
      [apiPresets, apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model],
  );

  /**
   * 把一份配置真正切过去。保存按钮和点预设走的是同一条路——除了写进全局配置，
   * 还要把已排程的主动消息凭据一起换掉，否则聊天换了、后台任务还拿旧 Key 打请求。
   */
  const refreshSavedApiCredentials = (savedConfig: APIConfig) => {
    // 支持凭据表的 Worker 上，任务只带引用，换 Key 只要覆盖云端那几行——不用逐条改任务。
    // 老 Worker 上这句是 no-op，凭据靠下面那条逐条补刷的老路续命。
    syncAmsgLlmCredentials(savedConfig);
    // 已排程的主动消息 2.0 AI 任务里冻结的是排程那一刻的凭据——换 Key / 换模型后
    // 不重传的话，到点全拿旧凭据打请求（旧 Key 一吊销就是连环 401）。best-effort：
    // 保存本身不等它，失败只提示；没配 2.0 / 没有 pending AI 任务时它是 no-op。
    // 存量的内联任务还靠它，所以走引用那条路的用户这里照跑（带 credRefs 的任务
    // 到点只认引用，这一份补刷落在它们身上是无害的空转）。
    void ActiveMsgClient.refreshApiCredentialsForPendingTasks(savedConfig)
      .then((result) => {
        if (result.status === 'partial') {
          addToast(`API 已保存，但有 ${result.failed} 条已排程的主动消息没换上新凭据，稍后再保存一次可重试。`, 'error');
        }
      })
      .catch((error) => {
        console.warn('[Settings] 刷新已排程任务的 API 凭据失败', error);
        addToast('API 已保存，但已排程的主动消息凭据刷新失败，稍后再保存一次可重试。', 'error');
      });
  };

  const commitApiConfig = (patch: PresetSwitchPatch | Partial<APIConfig>) => {
    updateApiConfig(patch);
    refreshSavedApiCredentials({ ...apiConfig, ...patch });
  };

  // [EM: settings-subpages-f] 原来写在「测试连接」按钮的 onClick 里，主 API 页改成状态卡右下角的文字按钮
  const handleTestApi = async () => {
      if (!localUrl.trim() || !localKey.trim() || !localModel.trim()) return;
      setTestingApi(true);
      setTestApiResult(null);
      try {
          const res = await fetch(`${localUrl.trim().replace(/\/+$/, '')}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localKey.trim()}` },
              body: JSON.stringify({
                  model: localModel.trim(),
                  messages: [{ role: 'user', content: 'Hi' }],
                  max_tokens: 5,
                  stream: localStream,
              }),
          });
          if (res.ok) {
              // 走 safeResponseJson —— 它能透明把 SSE 流响应拼成普通 chat/completion 结构
              const data = await safeResponseJson(res);
              const reply = extractContent(data);
              setTestApiResult(`✅ 连接成功 — 模型回复: "${reply.slice(0, 30)}"`);
          } else {
              const text = await res.text().catch(() => '');
              setTestApiResult(`❌ HTTP ${res.status}: ${text.slice(0, 100)}`);
          }
      } catch (err: any) {
          setTestApiResult(`❌ 连接失败: ${err.message}`);
      } finally {
          setTestingApi(false);
      }
  };

  /**
   * 点预设 = 直接切过去并生效，没有「载入了但还没保存」的中间状态。
   * 上面的输入框由 apiConfig 同步 effect 自己跟上，不在这里手动塞。
   * MiniMax / AceStep 那些不归预设管：一个人通常只有一个语音账号，换 LLM 不该动它。
   */
  const applyPreset = (preset: typeof apiPresets[0]) => {
      // 已经在用这条也照切：「使用中」只看 URL/Key/Model 三件套，温度、流式可能被手调过，
      // 再点一下的语义就是「整套回到这条预设存的样子」。
      const patch = configFromPreset(preset);
      setLocalUrl(patch.baseUrl); setLocalKey(patch.apiKey); setLocalModel(patch.model);
      setLocalStream(patch.stream ?? (apiConfig.stream === true));
      setLocalTemperature(patch.temperature ?? (typeof apiConfig.temperature === 'number' ? apiConfig.temperature : 0.85));
      commitApiConfig(patch);
      addToast(`已切换到「${preset.name}」，立即生效`, 'success');
  };

  const openEditPreset = (preset: typeof apiPresets[0]) => {
      const isActive = activePresetId === preset.id;
      setEditingPresetId(preset.id);
      setEditPresetName(preset.name);
      setEditPresetGroup(preset.group || ''); // [EM: api-preset-group]
      setEditPresetUrl(preset.config.baseUrl || '');
      setEditPresetKey(preset.config.apiKey || '');
      setEditPresetModel(preset.config.model || '');
      // 当前正在使用的预设要接住主表单里刚改的高级设置：用户点铅笔再点保存即可写回，
      // 不必猜还要额外按一次「用当前配置填入」。非当前/老预设则读取自身，缺字段才回退。
      setEditPresetStream(
          isActive ? localStream : (typeof preset.config.stream === 'boolean' ? preset.config.stream : localStream),
      );
      setEditPresetTemperature(
          isActive
              ? localTemperature
              : (typeof preset.config.temperature === 'number' ? preset.config.temperature : localTemperature),
      );
  };

  const handleUpdatePreset = () => {
      const preset = apiPresets.find(item => item.id === editingPresetId);
      if (!preset) return;
      const name = editPresetName.trim();
      if (!name) {
          addToast('预设名称不能为空', 'error');
          return;
      }
      const nextConfig = {
          ...preset.config,
          baseUrl: normalizeApiBaseUrl(editPresetUrl),
          apiKey: normalizeApiCredential(editPresetKey),
          model: normalizeApiModel(editPresetModel),
          stream: editPresetStream,
          temperature: editPresetTemperature,
      };
      // 「正在用的就是这条」要在改之前问，改完值就对不上了
      const wasActive = activePresetId === preset.id;
      updateApiPreset(preset.id, name, nextConfig, editPresetGroup); // [EM: api-preset-group]
      // 改的正好是当前生效那条 → 生效配置跟着走，否则界面写着新 Key、请求还在用旧的
      if (wasActive) commitApiConfig(configFromPreset({ ...preset, name, config: nextConfig }));
      // 独立绑定这条预设的角色也有后台任务；普通 API 保持原值，角色从新预设读取凭据。
      else refreshSavedApiCredentials(apiConfig);
      setEditingPresetId(null);
      addToast(wasActive ? `「${name}」已更新，当前配置同步生效` : `「${name}」已更新`, 'success');
  };

  const deleteApiPreset = (id: string, name: string) => { // [EM: settings-subpages-f] 从编辑预设里删（原来长按 ×）
      removeApiPreset(id);
      setEditingPresetId(current => (current === id ? null : current));
      addToast(`已删除预设: ${name}`, 'success');
  };

  const handleSavePreset = () => {
      if (!newPresetName.trim()) {
          addToast('请输入预设名称', 'error');
          return;
      }
      addApiPreset(newPresetName, {
        baseUrl: normalizeApiBaseUrl(localUrl),
        apiKey: normalizeApiCredential(localKey),
        model: normalizeApiModel(localModel),
        stream: localStream,
        temperature: localTemperature,
      });
      setNewPresetName('');
      setShowPresetModal(false);
      addToast('预设已保存', 'success');
  };

  const handleSaveApi = () => {
    const nextConfig = {
      apiKey: normalizeApiCredential(localKey),
      baseUrl: normalizeApiBaseUrl(localUrl),
      model: normalizeApiModel(localModel),
      stream: localStream,
      temperature: localTemperature,
    };
    setLocalKey(nextConfig.apiKey);
    setLocalUrl(nextConfig.baseUrl);
    setLocalModel(nextConfig.model);
    commitApiConfig(nextConfig);
    setStatusMsg('配置已保存');
    setTimeout(() => setStatusMsg(''), 2000);
  };

  const handleSaveVisionApi = (enabled = localVisionEnabled) => {
    const nextVisionApi = {
      enabled,
      baseUrl: normalizeApiBaseUrl(localVisionUrl),
      apiKey: normalizeApiCredential(localVisionKey),
      model: normalizeApiModel(localVisionModel),
    };
    if (nextVisionApi.enabled && (!nextVisionApi.baseUrl || !nextVisionApi.apiKey || !nextVisionApi.model)) {
      addToast('开启识图 API 前，请填写完整的 URL、Key 和 Model', 'error');
      return;
    }
    setLocalVisionUrl(nextVisionApi.baseUrl);
    setLocalVisionKey(nextVisionApi.apiKey);
    setLocalVisionModel(nextVisionApi.model);
    updateApiConfig({ visionApi: nextVisionApi });
    setVisionStatusMsg(nextVisionApi.enabled ? '识图 API 已接入' : '已关闭，沿用原有识图方式');
    setTimeout(() => setVisionStatusMsg(''), 2200);
  };

  const handleToggleVisionApi = () => {
    if (localVisionEnabled) {
      setLocalVisionEnabled(false);
      updateApiConfig({ visionApi: {
        baseUrl: '', apiKey: '', model: '', ...apiConfig.visionApi, enabled: false,
      } });
      setVisionStatusMsg('已关闭，沿用原有识图方式');
    } else if (normalizeApiBaseUrl(localVisionUrl) && normalizeApiCredential(localVisionKey) && normalizeApiModel(localVisionModel)) {
      setLocalVisionEnabled(true);
      handleSaveVisionApi(true);
    } else {
      setVisionStatusMsg('请先填写 URL、Key 和 Model，再开启识图');
    }
  };

  const handleSaveImageGenerationApi = () => {
    const nextImageGeneration = {
      provider: localImageProvider,
      baseUrl: normalizeApiBaseUrl(localImageUrl),
      apiKey: normalizeApiCredential(localImageKey),
      model: normalizeApiModel(localImageModel),
      requestMode: localImageRequestMode,
      useCharacterReference: localUseCharacterReference,
    } as const;
    if (nextImageGeneration.provider === 'openai-compatible' && (!nextImageGeneration.baseUrl || !nextImageGeneration.model)) {
      addToast('自定义生图接口至少需要填写 URL 和 Model', 'error');
      return;
    }
    setLocalImageUrl(nextImageGeneration.baseUrl);
    setLocalImageKey(nextImageGeneration.apiKey);
    setLocalImageModel(nextImageGeneration.model);
    updateApiConfig({ imageGeneration: nextImageGeneration });
    setImageGenerationStatusMsg(
      nextImageGeneration.provider === 'pollinations-free'
        ? '已使用内置免费生图'
        : nextImageGeneration.useCharacterReference
          ? '自定义生图已接入 · 仅人物画面使用角色立绘参考'
          : '自定义生图已接入 · 当前不使用角色立绘参考',
    );
    setTimeout(() => setImageGenerationStatusMsg(''), 2400);
  };

  const fetchImageModels = async () => {
    const baseUrl = normalizeApiBaseUrl(localImageUrl);
    const apiKey = normalizeApiCredential(localImageKey);
    if (!baseUrl) {
      setImageGenerationStatusMsg('请先填写生图 URL');
      return;
    }
    setIsLoadingImageModels(true);
    setImageGenerationStatusMsg('正在拉取生图模型...');
    try {
      const response = localImageRequestMode === 'proxy'
        ? await fetch(`${getProxyWorkerUrl()}/image-generation/models`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ baseUrl }),
          })
        : await fetch(buildImageModelsUrl(baseUrl), {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
          });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const models = extractModelIds(await safeResponseJson(response));
      if (models.length === 0) {
        setImageGenerationStatusMsg('模型列表为空或格式不兼容，可手动输入');
        return;
      }
      setAvailableImageModels(models);
      try { localStorage.setItem(IMAGE_MODEL_LIST_STORAGE_KEY, JSON.stringify(models)); } catch { /* ignore */ }
      if (!models.includes(normalizeApiModel(localImageModel))) setLocalImageModel(models[0]);
      setImageModelFilter('');
      setImageGenerationStatusMsg(`获取到 ${models.length} 个模型`);
      setShowImageModelModal(true);
    } catch (error: any) {
      console.error('Fetch Image Models Error', error);
      setImageGenerationStatusMsg(`拉取失败${error?.message ? `：${error.message}` : ''}，可手动输入`);
    } finally {
      setIsLoadingImageModels(false);
    }
  };

  const handleTestImageGeneration = async () => {
    const config = {
      provider: localImageProvider,
      baseUrl: normalizeApiBaseUrl(localImageUrl),
      apiKey: normalizeApiCredential(localImageKey),
      model: normalizeApiModel(localImageModel),
      requestMode: localImageRequestMode,
      useCharacterReference: false,
    } as const;
    if (config.provider === 'openai-compatible' && (!config.baseUrl || !config.model)) {
      setImageGenerationStatusMsg('请先填写生图 URL 和 Model');
      return;
    }
    setTestingImageGeneration(true);
    setImageGenerationPreview(null);
    setImageGenerationStatusMsg('正在生成测试图片，慢模型可能需要几分钟...');
    try {
      const result = await generateChatImage({
        prompt: 'A small white lily on a clean windowsill in soft morning light, candid phone photo',
        config,
      });
      setImageGenerationPreview(result.url);
      setImageGenerationStatusMsg('测试生图成功');
      trackEvent('测试生图 API', { result: '成功', mode: config.requestMode });
    } catch (error: any) {
      console.error('Test Image Generation Error', error);
      setImageGenerationStatusMsg(`测试失败：${error?.message || '未知错误'}`);
      trackEvent('测试生图 API', { result: '失败', mode: config.requestMode });
    } finally {
      setTestingImageGeneration(false);
    }
  };

  const loadVisionApiPreset = (preset: typeof apiPresets[0]) => {
    const next = visionApiConfigFromPreset(preset);
    setSelectedVisionPresetId(preset.id);
    setLocalVisionEnabled(true);
    setLocalVisionUrl(next.baseUrl);
    setLocalVisionKey(next.apiKey);
    setLocalVisionModel(next.model);
    setVisionTestResult(null);
    setVisionStatusMsg(`已载入预设：${preset.name}`);
    setTimeout(() => setVisionStatusMsg(''), 2200);
    addToast(`已把「${preset.name}」填入识图 API；保存后生效`, 'info');
  };

  const fetchVisionModels = async () => {
    const baseUrl = normalizeApiBaseUrl(localVisionUrl);
    const apiKey = normalizeApiCredential(localVisionKey);
    if (!baseUrl) { setVisionStatusMsg('请先填写识图 URL'); return; }
    setIsLoadingVisionModels(true);
    setVisionStatusMsg('正在拉取识图模型...');
    setVisionTestResult(null);
    try {
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const models = extractModelIds(await safeResponseJson(response));
      if (models.length === 0) {
        setVisionStatusMsg('模型列表为空或格式不兼容');
        return;
      }
      setAvailableVisionModels(models);
      try { localStorage.setItem(VISION_MODEL_LIST_STORAGE_KEY, JSON.stringify(models)); } catch { /* ignore */ }
      if (!models.includes(normalizeApiModel(localVisionModel))) {
        setLocalVisionModel(models[0]);
        setSelectedVisionPresetId(null);
      }
      setVisionStatusMsg(`获取到 ${models.length} 个识图模型`);
      setVisionModelFilter('');
      setShowVisionModelModal(true);
    } catch (error: any) {
      console.error('Fetch Vision Models Error', error);
      setVisionStatusMsg(`拉取失败${error?.message ? `：${error.message}` : ''}`);
    } finally {
      setIsLoadingVisionModels(false);
    }
  };

  const handleTestVisionApi = async () => {
    const config = {
      enabled: true,
      baseUrl: normalizeApiBaseUrl(localVisionUrl),
      apiKey: normalizeApiCredential(localVisionKey),
      model: normalizeApiModel(localVisionModel),
    };
    if (!config.baseUrl || !config.apiKey || !config.model) {
      setVisionTestResult('❌ 请先填写完整的 URL、Key 和 Model');
      return;
    }
    setTestingVisionApi(true);
    setVisionTestResult(null);
    try {
      const description = await describeImageWithVisionApi(VISION_API_TEST_IMAGE_DATA_URL, config);
      setVisionTestResult(`✅ 识图成功 — ${description.slice(0, 80)}`);
      trackEvent('测试识图 API', { result: '成功' });
    } catch (error: any) {
      console.error('Test Vision API Error', error);
      setVisionTestResult(`❌ 识图失败：${error?.message || '未知错误'}`);
      trackEvent('测试识图 API', { result: '失败' });
    } finally {
      setTestingVisionApi(false);
    }
  };

  const handleSaveOtherApis = () => {
    updateApiConfig({
      minimaxApiKey: localMiniMaxKey,
      minimaxGroupId: localMiniMaxGroupId,
      minimaxRegion: localMiniMaxRegion,
      aceStepApiKey: localAceStepKey,
      ttsProvider: localTtsProvider,
      fishAudioApiKey: localFishKey,
      fishAudioModel: localFishModel,
      voicePrompts: {
        minimax: localVoicePromptMinimax.trim() ? localVoicePromptMinimax : undefined,
        fishaudio: localVoicePromptFish.trim() ? localVoicePromptFish : undefined,
        dateVoice: localVoicePromptDate.trim() ? localVoicePromptDate : undefined,
      },
    });
    setOtherStatusMsg('已保存');
    setTimeout(() => setOtherStatusMsg(''), 2000);
  };

  // 选「谁来做语音生成」立即落库——不需要再点下面的保存。
  // 连同当前「其他 API」草稿一起提交（与保存按钮同一份 payload）：一是即时生效，
  // 二是避免 [apiConfig] 同步 effect 把刚填、还没保存的 Key 草稿冲掉。
  const selectTtsProvider = (provider: 'minimax' | 'fishaudio') => {
    setLocalTtsProvider(provider);
    updateApiConfig({
      minimaxApiKey: localMiniMaxKey,
      minimaxGroupId: localMiniMaxGroupId,
      minimaxRegion: localMiniMaxRegion,
      aceStepApiKey: localAceStepKey,
      fishAudioApiKey: localFishKey,
      fishAudioModel: localFishModel,
      voicePrompts: {
        minimax: localVoicePromptMinimax.trim() ? localVoicePromptMinimax : undefined,
        fishaudio: localVoicePromptFish.trim() ? localVoicePromptFish : undefined,
        dateVoice: localVoicePromptDate.trim() ? localVoicePromptDate : undefined,
      },
      ttsProvider: provider,
    });
    addToast(provider === 'fishaudio' ? '语音生成已切到鱼声 Fish' : '语音生成已切到 MiniMax', 'success');
  };

  // 选鱼声模型：立即落库（同上，连带草稿一起提交，避免被同步 effect 冲掉）。
  const selectFishModel = (model: string) => {
    setLocalFishModel(model);
    updateApiConfig({
      minimaxApiKey: localMiniMaxKey,
      minimaxGroupId: localMiniMaxGroupId,
      minimaxRegion: localMiniMaxRegion,
      aceStepApiKey: localAceStepKey,
      fishAudioApiKey: localFishKey,
      ttsProvider: localTtsProvider,
      fishAudioModel: model,
      voicePrompts: {
        minimax: localVoicePromptMinimax.trim() ? localVoicePromptMinimax : undefined,
        fishaudio: localVoicePromptFish.trim() ? localVoicePromptFish : undefined,
        dateVoice: localVoicePromptDate.trim() ? localVoicePromptDate : undefined,
      },
    });
  };

  const fetchModels = async () => {
    const baseUrl = normalizeApiBaseUrl(localUrl);
    const apiKey = normalizeApiCredential(localKey);
    if (!baseUrl) { setStatusMsg('请先填写 URL'); return; }
    setIsLoadingModels(true);
    setStatusMsg('正在连接...');
    try {
        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await safeResponseJson(response);
        // Support common OpenAI-compatible and nested gateway response formats.
        const models = extractModelIds(data);
        if (models.length > 0) {
            setAvailableModels(models);
            if (models.length > 0 && !models.includes(localModel)) setLocalModel(models[0]);
            setStatusMsg(`获取到 ${models.length} 个模型`);
            setShowModelModal(true); // Open selector immediately
        } else { setStatusMsg('模型列表为空或格式不兼容'); }
    } catch (error: any) {
        console.error(error);
        setStatusMsg(`连接失败${error?.message ? `：${error.message}` : ''}`);
    } finally {
        setIsLoadingModels(false);
    }
  };

  // 一键清理「幽灵表情包」残留：先 dryRun 扫描，弹确认后才真正删。
  // 残留的来历：旧版本删角色不会级联清理表情分类，只对已删角色可见的专属分类
  // 会卡在数据库里——单聊面板看不到（也删不掉），群聊面板却能看到。
  const [isCleaningResidue, setIsCleaningResidue] = useState(false);
  const handleCleanupResidue = async () => {
      if (isCleaningResidue) return;
      setIsCleaningResidue(true);
      try {
          const validIds = (await DB.getAllCharacters()).map(c => c.id);
          const scan = await DB.cleanupEmojiResidue(validIds, { dryRun: true });
          if (scan.removedCategories.length === 0 && scan.fixedCategories.length === 0 && scan.removedEmojiCount === 0) {
              addToast('很干净，没有发现表情包残留 ✨', 'success');
              return;
          }
          const lines = [
              scan.removedCategories.length > 0 ? `• 删除 ${scan.removedCategories.length} 个失效专属分类：${scan.removedCategories.map(c => `「${c.name}」`).join('、')}` : '',
              scan.removedEmojiCount > 0 ? `• 删除 ${scan.removedEmojiCount} 个随分类失效/无主的表情` : '',
              scan.fixedCategories.length > 0 ? `• 修复 ${scan.fixedCategories.length} 个分类里指向已删角色的绑定：${scan.fixedCategories.map(c => `「${c.name}」`).join('、')}` : '',
          ].filter(Boolean).join('\n');
          if (!window.confirm(`扫描到以下残留（角色已删除但表情包还在）：\n\n${lines}\n\n点「确定」清理，此操作不可撤销。`)) return;
          const report = await DB.cleanupEmojiResidue(validIds);
          addToast(`清理完成：删除 ${report.removedCategories.length} 个分类、${report.removedEmojiCount} 个表情${report.fixedCategories.length > 0 ? `，修复 ${report.fixedCategories.length} 处绑定` : ''}`, 'success');
      } catch (err) {
          console.error('[Settings] 表情包残留清理失败', err);
          addToast('清理失败，请重试', 'error');
      } finally {
          setIsCleaningResidue(false);
      }
  };

  const handleExport = async (mode: 'text_only' | 'media_only' | 'full') => {
      trackEvent('导出本地备份', { scope: mode });
      try {
          // 二次确认：整包备份（full / text_only）本就包含你的 API 密钥等设置——这是预期行为，
          // 但绝不能发给别人。media_only 只有媒体、不含密钥，视为可分享。
          if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
              const includesSettings = mode !== 'media_only';
              const includesBackend = includesSettings && exportBackendConnection;
              const msg = includesBackend
                  ? '该导出数据包含了明文密钥，以及主动消息 2.0 的后端连接（Worker 地址与主密钥）。拿到这个文件的人可以连上你那台 Worker，请不要发送给任何人'
                  : includesSettings
                  ? '该导出数据包含了明文密钥，请不要发送给任何人'
                  : '该导出内容安全，可以用于分享';
              if (!window.confirm(`${msg}\n\n点「确定」继续导出，「取消」中止。`)) {
                  trackEvent('取消导出前的密钥确认', { mode });
                  return;
              }
          }

          // Trigger export (Context handles loading state UI)
          const blob = await exportSystem(mode, { includeBackendConnection: exportBackendConnection });
          
          if (Capacitor.isNativePlatform()) {
              // 手机端分片写盘：整包一次性 readAsDataURL 会把几十~上百 MB 的 base64
              // 一股脑塞进内存，WebView 容易 OOM 闪退。改成按 3MiB 切片，每片转成纯
              // base64 再 appendFile 追加。先写临时文件，全部写完才改名+分享；中途任何
              // 一步失败都删掉残片，避免留下一个看着像成功、其实损坏的 .zip。
              const fileName = `Sully_Backup_${mode}_${Date.now()}.zip`;
              const tempName = `${fileName}.part`;

              // 读一个 Blob 分片为纯 base64（去掉 data:...;base64, 前缀）。
              const sliceToBase64 = (slice: Blob): Promise<string> => new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                      const result = String(reader.result);
                      const comma = result.indexOf(',');
                      resolve(comma >= 0 ? result.slice(comma + 1) : result);
                  };
                  reader.onerror = () => reject(reader.error || new Error('读取备份分片失败'));
                  reader.onabort = () => reject(new Error('读取备份分片被中断'));
                  reader.readAsDataURL(slice);
              });

              try {
                  const ranges = sliceRanges(blob.size, EXPORT_CHUNK_SIZE);
                  for (let i = 0; i < ranges.length; i++) {
                      const [start, end] = ranges[i];
                      const base64 = await sliceToBase64(blob.slice(start, end));
                      if (i === 0) {
                          await Filesystem.writeFile({ path: tempName, data: base64, directory: Directory.Cache });
                      } else {
                          await Filesystem.appendFile({ path: tempName, data: base64, directory: Directory.Cache });
                      }
                  }
                  // 全部分片写盘成功，才把临时文件改名为正式名并分享。
                  await Filesystem.rename({ from: tempName, to: fileName, directory: Directory.Cache });
                  const uriResult = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
                  await Share.share({ title: `Sully Backup`, files: [uriResult.uri] });
              } catch (e) {
                  console.error("Native write failed", e);
                  // 尽力清掉写了一半的残片，别留下损坏文件。
                  try { await Filesystem.deleteFile({ path: tempName, directory: Directory.Cache }); } catch { /* ignore */ }
                  trackEvent('保存备份文件到手机失败', { mode });
                  addToast("保存文件失败", "error");
              }
          } else {
              // Web Download
              // 上一次导出的 object URL 先 revoke 掉，否则它会一直占着整包内存直到刷新页面。
              if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
              const url = URL.createObjectURL(blob);
              downloadUrlRef.current = url;
              setDownloadUrl(url);
              const fileName = 'Sully_Backup_' + mode + '_' + new Date().toISOString().slice(0,10) + '.zip';
              setDownloadFileName(fileName);
              setShowExportModal(true);

              // Auto click
              const a = document.createElement('a');
              a.href = url;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
          }
      } catch (e: any) {
          // 只报导出档位，错误文案是动态串不能进属性
          trackEvent('导出备份失败', { mode });
          addToast(e.message, 'error');
      }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Pass the File object directly to importSystem
      importSystem(file, { confirmBackendRestore: askRestoreBackendConnection }).catch(err => {
          console.error(err);
          // 只上报归类后的固定枚举：报错原文（可能含文件路径/内容片段）只留在 console
          const rawMessage = String(err?.message || '');
          trackEvent('导入备份失败', {
              source: file.name.toLowerCase().endsWith('.zip') ? 'zip' : 'json',
              reason:
                  /无效的文件格式/.test(rawMessage) ? 'invalid_file_format'
                  : /缺少 data\.json/.test(rawMessage) ? 'missing_data_json'
                  : /manifest\.json 解析失败/.test(rawMessage) ? 'bad_manifest'
                  : /JSON 格式错误/.test(rawMessage) ? 'json_syntax'
                  : 'other',
          });
          const details = err?.stack || err?.message || String(err || '未知错误');
          showError('导入失败', details);
          addToast('导入失败，错误信息已展开', 'error');
      });
      
      if (importInputRef.current) importInputRef.current.value = '';
  };

  const deliverStandaloneBackup = async (blob: Blob, fileName: string, shareTitle: string) => {
      if (Capacitor.isNativePlatform()) {
          const tempName = `${fileName}.part`;
          const sliceToBase64 = (slice: Blob): Promise<string> => new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                  const result = String(reader.result);
                  const comma = result.indexOf(',');
                  resolve(comma >= 0 ? result.slice(comma + 1) : result);
              };
              reader.onerror = () => reject(reader.error || new Error('读取模型备份分片失败'));
              reader.onabort = () => reject(new Error('读取模型备份分片被中断'));
              reader.readAsDataURL(slice);
          });

          try {
              const ranges = sliceRanges(blob.size, EXPORT_CHUNK_SIZE);
              for (let index = 0; index < ranges.length; index++) {
                  const [start, end] = ranges[index];
                  const base64 = await sliceToBase64(blob.slice(start, end));
                  if (index === 0) {
                      await Filesystem.writeFile({ path: tempName, data: base64, directory: Directory.Cache });
                  } else {
                      await Filesystem.appendFile({ path: tempName, data: base64, directory: Directory.Cache });
                  }
              }
              await Filesystem.rename({ from: tempName, to: fileName, directory: Directory.Cache });
              const uriResult = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
              await Share.share({ title: shareTitle, files: [uriResult.uri] });
          } catch (error) {
              try { await Filesystem.deleteFile({ path: tempName, directory: Directory.Cache }); } catch { /* ignore */ }
              throw error;
          }
          return;
      }

      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      const url = URL.createObjectURL(blob);
      downloadUrlRef.current = url;
      setDownloadUrl(url);
      setDownloadFileName(fileName);
      setShowExportModal(true);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
  };

  const handleAvatarModelExport = async () => {
      if (avatarModelBackupBusy) return;
      setAvatarModelBackupBusy(true);
      setAvatarModelBackupProgress({ phase: 'scan', done: 0, total: 1, label: '正在读取本地模型…' });
      try {
          const blob = await createAvatarModelBackup(setAvatarModelBackupProgress);
          const fileName = `Sully_Models_${new Date().toISOString().slice(0, 10)}_${Date.now()}.zip`;
          await deliverStandaloneBackup(blob, fileName, 'Sully 模型备份');
          addToast(`模型备份已生成（${formatBackupBytes(blob.size)}）`, 'success');
      } catch (error: any) {
          const details = error?.stack || error?.message || String(error || '未知错误');
          showError('模型备份导出失败', details);
          addToast(error?.message || '模型备份导出失败', 'error');
      } finally {
          setAvatarModelBackupBusy(false);
          setAvatarModelBackupProgress(null);
          void refreshAvatarModelInventory();
      }
  };

  const handleAvatarModelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (!files.length || avatarModelBackupBusy) return;
      setAvatarModelBackupBusy(true);
      let restored = 0;
      let skipped = 0;
      let restoredBytes = 0;
      try {
          for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
              const file = files[fileIndex];
              const result = await restoreAvatarModelBackup(file, progress => {
                  setAvatarModelBackupProgress({
                      ...progress,
                      label: files.length > 1 ? `[${fileIndex + 1}/${files.length}] ${progress.label}` : progress.label,
                  });
              });
              restored += result.restored;
              skipped += result.skipped;
              restoredBytes += result.restoredBytes;
              for (const model of result.models) {
                  updateCharacter(model.characterId, { videoAvatar: model.config });
              }
          }
          await refreshAvatarModelInventory();
          addToast(
              skipped > 0
                  ? `已恢复 ${restored} 个模型，跳过 ${skipped} 个未找到的角色`
                  : `已顺序恢复 ${restored} 个模型（${formatBackupBytes(restoredBytes)}）`,
              skipped > 0 ? 'info' : 'success',
          );
      } catch (error: any) {
          const details = error?.stack || error?.message || String(error || '未知错误');
          showError('模型备份导入失败', details);
          addToast(restored > 0 ? `已恢复 ${restored} 个模型后中断` : '模型备份导入失败', 'error');
      } finally {
          setAvatarModelBackupBusy(false);
          setAvatarModelBackupProgress(null);
          if (avatarModelBackupInputRef.current) avatarModelBackupInputRef.current.value = '';
      }
  };
  // Cloud Backup Handlers
  const handleTestCloudConnection = async () => {
      setCloudTesting(true);
      setCloudTestResult('');
      try {
          const { testConnection } = await import('../utils/webdavClient');
          const tempConfig = { ...cloudBackupConfig, webdavUrl: cbUrl, username: cbUsername, password: cbPassword, remotePath: cbPath };
          const result = await testConnection(tempConfig);
          setCloudTestResult(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
          // 失败原因收敛成固定几类，地址/账号/密码与原始报错都不上报
          if (result.ok) {
              trackEvent('测试 WebDAV 连接', { result: '成功' });
          } else {
              const m = result.message || '';
              trackEvent('测试 WebDAV 连接', {
                  result: '失败',
                  failure_kind:
                      /认证失败/.test(m) ? 'auth_401'
                      : /无法创建/.test(m) ? 'dir_missing_uncreatable'
                      : /服务器返回/.test(m) ? 'http_status'
                      : 'network_error',
              });
          }
      } catch (e: any) {
          trackEvent('测试 WebDAV 连接', { result: '失败', failure_kind: 'network_error' });
          setCloudTestResult(`✗ ${e.message}`);
      }
      setCloudTesting(false);
  };

  const handleSaveCloudConfig = () => {
      updateCloudBackupConfig({
          enabled: true,
          provider: 'webdav',
          webdavUrl: cbUrl, username: cbUsername, password: cbPassword,
          remotePath: cbPath,
      });
      addToast('云端备份配置已保存', 'success');
      setShowCloudModal(false);
  };

  // 保存 / 恢复主代理 Worker 地址
  // 主动消息那边的搜索、Notion、飞书全经这个地址转发（tool_config.proxyWorkerUrl），
  // 所以改完必须把 tool_config 重传一次——不然云端还指着旧地址，角色到点的工具全静默失灵。
  const handleSaveProxyWorker = (input: string = proxyWorkerInput) => { // [EM: settings-subpages-f] 代理页把填的值直接传进来
      const raw = input.trim();
      if (raw && !/^https?:\/\//i.test(raw)) {
          addToast('地址必须以 http:// 或 https:// 开头', 'error');
          trackEvent('代理地址格式被拒');
          return;
      }
      setProxyWorkerUrl(raw);                 // 传空 / 默认地址 → 自动回落默认
      const applied = getProxyWorkerUrl();
      setProxyWorkerInput(applied);
      // 上云那份的 proxyWorkerUrl 是现算的（读 getProxyWorkerUrl），所以要在生效之后再传。
      syncAmsgToolConfig(realtimeConfig);
      if (applied === DEFAULT_PROXY_WORKER) trackEvent('恢复默认代理 Worker', { via: 'save-empty' });
      addToast(applied === DEFAULT_PROXY_WORKER ? '已恢复为默认 Worker' : 'Worker 地址已保存', 'success');
  };

  const handleResetProxyWorker = () => {
      setProxyWorkerUrl('');
      setProxyWorkerInput(getProxyWorkerUrl());
      syncAmsgToolConfig(realtimeConfig);
      trackEvent('恢复默认代理 Worker', { via: 'reset-button' });
      addToast('已恢复为默认 Worker', 'info');
  };

  const handleCloudBackup = async (mode: 'text_only' | 'full') => {
      try { await cloudBackupToWebDAV(mode); } catch { /* toast handled in context */ }
  };

  const handleOpenCloudRestore = async () => {
      const version = ++cloudBackupListVersion.current; // [EM: github-backup-status]
      setShowCloudRestoreModal(true);
      setCloudBackupFiles([]);
      setCloudBackupListState('loading');
      setCloudBackupListError('');
      try {
          const files = await listCloudBackups();
          if (version !== cloudBackupListVersion.current) return; // [EM: github-backup-status]
          setCloudBackupFiles(files);
          setCloudBackupListState('ready');
          trackEvent('加载云端备份列表', { provider: cloudBackupConfig.provider === 'github' ? 'github' : 'webdav', result: '成功' });
      } catch (error) {
          if (version !== cloudBackupListVersion.current) return; // [EM: github-backup-status]
          setCloudBackupListState('error');
          setCloudBackupListError(error instanceof Error ? error.message : '获取云端备份列表失败');
          trackEvent('加载云端备份列表', { provider: cloudBackupConfig.provider === 'github' ? 'github' : 'webdav', result: '失败' });
          addToast('获取云端备份列表失败', 'error');
      }
  };

  const handleCloudRestore = async (file: import('../types').CloudBackupFile) => {
      if (file.status === 'incomplete') {
          addToast(file.statusMessage || '这个备份上传未完成，暂时不能恢复', 'error');
          return;
      }
      setShowCloudRestoreModal(false);
      try {
          await cloudRestoreFromWebDAV(file);
      } catch (err: any) {
          // 只区分「下载阶段」还是「导入阶段」，报错原文只进 showError / console
          trackEvent('从云端恢复失败', {
              provider: cloudBackupConfig.provider === 'github' ? 'github' : 'webdav',
              stage: /^恢复失败/.test(String(err?.message || '')) ? 'import' : 'download',
          });
          const details = err?.stack || err?.message || String(err || '未知错误');
          showError('云端恢复失败', details);
      }
  };

  // GitHub backup handlers — single "测试并连接" button does verify-token +
  // ensure-repo, persists owner/login on success so users never type 'owner'.
  const handleTestGithub = async () => {
      if (!ghToken.trim()) {
          trackEvent('测试并连接 GitHub', { result: '失败', failure_stage: 'no_token' });
          setGhTestResult('✗ 请先粘贴 Token');
          return;
      }
      setGhTesting(true);
      setGhTestResult('');
      try {
          const { testConnection } = await import('../utils/githubClient');
          const result = await testConnection({
              ...cloudBackupConfig,
              githubToken: ghToken.trim(),
              githubRepo: ghRepo.trim() || 'sully-backup',
              githubUseProxy: ghUseProxy,
              githubProxyConsentVersion: ghUseProxy ? 1 : undefined,
          });
          setGhTestResult(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
          // 失败时只报卡在哪一步：token 校验没过 → 没有 login，仓库准备没过 → 有 login
          trackEvent('测试并连接 GitHub', result.ok
              ? { result: '成功' }
              : { result: '失败', failure_stage: result.login ? 'ensure_repo' : 'verify_token' });
          if (result.ok && result.login) {
              updateCloudBackupConfig({
                  enabled: true,
                  provider: 'github',
                  githubToken: ghToken.trim(),
                  githubOwner: result.login,
                  githubRepo: ghRepo.trim() || 'sully-backup',
                  githubUseProxy: ghUseProxy,
                  githubProxyConsentVersion: ghUseProxy ? 1 : undefined,
              });
          }
      } catch (e: any) {
          trackEvent('测试并连接 GitHub', { result: '失败', failure_stage: 'exception' });
          setGhTestResult(`✗ ${e?.message || '连接失败'}`);
      }
      setGhTesting(false);
  };

  // [EM-START: github-backup-status]
  const handleGithubProxyToggle = (enabled: boolean) => {
      setGhUseProxy(enabled);
      updateCloudBackupConfig({ githubUseProxy: enabled, githubProxyConsentVersion: enabled ? 1 : undefined });
      addToast(enabled ? '已开启 GitHub 中转，下次备份生效' : '已切换为直连 GitHub，下次备份生效', 'info');
  };
  // [EM-END: github-backup-status]

  const handleDisableCloud = () => {
      trackEvent('关闭云端备份', { provider: cloudBackupConfig.provider === 'github' ? 'github' : 'webdav' });
      updateCloudBackupConfig({ enabled: false });
      setShowCloudModal(false);
      setShowGithubModal(false);
      addToast('云端备份已关闭', 'info');
  };

  // One-click provider switch — if the target provider was already configured
  // before, just flip the 'provider' field and show a toast. Otherwise open
  // the setup modal. Critically: switching does NOT touch the other side's
  // saved credentials, so old WebDAV users keep their old backups visible
  // when they switch back.
  const switchToGithub = () => {
      trackEvent('切换云端备份服务商', { to: 'github' });
      if (cloudBackupConfig.githubToken && cloudBackupConfig.githubOwner) {
          updateCloudBackupConfig({ provider: 'github' });
          addToast(`已切换到 GitHub @${cloudBackupConfig.githubOwner}`, 'success');
      } else {
          setShowGithubModal(true);
      }
  };
  const switchToWebDAV = () => {
      trackEvent('切换云端备份服务商', { to: 'webdav' });
      if (cloudBackupConfig.webdavUrl && cloudBackupConfig.username) {
          updateCloudBackupConfig({ provider: 'webdav' });
          addToast('已切换回 WebDAV，旧备份依旧在', 'success');
      } else {
          setShowCloudModal(true);
      }
  };

  const confirmReset = () => {
      resetSystem();
      setShowResetConfirm(false);
  };

  // [EM: settings-subpages-f] 实时感知 / 日记同步 / 小红书的读写搬进 components/settings/{RealtimeSensePage,DiarySyncPage,XhsSettingsPage}.tsx；麦当劳、瑞幸 2026-10-22 删了

  // [EM-START: settings-ios-list] 苹果式分组列表：首页一列短行、右边写状态，点进子页
  const [settingsPage, setSettingsPage] = useState<SettingsPageId | null>(null);
  const onPage = (id: SettingsPageId) => settingsPage === id;
  // [EM: settings-inline-config] 实时感知 / MCP / 主动消息的配置直接铺在子页里：留给它们的节点 + 进出页时补上弹窗开合要做的事
  const [inlineSlot, setInlineSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
      if (settingsPage !== 'mcp') flushMcpToolConfigSync(); // 离开 MCP 页 = 原来关弹窗：攒着的改动当场传上去
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsPage]);
  const instantPushOn = (() => { try { return loadInstantConfig().enabled === true; } catch { return false; } })();
  const settingsHomeValues: SettingsHomeValues = (() => {
      const now = Date.now();
      const imageGen = resolveImageGenerationConfig(apiConfig.imageGeneration);
      // [EM: settings-split-senses] 感知只算天气、新闻、运动；日记同步、小红书各算各的
      const realtimeOn = [realtimeConfig.weatherEnabled && '天气', realtimeConfig.newsEnabled && '新闻'].filter(Boolean) as string[];
      const diaryOn = [realtimeConfig.notionEnabled && 'Notion'].filter(Boolean) as string[];
      return {
          mainApi: apiPresets.find(p => p.id === activePresetId)?.name || String(apiConfig.model || '') || '未设置',
          vision: apiConfig.visionApi?.enabled ? (apiConfig.visionApi.model || '已接入') : '未接入',
          image: imageGen.provider === 'pollinations-free' ? '内置免费' : (imageGen.model || '自定义'),
          voice: apiConfig.minimaxApiKey || apiConfig.fishAudioApiKey ? '已设置' : '未设置',
          realtime: realtimeOn.length ? realtimeOn.join(' · ') : '都关着',
          diary: diaryOn.length ? diaryOn.join(' · ') : '没开', // [EM: settings-split-senses]
          xhs: realtimeConfig.xhsEnabled ? ((realtimeConfig.xhsMcpConfig?.serverUrl || '').includes('/api') ? '云端 Lite' : 'mini 上那台') : '没开', // [EM: settings-split-senses]
          proxy: getProxyWorkerUrl() === DEFAULT_PROXY_WORKER ? '默认' : '自定义',
          backup: cloudBackupConfig.lastBackupTime ? relativeAgo(cloudBackupConfig.lastBackupTime, now) : (cloudBackupConfig.enabled ? '还没成功过' : '没开云端'),
          amsg: '',
          push: isPushVapidReady() ? '已设置' : '未设置',
          version: APP_VERSION.replace(/\s*[（(].*$/, ''),
          staleBackupDays: staleBackupDays(cloudBackupConfig, now),
          instantPushOn,
      };
  })();
  // [EM-END: settings-ios-list]

  return (
    <SettingsInlineSlotContext.Provider value={inlineSlot}> {/* [EM: settings-inline-config] */}
    <div className={`h-full w-full flex flex-col relative isolate ${SETTINGS_F_CLASS}`} style={{ ...SETTINGS_F_VARS, background: F.appBg }}> {/* [EM: settings-ios-list] [EM: settings-skin-f] 子页里的上游样式由 settingsF.css 统一换成 F */}

      {/* GLOBAL PROGRESS OVERLAY */}
      {sysOperation.status === 'processing' && (
          <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center animate-fade-in">
              <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 w-64">
                  <div className="w-12 h-12 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
                  <div className="text-sm font-bold text-slate-700 text-center leading-relaxed whitespace-pre-wrap break-words max-w-full">{sysOperation.message}</div>
                  {sysOperation.progress > 0 && (
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${sysOperation.progress}%` }}></div>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* [EM-START: settings-ios-list] F 顶栏：首页返回桌面，子页返回首页 */}
      <div className="shrink-0 z-10" style={{ paddingTop: 'var(--chrome-top)', background: F.appBg }}>
        <div className="relative flex items-center" style={{ minHeight: 52, padding: '0 8px' }}>
          <button type="button" onClick={() => (settingsPage ? setSettingsPage(null) : closeApp())} aria-label={settingsPage ? '返回设置' : '返回'}
            className="relative z-10 flex items-center justify-center active:opacity-40 transition-opacity" style={iconButtonBare}>
            <CaretLeft size={22} weight="bold" color={F.textPrimary} />
          </button>
          <h1 className="absolute left-0 right-0 text-center pointer-events-none truncate" style={{ ...FONT.navTitle, fontFamily: FONT.heading, color: F.textPrimary, padding: '0 64px', margin: 0 }}>
            {settingsPage ? SETTINGS_PAGE_TITLES[settingsPage] : '设置'}
          </h1>
        </div>
      </div>
      {/* [EM-END: settings-ios-list] */}

      {/* [EM-START: settings-ios-list] 首页是分组列表，子页只渲染属于它的那几块；换页时滚动回顶 */}
      <div key={settingsPage ?? 'home'} className="flex-1 overflow-y-auto no-scrollbar flex flex-col" style={{ padding: '4px 16px 80px', gap: 22, background: F.appBg }}>
      <SettingsSectionTitleContext.Provider value={!!settingsPage && MULTI_SECTION_PAGES.has(settingsPage)}>
        {!settingsPage && <SettingsHome values={settingsHomeValues} onOpen={setSettingsPage} onOpenApiLog={() => setShowApiCallLog(true)} />}
        {onPage('profile') && <ProfileSettingsPage />}
        {onPage('mcp') && <McpStatusPanel />}
        {onPage('storage') && <StorageUsagePanel />}
        {onPage('external-images') && (<><ExternalImagesPanel /> {/* [EM: external-images-rescue] */}</>)}
      {/* [EM-END: settings-ios-list] */}
        
        {onPage('appearance') && <AppearanceEmergency />} {/* [EM: settings-ios-list] */}
        {/* [EM-START: settings-subpages-f] 备份页换成分组列表（样稿 docs/design/settings-subpages-mock.html）；动作和弹窗还在本文件 */}
        {onPage('backup') && (
            <BackupSettingsPage
                cloud={cloudBackupConfig}
                onCloudBackup={mode => void handleCloudBackup(mode)}
                onOpenCloudRestore={() => void handleOpenCloudRestore()}
                onEditGithub={() => { trackEvent('连接云端备份服务商', { provider: 'github' }); setShowGithubModal(true); }}
                onEditWebdav={() => { trackEvent('连接云端备份服务商', { provider: 'webdav' }); setShowCloudModal(true); }}
                onSwitchToGithub={switchToGithub}
                onSwitchToWebdav={switchToWebDAV}
                onExport={mode => void handleExport(mode)}
                onPickImportFile={() => importInputRef.current?.click()}
                exportBackendConnection={exportBackendConnection}
                setExportBackendConnection={setExportBackendConnection}
                models={avatarModelInventory}
                modelBusy={avatarModelBackupBusy}
                modelProgress={avatarModelBackupProgress}
                onExportModels={() => void handleAvatarModelExport()}
                onPickModelFiles={() => avatarModelBackupInputRef.current?.click()}
                reminderDays={backupReminderDays}
                reminderMin={BACKUP_REMINDER_MIN_DAYS}
                reminderMax={BACKUP_REMINDER_MAX_DAYS}
                onReminderDays={days => { setBackupReminderDays(days); setBackupReminderIntervalDays(days); }}
                daysSinceExport={backupDaysAgo}
                cleaningResidue={isCleaningResidue}
                onCleanupResidue={() => void handleCleanupResidue()}
                onReset={() => setShowResetConfirm(true)}
                formatBytes={formatBackupBytes}
            />
        )}
        <input type="file" ref={importInputRef} className="hidden" accept=".json,.zip" onChange={handleImport} />
        <input ref={avatarModelBackupInputRef} type="file" accept=".zip,application/zip" multiple className="hidden" onChange={handleAvatarModelImport} />
        {/* [EM-END: settings-subpages-f] */}

        {/* [EM-START: settings-subpages-f] 主 API：预设一条一行，点名字就切；状态、保存、切换逻辑还在本文件 */}
        {onPage('api-main') && (
            <MainApiPage
                sections={groupApiPresets(apiPresets)}
                activePresetId={activePresetId}
                onApply={applyPreset}
                onEdit={openEditPreset}
                onNew={() => { setNewPresetName(''); setShowPresetModal(true); }}
                url={localUrl} setUrl={setLocalUrl}
                apiKey={localKey} setApiKey={setLocalKey}
                model={localModel}
                onPickModel={() => setShowModelModal(true)}
                onRefreshModels={() => void fetchModels()}
                loadingModels={isLoadingModels}
                stream={localStream} setStream={setLocalStream}
                temperature={localTemperature} setTemperature={setLocalTemperature}
                advancedOpen={showApiAdvanced} setAdvancedOpen={setShowApiAdvanced}
                onSave={handleSaveApi}
                saveLabel={statusMsg || '保存配置'}
                onTest={() => void handleTestApi()}
                testing={testingApi}
                testResult={testApiResult}
                onOpenLog={() => setShowApiCallLog(true)}
            />
        )}
        {/* [EM-END: settings-subpages-f] */}

        {/* [EM-START: settings-subpages-f] 识图：开关 + 预设小圆片 + 一组配置；草稿和保存还在本文件 */}
        {onPage('api-vision') && (
            <VisionApiPage
                enabled={localVisionEnabled}
                savedEnabled={!!apiConfig.visionApi?.enabled}
                onToggle={handleToggleVisionApi}
                presets={apiPresets}
                selectedPresetId={selectedVisionPresetId}
                onLoadPreset={loadVisionApiPreset}
                url={localVisionUrl} setUrl={v => { setLocalVisionUrl(v); setSelectedVisionPresetId(null); setVisionTestResult(null); }}
                apiKey={localVisionKey} setApiKey={v => { setLocalVisionKey(v); setSelectedVisionPresetId(null); setVisionTestResult(null); }}
                model={localVisionModel}
                onPickModel={() => setShowVisionModelModal(true)}
                onRefreshModels={() => void fetchVisionModels()}
                loadingModels={isLoadingVisionModels}
                onTest={() => void handleTestVisionApi()}
                testing={testingVisionApi}
                testResult={visionTestResult}
                onSave={() => handleSaveVisionApi()}
                statusMsg={visionStatusMsg}
            />
        )}
        {/* [EM-END: settings-subpages-f] */}

        {/* [EM-START: settings-subpages-f] 生图：原来整页玫红，换成设置的蓝；草稿、保存、测试还在本文件 */}
        {onPage('api-image') && (
            <ImageApiPage
                savedProvider={resolveImageGenerationConfig(apiConfig.imageGeneration).provider === 'pollinations-free' ? 'pollinations-free' : 'openai-compatible'}
                savedModel={resolveImageGenerationConfig(apiConfig.imageGeneration).model || ''}
                provider={localImageProvider} setProvider={v => { setLocalImageProvider(v); setImageGenerationStatusMsg(''); }}
                mode={localImageRequestMode} setMode={v => { setLocalImageRequestMode(v); setImageGenerationStatusMsg(''); }}
                url={localImageUrl} setUrl={setLocalImageUrl}
                apiKey={localImageKey} setApiKey={setLocalImageKey}
                model={localImageModel}
                onPickModel={() => setShowImageModelModal(true)}
                onRefreshModels={() => void fetchImageModels()}
                loadingModels={isLoadingImageModels}
                useReference={localUseCharacterReference} setUseReference={setLocalUseCharacterReference}
                onTest={() => void handleTestImageGeneration()}
                testing={testingImageGeneration}
                onSave={() => void handleSaveImageGenerationApi()}
                statusMsg={imageGenerationStatusMsg}
                preview={imageGenerationPreview}
            />
        )}
        {/* [EM-END: settings-subpages-f] */}

        {/* [EM-START: settings-subpages-f] 语音与写歌：引擎分段 / MiniMax / 鱼声 / 写歌 / 高级；草稿和保存还在本文件 */}
        {onPage('voice') && (
            <VoiceApiPage
                provider={localTtsProvider} onProvider={selectTtsProvider}
                region={localMiniMaxRegion} setRegion={setLocalMiniMaxRegion}
                miniMaxKey={localMiniMaxKey} setMiniMaxKey={setLocalMiniMaxKey}
                miniMaxGroupId={localMiniMaxGroupId} setMiniMaxGroupId={setLocalMiniMaxGroupId}
                fishKey={localFishKey} setFishKey={setLocalFishKey}
                fishModel={localFishModel} onFishModel={selectFishModel}
                aceStepKey={localAceStepKey} setAceStepKey={setLocalAceStepKey}
                guideOpen={showAceStepGuide} setGuideOpen={setShowAceStepGuide}
                promptsOpen={showVoicePrompts} setPromptsOpen={setShowVoicePrompts}
                prompts={[
                    { key: 'minimax', title: 'MiniMax 语音指南', hint: '聊天 + 电话，用 MiniMax 时', value: localVoicePromptMinimax, setValue: setLocalVoicePromptMinimax, defaultText: VOICE_ACTING_GUIDE },
                    { key: 'fishaudio', title: '鱼声语音指南', hint: '聊天 + 电话，用鱼声时', value: localVoicePromptFish, setValue: setLocalVoicePromptFish, defaultText: FISH_VOICE_ACTING_GUIDE },
                    { key: 'dateVoice', title: '见面语音情绪', hint: '见面专用 [v:xxx]，跟引擎无关', value: localVoicePromptDate, setValue: setLocalVoicePromptDate, defaultText: DATE_VOICE_GUIDE },
                ]}
                onSave={handleSaveOtherApis}
                saveLabel={otherStatusMsg || '保存其他 API'}
            />
        )}
        {/* [EM-END: settings-subpages-f] */}

        {/* [EM-START: settings-subpages-f] 感知 / 日记同步 / 小红书三页是 EM 自己的组件，改了就存，不再有「保存配置」 */}
        {onPage('realtime') && <RealtimeSensePage />}
        {onPage('diary-sync') && <DiarySyncPage />}
        {onPage('xhs') && <XhsSettingsPage />}
        {/* [EM-END: settings-subpages-f] */}

        {onPage('mcp') && (<> {/* [EM: settings-ios-list] */}
        {/* MCP 工具服务器（高级玩法）—— 通用外接工具，独立于实时感知 */}
        <SettingsSection
            title="MCP 工具服务器"
            badge={<span className="text-[9px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full font-bold shrink-0">高级玩法</span>}
            icon={
                <div className="p-2 bg-violet-100/50 rounded-xl text-violet-600">
                    <PlugsConnected size={16} weight="fill" />
                </div>
            }
            actions={
                <>
                    <button
                        onClick={() => { trackEvent('打开「MCP 是什么」说明弹窗'); setShowMcpHelp(true); }}
                        aria-label="MCP 是什么？"
                        className="w-7 h-7 rounded-full border border-slate-200 bg-white text-[12px] font-bold text-slate-400 active:scale-90 transition-all"
                    >?</button>
                    {/* [EM: settings-inline-config] 服务器列表直接铺在这一页下面，不再要「配置」按钮 */}
                </>
            }
        >
            <p className="text-xs text-slate-500 leading-relaxed">
                给角色外接任意标准 MCP 工具服务器：记忆库、联网搜索、笔记、智能家居……接上什么，角色就多什么本事。
            </p>
            <p className="text-[10px] text-amber-600 mt-2 leading-relaxed bg-amber-50/80 border border-amber-100 rounded-lg px-2 py-1.5">
                💡 这个板块推荐<b>本身就在用 MCP</b> 的玩家：你需要自己准备并维护工具服务器。
                完全没听说过 MCP 的话，跳过这里不影响任何其他功能；真想入坑就先点「?」看说明。
            </p>
            {(() => {
                const list = loadMcpServers();
                if (!list.length) return null;
                const on = list.filter(s => s.enabled && s.tools?.length);
                const toolCount = on.reduce((n, s) => n + (s.tools?.length || 0), 0);
                return (
                    <p className="text-[10px] text-slate-400 mt-2">
                        已配置 {list.length} 个服务器 · {on.length} 个启用中{toolCount ? ` · 共 ${toolCount} 个工具` : ''}
                    </p>
                );
            })()}
        </SettingsSection>
        </>)} {/* [EM: settings-ios-list] */}

        {onPage('push') && (<> {/* [EM: settings-ios-list] */}
        {/* ───────── 推送凭据 (VAPID) ───────── */}
        {/* VAPID 公私钥, 与 Proactive / Instant Push 共用一份 — 独立成块, 避免再被当成 */}
        {/* Instant Push 的子配置, 也避免两边 key 不一致互相抢同一个 pushManager 订阅. */}
        {/* vapidReadyTick: VAPID 弹窗关闭后 +1, 让本节点 re-render 重读 isPushVapidReady(). */}
        <SettingsSection
            title="推送凭据 (VAPID)"
            sectionProps={{ 'data-vapid-tick': vapidReadyTick }}
            icon={
                <div className="p-2 bg-violet-100/60 rounded-xl text-violet-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
                    </svg>
                </div>
            }
            actions={
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isPushVapidReady() ? 'bg-violet-100 text-violet-600' : 'bg-rose-100 text-rose-600'}`}>
                    {isPushVapidReady() ? '已配置' : '未配置'}
                </span>
            }
        >
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                Proactive Push 和 Instant Push <b>共用同一份 VAPID 密钥对</b>。重新生成会让已开的推送失效，需要重新开启。
            </p>
            <button
                type="button"
                onClick={() => setShowVapidModal(true)}
                className={`w-full py-2.5 rounded-xl text-xs font-bold ${isPushVapidReady() ? 'bg-white text-violet-700 border border-violet-200 hover:bg-violet-50' : 'bg-violet-500 text-white hover:bg-violet-600 shadow-md shadow-violet-200'}`}
            >
                {isPushVapidReady() ? '查看 / 重新生成' : '生成 VAPID 密钥对 →'}
            </button>
        </SettingsSection>
        </>)} {/* [EM: settings-ios-list] */}

        {onPage('push') && (<> {/* [EM: settings-ios-list] */}
        {/* ───────── 推送订阅状态（诊断 + 重置） ───────── */}
        <SettingsSection
            title="推送订阅状态"
            icon={
                <div className="p-2 bg-sky-100/60 rounded-xl text-sky-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                    </svg>
                </div>
            }
        >
            <PushSubscriptionPanel addToast={addToast} />
        </SettingsSection>
        </>)} {/* [EM: settings-ios-list] */}

        {onPage('push') && (<> {/* [EM: settings-ios-list] */}
        {/* ───────── 主动消息 Push 加速器（开关） ───────── */}
        {SHOW_PROACTIVE_PUSH_ACCEL_UI && ppAvailable && (
        <SettingsSection
            title="主动消息 Push 加速"
            icon={
                <div className="p-2 bg-teal-100/60 rounded-xl text-teal-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                    </svg>
                </div>
            }
            actions={
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${ppEnabled ? 'bg-teal-100 text-teal-600' : 'bg-slate-100 text-slate-400'}`}>
                    {ppEnabled ? '已启用' : '未启用'}
                </span>
            }
        >
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                让主动消息在浏览器后台标签里也能准点触发。AI 仍在本地生成，云端只管"到点喊醒浏览器"。
                浏览器进程被完全关闭时无法唤醒——下次打开 app 会自动补跑漏掉的主动消息，
                你看到的就是"开 app 即有"，不会半路弹窗打扰你。
            </p>

            {ppStatus && (
                <div className={`mb-3 p-3 rounded-xl text-xs font-medium text-center ${ppStatus.includes('成功') || ppStatus.includes('已启用') || ppStatus.includes('OK') ? 'bg-emerald-100 text-emerald-700' : ppStatus.includes('失败') || ppStatus.includes('错误') || ppStatus.includes('拒绝') ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'}`}>
                    {ppStatus}
                </div>
            )}

            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                <div>
                    <p className="text-[11px] text-slate-600 font-medium">启用 Push 加速</p>
                    <p className="text-[10px] text-slate-400">关闭则退回纯本地计时器</p>
                </div>
                <button
                    disabled={ppBusy}
                    onClick={() => {
                        if (ppBusy) return;
                        trackEvent('切换主动消息Push加速', { action: ppEnabled ? 'disable' : 'enable' });
                        if (ppEnabled) {
                            void doDisablePushAccelerator();
                        } else {
                            setShowPpConfirm(true);
                        }
                    }}
                    className={`w-10 h-5 rounded-full transition-colors ${ppEnabled ? 'bg-teal-500' : 'bg-slate-300'} ${ppBusy ? 'opacity-60' : ''}`}
                >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${ppEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
            </div>

            {/* ───── 诊断面板 ───── */}
            <div className="mt-4 bg-slate-50/70 rounded-2xl p-4 border border-slate-100">
                <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-slate-600">Web Push 状态</p>
                    <button
                        onClick={() => {
                            // 全部是浏览器/设备状态的固定枚举，不含端点地址、也不含任何用户配置值
                            trackEvent('刷新 Web Push 诊断', ppDiag ? {
                                permission: ppDiag.permission,
                                subscription: !ppDiag.endpoint ? 'none' : ppDiag.endpointDead ? 'dead' : 'active',
                                swState: ppDiag.swState === 'activated' ? 'activated' : ppDiag.swState === 'none' ? 'none' : 'other',
                                platform: ppDiag.capacitorNative ? 'capacitor_native' : ppDiag.iosNeedsPwa ? 'ios_needs_pwa' : 'normal',
                            } : undefined);
                            void refreshPpDiag();
                        }}
                        className="text-[10px] px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                        刷新
                    </button>
                </div>

                {ppDiag ? (
                    <div className="space-y-1.5 text-[11px]">
                        <DiagRow
                            label="浏览器支持"
                            value={
                                ppDiag.capacitorNative ? '否（当前在 App 里运行）' :
                                ppDiag.supported ? '是' : '否（浏览器缺少推送相关 API）'
                            }
                            bad={!ppDiag.supported || ppDiag.capacitorNative}
                        />
                        <DiagRow
                            label="通知权限"
                            value={
                                ppDiag.permission === 'granted' ? '已授权' :
                                ppDiag.permission === 'denied' ? '已拒绝（请到浏览器站点设置手动开启）' :
                                ppDiag.permission === 'default' ? '未决定' :
                                '不可用'
                            }
                            bad={ppDiag.permission !== 'granted'}
                        />
                        <DiagRow
                            label="Service Worker"
                            value={
                                ppDiag.swState === 'activated' ? `已激活（scope: ${ppDiag.swScope || '?'}）` :
                                ppDiag.swState === 'none' ? '未注册' :
                                `${ppDiag.swState}（scope: ${ppDiag.swScope || '?'}）`
                            }
                            bad={ppDiag.swState !== 'activated'}
                        />
                        <DiagRow
                            label="订阅"
                            value={
                                !ppDiag.endpoint ? '不存在' :
                                ppDiag.endpointDead ? '已失效（zombie endpoint）' :
                                '已建立'
                            }
                            bad={!ppDiag.endpoint || ppDiag.endpointDead}
                        />
                        <DiagRow label="推送通道" value={ppDiag.channel} />
                        <DiagRow
                            label="最近一次唤醒"
                            value={
                                ppDiag.lastWakeAt
                                    ? `${new Date(ppDiag.lastWakeAt).toLocaleString()}${ppDiag.lastWakeChar ? `（${ppDiag.lastWakeChar}）` : ''}`
                                    : '从未'
                            }
                        />
                        {ppDiag.endpoint && (
                            <div className="pt-2 mt-2 border-t border-slate-200">
                                <p className="text-[10px] text-slate-400 mb-1">订阅端点（前 60 字符）</p>
                                <p className={`text-[10px] font-mono break-all leading-relaxed ${ppDiag.endpointDead ? 'text-rose-600' : 'text-slate-500'}`}>{ppDiag.endpoint.slice(0, 60)}…</p>
                            </div>
                        )}
                        {ppDiag.endpointDead && (
                            <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded-lg text-[10px] text-rose-700 leading-relaxed">
                                订阅地址是 <code className="font-mono">permanently-removed.invalid</code>——浏览器已经把这个订阅吊销了
                                （常见原因：长期不访问、通知权限切换过、浏览器清理过站点数据）。<br/>
                                这个域名是 RFC 保留 TLD，全球永远不会解析；Worker 试图把 push 投递过去就会回 HTTP 530。<br/>
                                点下方<b>"重置订阅"</b>会清掉这条死订阅并重建一个新的。
                            </div>
                        )}
                        {ppDiag.iosNeedsPwa && (
                            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-700 leading-relaxed">
                                检测到 iOS Safari，但当前不是已添加到主屏幕的 PWA。<br/>
                                iOS 的 Web Push 必须先把网站"添加到主屏幕"启动后才能用。
                            </div>
                        )}
                        {ppDiag.capacitorNative && (
                            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-700 leading-relaxed">
                                你现在是在<b>打包好的 App</b>里运行（不是浏览器网页）。<br/>
                                这个"Push 加速器"只对网页版生效——App 里没有网页推送通道，但<b>不影响你正常用</b>：
                                主动消息会通过 App 的本地通知发出，App 在后台/锁屏也能收到。<br/>
                                下面的"测试推送 / 重置订阅"按钮在 App 里点了也没用，可以直接忽略这个面板。
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-[10px] text-slate-400">加载中…</p>
                )}

                {(() => {
                    const inDeepMode = ppZombieStreak >= 3;
                    const resetLabel = inDeepMode
                        ? (ppDeepResetBusy ? '深度重置中…' : '深度重置')
                        : (ppResetBusy ? '重置中…' : '重置订阅');
                    const resetBusy = ppResetBusy || ppDeepResetBusy;
                    return (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                                disabled={ppTestBusy || resetBusy || !ppDiag?.endpoint || ppDiag?.endpointDead || ppDiag?.capacitorNative}
                                onClick={() => void doSendTestPush()}
                                className={`py-2 rounded-xl text-xs font-bold ${ppTestBusy || resetBusy || !ppDiag?.endpoint || ppDiag?.endpointDead || ppDiag?.capacitorNative ? 'bg-slate-200 text-slate-400' : 'bg-teal-500 text-white hover:bg-teal-600'}`}
                            >
                                {ppTestBusy ? '测试中…' : '发一条测试推送'}
                            </button>
                            <button
                                disabled={resetBusy || ppTestBusy || ppDiag?.capacitorNative}
                                onClick={() => inDeepMode ? void doDeepResetSubscription() : void doResetSubscription()}
                                className={`py-2 rounded-xl text-xs font-bold border ${resetBusy || ppTestBusy || ppDiag?.capacitorNative ? 'bg-slate-100 text-slate-400 border-slate-200' : inDeepMode || ppDiag?.endpointDead ? 'bg-rose-500 text-white border-rose-500 hover:bg-rose-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                            >
                                {resetLabel}
                            </button>
                        </div>
                    );
                })()}
                <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                    "测试推送"会让 Worker 立刻给你这台设备发一条 push，5 秒内系统通知里出现"推送测试成功"= 链路通。
                    "重置订阅"会清掉旧订阅再建一个，适合订阅失效或换浏览器后用。
                    {ppZombieStreak >= 3 && <><br/>连续几次都没成，已切到"深度重置"——点一下做一次更彻底的清理。</>}
                </p>
            </div>
        </SettingsSection>
        )}
        </>)} {/* [EM: settings-ios-list] */}

        {onPage('push') && instantPushOn && (<> {/* [EM: settings-ios-list] */}
        {/* ───────── Instant Push ───────── */}
        <SettingsSection
            title="Instant Push"
            icon={
                <div className="p-2 bg-indigo-100/60 rounded-xl text-indigo-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 0 1 0-5.303m5.304 0a3.75 3.75 0 0 1 0 5.303m-7.425 2.122a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.789M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                </div>
            }
            actions={
                <button
                    onClick={() => { trackEvent('打开Instant Push配置'); setShowInstantModal(true); }}
                    className="text-[10px] bg-indigo-100 text-indigo-600 px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform"
                >
                    配置
                </button>
            }
        >
            <p className="text-xs text-slate-500 leading-relaxed">
                与上方 Push 加速器不同：前端发 prompt 到你自部署的 Worker，Worker 调你自己的 LLM 生成回复后分句逐条 Web Push。零数据库、零 cron。
            </p>
        </SettingsSection>
        </>)} {/* [EM: settings-ios-list] */}

        {onPage('intiface') && <IntifaceSettingsPage />} {/* [EM: settings-subpages-f] */}
        {onPage('amsg') && (<> {/* [EM: settings-ios-list] */}
        {/* ───────── 主动消息 2.0（定时推送） ───────── */}
        <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-violet-100/60 rounded-xl text-violet-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                    </div>
                    <h2 className="text-sm font-semibold text-slate-600 tracking-wider">主动消息 2.0</h2>
                </div>
                {/* [EM: settings-inline-config] 配置直接铺在这一页下面，不再要「配置」按钮 */}
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
                角色到点自动给你发消息，App 关着也能收。需要你自己部署一个 Cloudflare Worker（自带 D1 数据库 + 定时触发），在配置里填地址即可。聊天上云（即时对话）与定时主动消息都由它承担。
            </p>
        </section>
        </>)} {/* [EM: settings-ios-list] */}

        {onPage('web-fetch') && <FirecrawlSettings />} {/* [EM: settings-ios-list] */}

        {onPage('proxy') && <ProxySettingsPage current={proxyWorkerInput} onSave={url => handleSaveProxyWorker(url)} onReset={handleResetProxyWorker} />} {/* [EM: settings-subpages-f] */}

        {/* [EM-START: agent-backend-panel] 放在最后：日常用不到，不该挤在备份和 API 前面 */}
        {onPage('mini') && <AgentBackendSection defaultOpen />} {/* [EM: settings-ios-list] */}
        {/* [EM-END: agent-backend-panel] */}

        {onPage('about') && (<> {/* [EM: settings-ios-list] */}
        <VersionInfo />

        {/* QQ 小群入口不主动曝光：接近水印，仅在 hover / 键盘聚焦 / 按住时略微显现。 */}
        <button
            type="button"
            onClick={() => setShowCommunityMigration(true)}
            className="mx-auto mt-1 block px-4 py-2 text-center text-[9px] tracking-[0.12em] text-slate-500 opacity-[0.08] transition-opacity duration-500 hover:opacity-25 focus-visible:opacity-40 focus-visible:outline-none active:opacity-40"
            aria-label="打开社区迁移说明与 QQ 群入口"
        >
            · 社区迁移说明 ·
        </button>
        </>)} {/* [EM: settings-ios-list] */}
        {settingsPage && <div ref={setInlineSlot} className="flex flex-col" style={{ gap: 16 }} />} {/* [EM: settings-inline-config] 内嵌配置挂在这里 */}
      </SettingsSectionTitleContext.Provider> {/* [EM: settings-ios-list] */}
      </div>

      {/* 主动消息 Push 加速 · 启用前确认 */}
      <Modal
          isOpen={showPpConfirm}
          title="启用 Push 加速？"
          onClose={() => setShowPpConfirm(false)}
          footer={
              <div className="flex gap-2 w-full">
                  <button
                      onClick={() => { trackEvent('在 Push 加速启用确认弹窗做出选择', { choice: 'cancel' }); setShowPpConfirm(false); }}
                      className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl"
                  >
                      取消
                  </button>
                  <button
                      onClick={() => {
                          trackEvent('在 Push 加速启用确认弹窗做出选择', { choice: 'confirm' });
                          setShowPpConfirm(false);
                          void doEnablePushAccelerator();
                      }}
                      className="flex-1 py-3 bg-teal-500 text-white font-bold rounded-2xl shadow-lg shadow-teal-200"
                  >
                      我知道了，启用
                  </button>
              </div>
          }
      >
          <div className="space-y-3 text-[12px] leading-relaxed text-slate-600">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="font-bold text-amber-800 mb-1">启用后会做三件事</p>
                  <ol className="list-decimal pl-4 space-y-1 text-amber-900">
                      <li>浏览器会弹 <b>"允许发送通知？"</b> 的系统对话框——请点"允许"，不然没法在后台唤醒</li>
                      <li>浏览器生成一个 <b>推送订阅凭证</b>（只是一个"门铃地址"，不含任何聊天内容），上传到 Cloudflare</li>
                      <li>开着本应用的标签页时，每 2 分钟给 Cloudflare 发一次心跳；关掉 5 分钟 Cloudflare 自动停止喊你</li>
                  </ol>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <p className="font-bold text-emerald-800 mb-1">谁能看到什么</p>
                  <div className="space-y-1.5 text-emerald-900">
                      <p><b>Cloudflare 能看到：</b>推送订阅凭证 + 角色 ID（一串随机字符串）+ 间隔分钟数。<b>看不到</b>聊天内容、角色人设、AI 回复、API Key、你是谁。</p>
                      <p><b>浏览器厂商的推送服务（Google / Mozilla / Apple）：</b>知道你某时刻收到一条 push，内容是加密的，他们读不到。</p>
                      <p><b>你的 AI 接口供应商：</b>和平时聊天一样，到点时浏览器在<b>本地</b>直接调你在"API 配置"里填的那个接口，走你自己的 key。Cloudflare 完全不碰这一步。</p>
                  </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <p className="font-bold text-slate-700 mb-1">一句话</p>
                  <p className="text-slate-700">聊天记录和 AI 请求只在你自己和 AI 提供商之间，和现在没开 Push 加速时完全一样。Cloudflare 只是一个"到点按门铃"的闹钟。</p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="font-bold text-blue-800 mb-1">不会主动弹通知打扰你</p>
                  <p className="text-blue-900">浏览器后台标签 → 静默触发，进 app 就看到。浏览器整个关掉 → 下次打开 app 自动补跑，开 app 即有。中间不弹"有人想找你"那种窗口扰你。</p>
              </div>
          </div>
      </Modal>

      {/* Cloud Config Modal */}
      <Modal isOpen={showCloudModal} title="云端备份配置" onClose={() => setShowCloudModal(false)}>
          <div className="space-y-4 p-1">
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <p className="text-[10px] text-rose-700 leading-relaxed">
                      <b>🪜 需要梯子</b><br/>
                      InfiniCloud 是日本的服务，国内直连通常打不开注册页、也无法同步备份。<b>注册和之后每次同步都需要保持梯子开启</b>，否则会连接失败或超时。
                  </p>
              </div>
              <div className="bg-sky-50 rounded-xl p-3">
                  <p className="text-[10px] text-sky-700 leading-relaxed">
                      <b>快速上手 (InfiniCloud, 免费 20GB):</b><br/>
                      1. 注册 <a href="https://infini-cloud.net/" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline font-bold hover:text-sky-800">infini-cloud.net ↗</a>（邮箱验证）<br/>
                      2. 登录后 <b>My Page</b> 最底 → 勾选 <b>Turn on Apps Connection</b><br/>
                      3. 顶栏 <b>Apps</b> → 复制 <b>WebDAV URL</b> / <b>Connection ID</b> / <b>Apps Password</b><br/>
                      4. 用户名填 <b>Connection ID</b>（不是邮箱），密码填 <b>Apps Password</b>
                  </p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[10px] text-amber-800 leading-relaxed">
                      <b>⚠️ Apps Password ≠ 登录密码</b><br/>
                      <b>Apps Password</b> 是 <b>Apps</b> 页面里显示在 <b>WebDAV URL</b>、<b>Connection ID</b> <b>下方</b>的一串<b>可复制</b>的应用专用密码，往下滚就能看到。直接把它复制粘贴到上面的"密码"框即可，用账号登录密码会 401。
                  </p>
              </div>
              <div>
                  <label className="text-[11px] text-slate-500 font-medium mb-1 block">WebDAV 地址</label>
                  <input type="url" value={cbUrl} onChange={(e) => setCbUrl(e.target.value)} placeholder="https://xxx.infini-cloud.net/dav/" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                  <div>
                      <label className="text-[11px] text-slate-500 font-medium mb-1 block">用户名</label>
                      <input type="text" value={cbUsername} onChange={(e) => setCbUsername(e.target.value)} placeholder="邮箱或用户名" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none" />
                  </div>
                  <div>
                      <label className="text-[11px] text-slate-500 font-medium mb-1 block">密码</label>
                      <input type="password" value={cbPassword} onChange={(e) => setCbPassword(e.target.value)} placeholder="应用专用密码" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none" />
                  </div>
              </div>
              <div>
                  <label className="text-[11px] text-slate-500 font-medium mb-1 block">备份目录</label>
                  <input type="text" value={cbPath} onChange={(e) => setCbPath(e.target.value)} placeholder="/SullyBackup/" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none" />
              </div>
              <button onClick={handleTestCloudConnection} disabled={cloudTesting || !cbUrl || !cbUsername || !cbPassword} className="w-full py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 disabled:opacity-40">
                  {cloudTesting ? '测试中...' : '测试连接'}
              </button>
              {cloudTestResult && (
                  <p className={`text-[11px] text-center font-medium ${cloudTestResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{cloudTestResult}</p>
              )}
              <div className="grid grid-cols-2 gap-3 pt-2">
                  <button onClick={() => setShowCloudModal(false)} className="py-2.5 bg-slate-100 rounded-xl text-xs font-bold text-slate-500">取消</button>
                  <button onClick={handleSaveCloudConfig} disabled={!cbUrl || !cbUsername || !cbPassword} className="py-2.5 bg-sky-500 rounded-xl text-xs font-bold text-white disabled:opacity-40">保存配置</button>
              </div>
              {cloudBackupConfig.enabled && (
                  <button onClick={() => { trackEvent('关闭云端备份', { provider: cloudBackupConfig.provider === 'github' ? 'github' : 'webdav' }); updateCloudBackupConfig({ enabled: false }); setShowCloudModal(false); addToast('云端备份已关闭', 'info'); }} className="w-full py-2 text-[11px] text-red-400 font-medium">关闭云端备份</button>
              )}
          </div>
      </Modal>

      {/* GitHub Backup Modal — minimum-input flow: paste a token, we figure
          out owner via /user and auto-create a private 'sully-backup' repo. */}
      <ClayDialog isOpen={showGithubModal} title="GitHub 备份" onClose={() => setShowGithubModal(false)} footer={
                  <button
                  onClick={handleTestGithub}
                  disabled={ghTesting || !ghToken.trim()}
                  className="h-12 w-full text-xs font-semibold disabled:opacity-40"
                  style={{ background: F.textPrimary, color: F.surfaceRaised, borderRadius: R.button, boxShadow: S.raisedSoft }}
              >
                  {ghTesting ? '连接中...' : '③ 测试并连接'}
              </button>
              }>
          <div className="space-y-4 p-1">
              <div className="p-3" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken }}>
                  <p className="text-xs leading-relaxed" style={{ color: F.textSecondary }}>
                      <b>三步连接：</b><br/>
                      ① 点下面按钮跳到 GitHub 创建 Token<br/>
                      ② 复制 token，回来粘到下面框里<br/>
                      ③ 点 <b>测试并连接</b>，自动建立私有仓库 <code>{ghRepo || 'sully-backup'}</code>
                  </p>
              </div>

              <div className="p-3" style={{ background: F.surfaceWarm, borderRadius: R.input }}>
                  <p className="text-xs leading-relaxed" style={{ color: F.textSecondary }}>
                      <b>在 GitHub 那一页：</b><br/>
                      把 <b>Expiration</b>(有效期)下拉框 <b>从 90天 改成 No expiration</b>（永不过期）。
                      不改的话 90 天后 token 过期，备份会突然 401。<br/>
                      其它都别动 —— Note 已经填好「Sully 备份」，<b>repo</b> 权限已经勾上了，
                      直接拉到最底点绿色 <b>Generate token</b> 即可。
                  </p>
              </div>

              <a
                  href="https://github.com/settings/tokens/new?scopes=repo&description=Sully%20%E5%A4%87%E4%BB%BD"
                  target="_blank" rel="noopener noreferrer"
                  onClick={() => trackEvent('跳去 GitHub 创建 Token')}
                  className="flex min-h-11 w-full items-center justify-center text-xs font-semibold"
                  style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary, borderRadius: R.button, boxShadow: S.raisedSoft }}
              >
                  ① 去 GitHub 创建 Token ↗
              </a>

              <div>
                  <label htmlFor="github-backup-token" className="mb-1 block text-xs font-medium" style={{ color: F.textSecondary }}>② Personal Access Token</label>
                  <input
                      type="password"
                      id="github-backup-token"
                      value={ghToken}
                      onChange={(e) => setGhToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-3 text-xs font-mono outline-none focus:outline focus:outline-1"
                      style={{ background: F.surfaceSunken, color: F.textPrimary, borderRadius: R.input, boxShadow: S.sunken, outlineColor: F.accent }}
                  />
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: F.textTertiary }}>
                      默认直接把 Token 交给 GitHub 验证；如果开启下面的中转，Token 和备份内容也会经过所选中转服务。
                  </p>
              </div>

              {/* [EM-START: github-backup-status] */}
              <GithubBackupRoute enabled={ghUseProxy} workerUrl={getProxyWorkerUrl()} disabled={ghTesting} onChange={handleGithubProxyToggle} />
              {/* [EM-END: github-backup-status] */}
              {ghTestResult && (
                  <p role="status" className="text-center text-xs font-medium" style={{ color: ghTestResult.startsWith('✓') ? STATUS.success.ink : STATUS.danger.ink }}>
                      {ghTestResult}
                  </p>
              )}
              {ghTestResult.startsWith('✓') && cloudBackupConfig.githubOwner && (
                  <div className="space-y-1.5 p-3" style={{ background: F.surfaceSunken, borderRadius: R.input, color: F.textSecondary, boxShadow: S.sunken }}>
                      <p className="text-xs font-medium">
                          备份会上传到这里：
                      </p>
                      <a
                          href={`https://github.com/${cloudBackupConfig.githubOwner}/${cloudBackupConfig.githubRepo || 'sully-backup'}/releases`}
                          target="_blank" rel="noopener noreferrer"
                          className="block break-all text-xs font-mono underline"
                      >
                          github.com/{cloudBackupConfig.githubOwner}/{cloudBackupConfig.githubRepo || 'sully-backup'}/releases ↗
                      </a>
                      <p className="text-xs leading-relaxed">
                          每次备份会创建一个新的 release（带时间戳）。想看 / 删除旧备份就去这个网址。
                      </p>
                  </div>
              )}

              <button
                  onClick={() => { if (!ghShowAdvanced) trackEvent('展开 GitHub 高级选项'); setGhShowAdvanced(v => !v); }}
                  className="min-h-11 w-full text-xs underline-offset-2 hover:underline"
                  style={{ color: F.textSecondary }}
              >
                  {ghShowAdvanced ? '收起高级选项 ▲' : '高级选项 ▼'}
              </button>
              {ghShowAdvanced && (
                  <div className="space-y-3 p-3" style={{ background: F.surfaceWarm, borderRadius: R.input }}>
                      <div>
                          <label htmlFor="github-backup-repo" className="mb-1 block text-xs font-medium" style={{ color: F.textSecondary }}>备份仓库名</label>
                          <input
                              type="text"
                              id="github-backup-repo"
                              value={ghRepo}
                              onChange={(e) => setGhRepo(e.target.value)}
                              placeholder="sully-backup"
                              className="w-full px-3 py-3 text-xs font-mono outline-none focus:outline focus:outline-1"
                              style={{ background: F.surfaceSunken, color: F.textPrimary, borderRadius: R.input, boxShadow: S.sunken, outlineColor: F.accent }}
                          />
                          <p className="mt-1 text-xs" style={{ color: F.textTertiary }}>不存在会自动创建为私有仓库。</p>
                      </div>
                  </div>
              )}

              {cloudBackupConfig.enabled && cloudBackupConfig.provider === 'github' && (
                  <button onClick={handleDisableCloud} className="min-h-11 w-full text-xs font-semibold" style={{ background: F.surface, color: F.textSecondary, borderRadius: R.button, boxShadow: S.raisedSoft }}>断开 GitHub</button>
              )}
          </div>
      </ClayDialog>

      {/* [EM-START: cloud-backup-status-clay] */}
      <ClayDialog isOpen={showCloudRestoreModal} title="从云端恢复" onClose={() => { cloudBackupListVersion.current++; setShowCloudRestoreModal(false); }}>
          <CloudBackupRestoreList
              state={cloudBackupListState}
              error={cloudBackupListError}
              files={cloudBackupFiles}
              onRetry={() => void handleOpenCloudRestore()}
              onRestore={(file) => void handleCloudRestore(file)}
              githubReleasesUrl={cloudBackupConfig.provider === 'github' && cloudBackupConfig.githubOwner
                  ? `https://github.com/${encodeURIComponent(cloudBackupConfig.githubOwner)}/${encodeURIComponent(cloudBackupConfig.githubRepo || 'sully-backup')}/releases` : undefined}
          />
      </ClayDialog>
      {/* [EM-END: cloud-backup-status-clay] */}

      {/* 模型选择 Modal */}
      <Modal isOpen={showModelModal} title="选择模型" onClose={() => setShowModelModal(false)}>
        {(() => {
            const { filtered, commonPrefix } = modelPickerView;
            return (
                <div className="space-y-3 p-1">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={localModel}
                            onChange={(e) => setLocalModel(e.target.value)}
                            placeholder="手动输入模型名称..."
                            className="flex-1 bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-primary focus:bg-white transition-all"
                        />
                        <button
                            onClick={() => setShowModelModal(false)}
                            className="px-4 py-2.5 bg-primary text-white text-sm font-bold rounded-xl active:scale-95 transition-all"
                        >
                            确定
                        </button>
                    </div>
                    {availableModels.length > 0 && (
                        <div className="relative">
                            <input
                                type="text"
                                value={modelFilter}
                                onChange={(e) => setModelFilter(e.target.value)}
                                placeholder={`🔍 搜索 ${availableModels.length} 个模型...`}
                                className="w-full bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-2 text-xs focus:outline-primary focus:bg-white transition-all"
                            />
                            {modelFilter && (
                                <button
                                    onClick={() => setModelFilter('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs px-2"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    )}
                    {commonPrefix && (
                        <div className="text-[10px] text-slate-400 px-1 flex items-center gap-1 flex-wrap">
                            <span>共同前缀:</span>
                            <code className="font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded break-all">{commonPrefix}</code>
                            <span className="text-slate-300">(下方已弱化显示)</span>
                        </div>
                    )}
                    <div className="max-h-[40vh] overflow-y-auto no-scrollbar space-y-2">
                        {filtered.length > 0 ? filtered.map(m => {
                            const suffix = commonPrefix && m.startsWith(commonPrefix) ? m.slice(commonPrefix.length) : m;
                            const selected = m === localModel;
                            return (
                                <button
                                    key={m}
                                    onClick={() => { setLocalModel(m); setShowModelModal(false); }}
                                    title={m}
                                    className={`w-full text-left px-4 py-3 rounded-xl text-sm font-mono flex justify-between items-start gap-2 ${selected ? 'bg-primary/10 text-primary font-bold ring-1 ring-primary/20' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                                >
                                    <span className="break-all min-w-0 flex-1 leading-relaxed">
                                        {commonPrefix && suffix !== m && (
                                            <span className={selected ? 'text-primary/40 font-normal' : 'text-slate-400 font-normal'}>{commonPrefix}</span>
                                        )}
                                        <span>{suffix}</span>
                                    </span>
                                    {selected && <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0"></div>}
                                </button>
                            );
                        }) : (
                            <div className="text-center text-slate-400 py-8 text-xs">
                                {availableModels.length === 0
                                    ? '列表为空，可手动输入或点击"刷新模型列表"拉取'
                                    : `没有匹配 "${modelFilter}" 的模型`}
                            </div>
                        )}
                    </div>
                </div>
            );
        })()}
      </Modal>

      {/* 识图 API 使用独立模型列表，避免覆盖主 API 的模型选择。 */}
      <Modal isOpen={showVisionModelModal} title="选择识图模型" onClose={() => setShowVisionModelModal(false)}>
        {(() => {
            const { filtered, commonPrefix } = visionModelPickerView;
            return (
                <div className="space-y-3 p-1">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={localVisionModel}
                            onChange={(event) => {
                                setLocalVisionModel(event.target.value);
                                setSelectedVisionPresetId(null);
                                setVisionTestResult(null);
                            }}
                            placeholder="手动输入视觉模型名称..."
                            className="flex-1 min-w-0 bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-violet-500 focus:bg-white transition-all"
                        />
                        <button
                            onClick={() => setShowVisionModelModal(false)}
                            className="px-4 py-2.5 bg-violet-500 text-white text-sm font-bold rounded-xl active:scale-95 transition-all"
                        >
                            确定
                        </button>
                    </div>
                    {availableVisionModels.length > 0 && (
                        <div className="relative">
                            <input
                                type="text"
                                value={visionModelFilter}
                                onChange={(event) => setVisionModelFilter(event.target.value)}
                                placeholder={`🔍 搜索 ${availableVisionModels.length} 个识图模型...`}
                                className="w-full bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-2 text-xs focus:outline-violet-500 focus:bg-white transition-all"
                            />
                            {visionModelFilter && (
                                <button
                                    onClick={() => setVisionModelFilter('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs px-2"
                                >×</button>
                            )}
                        </div>
                    )}
                    {commonPrefix && (
                        <div className="text-[10px] text-slate-400 px-1 flex items-center gap-1 flex-wrap">
                            <span>共同前缀:</span>
                            <code className="font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded break-all">{commonPrefix}</code>
                            <span className="text-slate-300">(下方已弱化显示)</span>
                        </div>
                    )}
                    <div className="max-h-[40vh] overflow-y-auto no-scrollbar space-y-2">
                        {filtered.length > 0 ? filtered.map(model => {
                            const suffix = commonPrefix && model.startsWith(commonPrefix) ? model.slice(commonPrefix.length) : model;
                            const selected = model === localVisionModel;
                            return (
                                <button
                                    key={model}
                                    onClick={() => {
                                        setLocalVisionModel(model);
                                        setSelectedVisionPresetId(null);
                                        setVisionTestResult(null);
                                        setShowVisionModelModal(false);
                                    }}
                                    title={model}
                                    className={`w-full text-left px-4 py-3 rounded-xl text-sm font-mono flex justify-between items-start gap-2 ${selected ? 'bg-violet-100 text-violet-700 font-bold ring-1 ring-violet-200' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                                >
                                    <span className="break-all min-w-0 flex-1 leading-relaxed">
                                        {commonPrefix && suffix !== model && (
                                            <span className={selected ? 'text-violet-400 font-normal' : 'text-slate-400 font-normal'}>{commonPrefix}</span>
                                        )}
                                        <span>{suffix}</span>
                                    </span>
                                    {selected && <div className="w-2 h-2 rounded-full bg-violet-500 mt-1.5 shrink-0" />}
                                </button>
                            );
                        }) : (
                            <div className="text-center text-slate-400 py-8 text-xs">
                                {availableVisionModels.length === 0
                                    ? '列表为空，可手动输入或点击“刷新模型列表”拉取'
                                    : `没有匹配 "${visionModelFilter}" 的模型`}
                            </div>
                        )}
                    </div>
                </div>
            );
        })()}
      </Modal>

      {/* 生图 API 使用自己的模型列表，不会切换聊天或识图模型。 */}
      <Modal isOpen={showImageModelModal} title="选择生图模型" onClose={() => setShowImageModelModal(false)}>
        {(() => {
            const { filtered, commonPrefix } = imageModelPickerView;
            return (
                <div className="space-y-3 p-1">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={localImageModel}
                            onChange={event => setLocalImageModel(event.target.value)}
                            placeholder="手动输入生图模型名称..."
                            className="min-w-0 flex-1 px-4 py-2.5 text-sm font-mono outline-none"
                            style={{
                                borderRadius: R.input,
                                color: F.textPrimary,
                                background: F.surfaceRaised,
                                border: `1px solid ${F.borderSoft}`,
                                boxShadow: S.sunken,
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowImageModelModal(false)}
                            className="px-4 py-2.5 text-sm font-bold active:scale-95 transition-transform"
                            style={{ borderRadius: R.button, color: F.surfaceRaised, background: HUE.rose.main }}
                        >
                            确定
                        </button>
                    </div>
                    {availableImageModels.length > 0 && (
                        <div className="relative">
                            <input
                                type="text"
                                value={imageModelFilter}
                                onChange={event => setImageModelFilter(event.target.value)}
                                placeholder={`搜索 ${availableImageModels.length} 个生图模型...`}
                                className="w-full px-4 py-2 text-xs outline-none"
                                style={{ borderRadius: R.input, color: F.textSecondary, background: F.surfaceWarm, border: `1px solid ${F.borderSoft}` }}
                            />
                            {imageModelFilter && (
                                <button
                                    type="button"
                                    onClick={() => setImageModelFilter('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 px-2 text-xs"
                                    style={{ color: F.textTertiary }}
                                >×</button>
                            )}
                        </div>
                    )}
                    {commonPrefix && (
                        <div className="flex flex-wrap items-center gap-1 px-1 text-[10px]" style={{ color: F.textTertiary }}>
                            <span>共同前缀:</span>
                            <code className="break-all px-1.5 py-0.5 font-mono" style={{ borderRadius: R.tiny, background: F.surfaceSunken }}>{commonPrefix}</code>
                        </div>
                    )}
                    <div className="max-h-[40vh] space-y-2 overflow-y-auto no-scrollbar">
                        {filtered.length > 0 ? filtered.map(model => {
                            const suffix = commonPrefix && model.startsWith(commonPrefix) ? model.slice(commonPrefix.length) : model;
                            const selected = model === localImageModel;
                            return (
                                <button
                                    key={model}
                                    type="button"
                                    onClick={() => { setLocalImageModel(model); setShowImageModelModal(false); }}
                                    title={model}
                                    className="flex w-full items-start justify-between gap-2 px-4 py-3 text-left text-sm font-mono"
                                    style={{
                                        borderRadius: R.medium,
                                        color: selected ? HUE.rose.ink : F.textSecondary,
                                        background: selected ? HUE.rose.tint : F.surfaceWarm,
                                        border: `1px solid ${selected ? HUE.rose.soft : F.borderSoft}`,
                                    }}
                                >
                                    <span className="min-w-0 flex-1 break-all leading-relaxed">
                                        {commonPrefix && suffix !== model && <span style={{ color: F.textTertiary }}>{commonPrefix}</span>}
                                        <span>{suffix}</span>
                                    </span>
                                    {selected && <span className="mt-1.5 h-2 w-2 shrink-0" style={{ borderRadius: R.pill, background: HUE.rose.main }} />}
                                </button>
                            );
                        }) : (
                            <div className="py-8 text-center text-xs" style={{ color: F.textTertiary }}>
                                {availableImageModels.length === 0
                                    ? '列表为空，可手动输入或点击“刷新模型列表”拉取'
                                    : `没有匹配 “${imageModelFilter}” 的模型`}
                            </div>
                        )}
                    </div>
                </div>
            );
        })()}
      </Modal>

      {/* API 调用记录页面 */}
      <ApiCallLogModal isOpen={showApiCallLog} onClose={() => setShowApiCallLog(false)} />

      {/* [EM-START: settings-subpages-f] 新建 / 编辑预设：F 雾面 sheet，主色蓝；删除从长按 × 挪进编辑里 */}
      <ClayDialog isOpen={showPresetModal} title="新建预设" onClose={() => setShowPresetModal(false)}
          footer={<button type="button" onClick={handleSavePreset} className="w-full clay-press"
              style={{ height: 46, borderRadius: R.button, border: 'none', background: HUE.blue.main, color: F.surface, fontSize: 15, fontWeight: 600 }}>新建</button>}>
          <label className="block space-y-2 text-xs">
              <span style={{ color: F.textSecondary }}>预设名称（比如 DeepSeek）</span>
              <input value={newPresetName} onChange={e => setNewPresetName(e.target.value)} autoComplete="off" placeholder="名称"
                  className="w-full min-h-11 px-3 py-2 text-sm outline-none" style={{ borderRadius: R.input, background: OVERLAY.well, color: F.textPrimary }} />
          </label>
          <p className="mt-3 text-xs leading-relaxed" style={{ color: F.textSecondary }}>会把「当前配置」里的地址、Key、模型和高级设置一起存进去。</p>
      </ClayDialog>

      <ClayDialog isOpen={!!editingPresetId} title="编辑预设" onClose={() => setEditingPresetId(null)}
          footer={<button type="button" onClick={handleUpdatePreset} className="w-full clay-press"
              style={{ height: 46, borderRadius: R.button, border: 'none', background: HUE.blue.main, color: F.surface, fontSize: 15, fontWeight: 600 }}>保存预设</button>}>
          <div className="space-y-4" style={{ color: F.textPrimary }}>
              {[
                  { label: '名称', value: editPresetName, set: setEditPresetName, type: 'text', placeholder: '预设名称' },
                  { label: 'URL', value: editPresetUrl, set: setEditPresetUrl, type: 'text', placeholder: 'https://...' },
                  { label: 'Key', value: editPresetKey, set: setEditPresetKey, type: 'password', placeholder: 'API Key' },
                  { label: 'Model', value: editPresetModel, set: setEditPresetModel, type: 'text', placeholder: '模型名称' },
              ].map(field => <label key={field.label} className="block space-y-2 text-xs">
                  <span style={{ color: F.textSecondary }}>{field.label}</span>
                  <input aria-label={`预设${field.label}`} type={field.type} value={field.value}
                      onChange={event => field.set(event.target.value)} placeholder={field.placeholder}
                      autoComplete="off" className="w-full min-h-11 px-3 py-2 text-sm outline-none"
                      style={{ borderRadius: R.input, background: OVERLAY.well, color: F.textPrimary }} />
              </label>)}
              {/* [EM-START: api-preset-group] */}
              <label className="block space-y-2 text-xs">
                  <span style={{ color: F.textSecondary }}>分组（可不填，比如中转站的名字）</span>
                  <input aria-label="预设分组" type="text" value={editPresetGroup} list="api-preset-groups"
                      onChange={event => setEditPresetGroup(event.target.value)} placeholder="不分组"
                      autoComplete="off" className="w-full min-h-11 px-3 py-2 text-sm outline-none"
                      style={{ borderRadius: R.input, background: OVERLAY.well, color: F.textPrimary }} />
                  <datalist id="api-preset-groups">
                      {listPresetGroups(apiPresets).map(group => <option key={group} value={group} />)}
                  </datalist>
              </label>
              {/* [EM-END: api-preset-group] */}
              <div className="space-y-3 p-4" style={{ background: OVERLAY.well, borderRadius: R.smallCard }}>
                  <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">流式输出</span>
                      <button type="button" role="switch" aria-label="预设流式输出" aria-checked={editPresetStream}
                          onClick={() => setEditPresetStream(value => !value)} className="relative shrink-0"
                          style={{ width: 48, height: 28, borderRadius: R.pill, border: 'none', padding: 0, background: editPresetStream ? HUE.blue.main : F.borderStrong }}>
                          <span className="absolute" style={{ top: 3, left: editPresetStream ? 23 : 3, width: 22, height: 22, borderRadius: R.pill, background: F.surface, transition: 'left 180ms' }} />
                      </button>
                  </div>
                  <label className="block space-y-2 text-sm" htmlFor="edit-preset-temperature">
                      <span className="flex justify-between">温度 <span style={{ color: F.textTertiary, fontVariantNumeric: 'tabular-nums' }}>{editPresetTemperature.toFixed(2)}</span></span>
                      <input id="edit-preset-temperature" type="range" min="0" max="2" step="0.05"
                          value={editPresetTemperature} onChange={event => setEditPresetTemperature(parseFloat(event.target.value))}
                          className="w-full h-11" style={{ accentColor: HUE.blue.main }} />
                  </label>
              </div>
              <div className="flex flex-col">
                  <button type="button" onClick={() => {
                      setEditPresetUrl(localUrl); setEditPresetKey(localKey); setEditPresetModel(localModel);
                      setEditPresetStream(localStream); setEditPresetTemperature(localTemperature);
                      addToast('已填入当前配置', 'info');
                  }} className="text-left active:opacity-40" style={{ minHeight: 44, background: 'transparent', border: 'none', color: HUE.blue.main, fontSize: 15, fontWeight: 500 }}>
                      用当前完整配置填入
                  </button>
                  <button type="button" onClick={() => { const preset = apiPresets.find(item => item.id === editingPresetId); if (preset) deleteApiPreset(preset.id, preset.name); }}
                      className="text-left active:opacity-40" style={{ minHeight: 44, background: 'transparent', border: 'none', color: STATUS.danger.ink, fontSize: 15, fontWeight: 500 }}>
                      删除这个预设
                  </button>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: F.textSecondary }}>
                  {editingPresetId && activePresetId === editingPresetId
                      ? '这条正在使用中，保存后当前配置会一起更新。'
                      : '保存到这条预设。需要使用时，再点预设名称切换。'}
              </p>
          </div>
      </ClayDialog>
      {/* [EM-END: settings-subpages-f] */}


      {/* 强制导出 Modal */}
      <Modal isOpen={showExportModal} title="备份下载" onClose={() => { revokeDownloadUrl(); setShowExportModal(false); }} footer={
          <div className="flex gap-2 w-full">
               <button onClick={() => { revokeDownloadUrl(); setShowExportModal(false); }} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">关闭</button>
          </div>
      }>
          <div className="space-y-4 text-center py-4">
              <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
              </div>
              <p className="text-sm font-bold text-slate-700">备份文件已生成！</p>
              <p className="text-xs text-slate-500">如果浏览器没有自动下载，请点击下方链接。</p>
              {downloadUrl && <a href={downloadUrl} download={downloadFileName} className="text-primary text-sm underline block py-2">点击手动下载 .zip</a>}
          </div>
      </Modal>

      {/* MCP 工具服务器配置 Modal（高级玩法, 从实时感知里独立出来） */}
      <SettingsSheet inline={onPage('mcp')} isOpen={showMcpModal} title="MCP 工具服务器" onClose={() => { setShowMcpModal(false); flushMcpToolConfigSync(); }}> {/* [EM: settings-inline-config] */}
          <div className="space-y-4">
              <McpServersCard addToast={addToast} onMcpConfigChanged={() => {
                  // MCP 配置变更只需重传 tool_config：提示词块与 tools 数组由 worker 在 fire 时
                  // 从 tool_config 现场生成（见 mcpFireCore），不经过 fire_pack，没有陈旧问题，
                  // 所以不用像实时感知那样连提示词一起刷（syncAmsgToolConfigAndPrompts）。
                  // 这一份尤其不能传丢：删掉的服务器要是没同步上去，worker 半夜还会带着
                  // 旧 token 去直连它。重试和底账由 syncAmsgToolConfig 负责。
                  scheduleMcpToolConfigSync(() => syncAmsgToolConfig(realtimeConfig));
              }} />
          </div>
      </SettingsSheet>

      {/* MCP 帮助 Modal —— 面向完全不懂 MCP 的用户, 讲清"是什么/为什么要自备服务器/三条路" */}
      <Modal isOpen={showMcpHelp} title="MCP 是什么？" onClose={() => setShowMcpHelp(false)}>
          <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
              <div className="bg-violet-50/60 rounded-xl p-3 space-y-1.5">
                  <p className="font-bold text-violet-700">🔌 给 AI 用的通用工具接口</p>
                  <p>
                      MCP（Model Context Protocol）是一套开放协议，相当于给角色开了个「外接技能插槽」：
                      任何按这个标准做的工具服务器——记忆库、联网搜索、笔记、智能家居——插上就能用，
                      角色会在聊天里自己决定什么时候调用。
                  </p>
              </div>
              <div className="bg-sky-50/60 rounded-xl p-3 space-y-1.5">
                  <p className="font-bold text-sky-700">🏠 为什么服务器要自己准备？</p>
                  <p>
                      本应用是<b>纯静态网页</b>——没有自己的后端服务器，所有请求都由你的浏览器直接发出，
                      数据也全存在你本机。好处是隐私和自由都在你手里；代价是工具服务器没人替你跑，
                      需要你自己准备，三选一：
                  </p>
                  <p>
                      ☁️ <b>用现成的云端 MCP 服务</b>：对方给你一个公网 https 地址（可能还有 Token），直接填进配置即可。<br/>
                      🖥️ <b>跑在自己电脑上</b>：电脑上的浏览器直接填 <code className="bg-white/80 px-1 rounded">http://localhost:端口</code>；
                      想在手机上也能用，再配个内网穿透（如 Cloudflare Tunnel）。<br/>
                      🚀 <b>自己部署到云上</b>：VPS / Cloudflare / Zeabur 等，任何设备随时可用。
                  </p>
              </div>
              <div className="bg-amber-50/60 rounded-xl p-3 space-y-1.5">
                  <p className="font-bold text-amber-700">🚧 测试连接报「Failed to fetch」？</p>
                  <p>
                      八成是浏览器的 CORS 跨域拦截（静态网页的另一个代价）。能改服务器就在服务器端配好 CORS；
                      改不了就在配置里填「代理 URL」——本地跑一个小代理，或把仓库里的 Worker 代理部署到你自己的
                      Cloudflare 账号，教程里都有现成步骤。
                  </p>
              </div>
              <div className="space-y-2">
                  <a
                      href={MCP_USER_GUIDE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackEvent('跳转 MCP 完整教程')}
                      className="block w-full py-2.5 bg-violet-500 text-white text-center text-xs font-bold rounded-xl active:scale-95 transition-transform"
                  >📖 打开完整教程（含部署示例）</a>
                  <button
                      type="button"
                      onClick={async () => {
                          const text = `请阅读这份教程，然后一步一步教我把 MCP 工具服务器接入 SullyOS。先问清楚我想接什么工具、准备部署在哪（云端/本地电脑/本地+内网穿透），再给对应路线的步骤：\n${MCP_USER_GUIDE_URL}`;
                          try { await navigator.clipboard.writeText(text); trackEvent('复制 MCP 部署指引给 AI', { result: 'copied' }); addToast('已复制，去粘贴给你的 AI 吧', 'success'); }
                          catch { trackEvent('复制 MCP 部署指引给 AI', { result: 'clipboard-failed' }); addToast('复制失败，请手动复制教程链接', 'error'); }
                      }}
                      className="w-full py-2.5 bg-violet-100 text-violet-700 text-xs font-bold rounded-xl active:scale-95 transition-transform"
                  >🤖 复制链接给你的 AI，让它带你部署</button>
                  <p className="text-[10px] text-slate-400 text-center">教程是自包含的，任何 AI 助手读完都能带你走完全程。</p>
              </div>
          </div>
      </Modal>

      {/* 确认重置 Modal */}
      <Modal
          isOpen={showResetConfirm}
          title="系统警告"
          onClose={() => setShowResetConfirm(false)}
          footer={
              <div className="flex gap-2 w-full">
                  <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">取消</button>
                  <button onClick={confirmReset} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200">确认格式化</button>
              </div>
          }
      >
          <div className="flex flex-col items-center gap-3 py-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-red-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
              <p className="text-center text-sm text-slate-600 font-medium">
                  这将<span className="text-red-500 font-bold">永久删除</span>所有角色、聊天记录和设置，且无法恢复！
              </p>
          </div>
      </Modal>

      <InstantPushSettingsModal
        open={showInstantModal}
        onClose={() => setShowInstantModal(false)}
        onOpenVapid={() => { setShowInstantModal(false); setShowVapidModal(true); }}
      />
      <PushVapidSettingsModal
        open={showVapidModal}
        onClose={() => { setShowVapidModal(false); setVapidReadyTick((n) => n + 1); }}
      />
      <ActiveMsgGlobalSettingsModal
        isOpen={showAmsg2Modal || onPage('amsg')} // [EM: settings-inline-config]
        inline={onPage('amsg')} // [EM: settings-inline-config]
        onClose={() => setShowAmsg2Modal(false)}
        addToast={addToast}
        realtimeConfig={realtimeConfig}
        onOpenVapid={() => { setShowAmsg2Modal(false); setShowVapidModal(true); }}
      />

      {showCommunityMigration && (
        <LoyalUserRecruitmentController onClose={() => setShowCommunityMigration(false)} />
      )}

    </div>
    </SettingsInlineSlotContext.Provider>
  );
};

export default Settings;
