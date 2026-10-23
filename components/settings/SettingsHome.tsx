// [EM-START: settings-ios-list]
/**
 * 系统设置首页：苹果式分组列表（2026-10-21 阿萌定，样稿 https://claude.ai/artifact/9ptEF5b6AV45mUnBuMcvbN）。
 *
 * 一行 = 灰底图标格 + 名字 + 右边一句现在的状态 + ›，点进子页；子页内容仍由 apps/Settings.tsx 渲染。
 * 图标格不用彩色（每屏一个主色的规矩），颜色只留给红角标和绿点 / 红点。
 * 这里自己拿的状态：MCP 体检、mini 在不在、存储占用；其余由 Settings 传进来（它本来就有那些 state）。
 */

import React, { useEffect, useState } from 'react';
import {
    Archive, BellSimple, BookOpenText, CaretRight, ClockCountdown, CloudSun, Desktop, Eye, FirstAid, Globe,
    HardDrives, ImageSquare, Info, Key, LinkSimple, ListBullets, NotePencil, Path, PlugsConnected, Vibrate, Waveform,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import TokenImg from '../os/TokenImg';
import { F, FONT, HUE, R, STATUS } from '../../utils/clayTokens';
import { AgentBackend, AgentBackendError, isAgentPaired } from '../../utils/emAgentBackend';
import { checkMcpHealth, getMcpHealth, mcpServersToCheck, subscribeMcpHealth } from '../../utils/emMcpHealth';
import {
    mcpRowValue, miniRowValue, settingsAlerts,
    type McpHealth, type MiniState, type SettingsPageId,
} from '../../utils/emSettingsPages';

/** 设置认领的主色（打勾、文字按钮）。 */
export const SETTINGS_HUE = HUE.blue;

export const SettingsGroup: React.FC<{ title?: string; foot?: React.ReactNode; children: React.ReactNode }> = ({ title, foot, children }) => (
    <div className="flex flex-col" style={{ gap: 6 }}>
        {title && <div className="px-1" style={{ fontSize: 12, color: F.textTertiary, letterSpacing: '.04em' }}>{title}</div>}
        <div className="overflow-hidden" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard }}>
            {children}
        </div>
        {foot && <div className="px-1" style={{ fontSize: 12, lineHeight: '18px', color: F.textTertiary }}>{foot}</div>}
    </div>
);

const Tile: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="shrink-0 flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: R.small, background: F.surfaceSunken }}>
        {children}
    </span>
);

export const StatusDot: React.FC<{ tone: 'ok' | 'bad' }> = ({ tone }) => (
    <span className="shrink-0" style={{ width: 7, height: 7, borderRadius: R.pill, background: tone === 'ok' ? STATUS.success.main : STATUS.danger.main }} />
);

export const SettingsRow: React.FC<{
    icon?: React.ComponentType<any>;
    title: React.ReactNode;
    sub?: React.ReactNode;
    value?: React.ReactNode;
    valueTone?: 'plain' | 'bad';
    dot?: 'ok' | 'bad' | null;
    badge?: number;
    first?: boolean;
    chevron?: boolean;
    titleColor?: string;
    onClick?: () => void;
}> = ({ icon: Icon, title, sub, value, valueTone = 'plain', dot, badge, first, chevron = true, titleColor, onClick }) => (
    <button type="button" onClick={onClick}
        className="relative w-full flex items-center text-left active:opacity-60 transition-opacity"
        style={{ minHeight: 56, padding: Icon ? '8px 12px' : '8px 12px 8px 14px', gap: 12, background: 'transparent', border: 'none' }}>
        {!first && <span aria-hidden className="absolute top-0 right-0" style={{ left: Icon ? 56 : 14, height: 1, background: F.divider }} />}
        {Icon && <Tile><Icon size={18} weight="bold" color={F.textPrimary} /></Tile>}
        <span className="flex-1 min-w-0" style={{ fontSize: 15, lineHeight: '21px', color: titleColor || F.textPrimary }}>
            {title}
            {sub && <span className="block" style={{ fontSize: 12, lineHeight: '17px', color: F.textTertiary, marginTop: 1 }}>{sub}</span>}
        </span>
        {(value || dot) && (
            <span className="shrink-0 inline-flex items-center whitespace-nowrap" style={{ gap: 6, fontSize: 14, color: valueTone === 'bad' ? STATUS.danger.ink : F.textTertiary, fontVariantNumeric: 'tabular-nums' }}>
                {dot && <StatusDot tone={dot} />}
                {value}
            </span>
        )}
        {badge ? (
            <span className="shrink-0 inline-flex items-center justify-center" style={{ minWidth: 22, height: 22, padding: '0 7px', borderRadius: R.pill, background: STATUS.danger.main, color: F.surface, fontSize: 12, fontWeight: 600 }}>{badge}</span>
        ) : null}
        {chevron && <CaretRight size={14} weight="bold" color={F.borderStrong} className="shrink-0" />}
    </button>
);

/** 顶上那张大一点的状态卡（Product tint 底恒定），子页里用。 */
export const SettingsHero: React.FC<{ title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode }> = ({ title, sub, action }) => (
    <div className="flex flex-col" style={{ background: SETTINGS_HUE.tint, borderRadius: R.bigCard, padding: 16, gap: 4 }}>
        <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600, color: SETTINGS_HUE.ink, fontVariantNumeric: 'tabular-nums' }}>{title}</div>
        {sub && <div style={{ fontSize: 13, lineHeight: '18px', color: F.textSecondary }}>{sub}</div>}
        {action && <div className="flex justify-end">{action}</div>}
    </div>
);

export const SettingsTextButton: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ onClick, disabled, children }) => (
    <button type="button" onClick={onClick} disabled={disabled}
        className="inline-flex items-center active:opacity-40 transition-opacity disabled:opacity-40"
        style={{ minHeight: 44, padding: '0 4px', background: 'transparent', border: 'none', color: SETTINGS_HUE.main, fontSize: 15, fontWeight: 500 }}>
        {children}
    </button>
);

export interface SettingsHomeValues {
    mainApi: string;
    vision: string;
    image: string;
    voice: string;
    realtime: string;
    diary: string;
    xhs: string;
    proxy: string;
    backup: string;
    amsg: string;
    push: string;
    version: string;
    staleBackupDays: number | null;
    instantPushOn: boolean;
}

const useMcpHealth = () => {
    const [state, setState] = useState(getMcpHealth);
    useEffect(() => {
        const off = subscribeMcpHealth((health, checking) => setState({ health, checking }));
        void checkMcpHealth();
        return off;
    }, []);
    return state;
};

export const useMiniState = (): MiniState => {
    const [state, setState] = useState<MiniState>(() => (isAgentPaired() ? 'unknown' : 'unpaired'));
    useEffect(() => {
        if (!isAgentPaired()) return;
        let alive = true;
        AgentBackend.status().then(
            () => { if (alive) setState('online'); },
            error => {
                if (!alive) return;
                if (error instanceof AgentBackendError && error.status === 401) setState('revoked');
                else if (error instanceof AgentBackendError && error.code === 'BLOCKED') setState('blocked');
                else setState('resting');
            },
        );
        return () => { alive = false; };
    }, []);
    return state;
};

const useStorageUsage = (): string => {
    const [text, setText] = useState('');
    useEffect(() => {
        let alive = true;
        navigator.storage?.estimate?.().then(e => {
            if (!alive || !e.usage) return;
            const gb = e.usage / 1024 ** 3;
            setText(gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(e.usage / 1024 ** 2))} MB`);
        }).catch(() => {});
        return () => { alive = false; };
    }, []);
    return text;
};

const SettingsHome: React.FC<{
    values: SettingsHomeValues;
    onOpen: (page: SettingsPageId) => void;
    onOpenApiLog: () => void;
}> = ({ values, onOpen, onOpenApiLog }) => {
    const { userProfile } = useOS();
    const { health, checking } = useMcpHealth();
    const mini = useMiniState();
    const storage = useStorageUsage();
    const mcp = mcpRowValue(health as McpHealth | null, mcpServersToCheck().length, checking);
    const miniValue = miniRowValue(mini);
    const alerts = settingsAlerts({ staleBackupDays: values.staleBackupDays, instantPushOn: values.instantPushOn, miniState: mini });

    return (
        <div className="flex flex-col" style={{ gap: 22 }}>
            <SettingsGroup>
                <button type="button" onClick={() => onOpen('profile')}
                    className="w-full flex items-center text-left active:opacity-60 transition-opacity"
                    style={{ minHeight: 76, padding: '12px 12px 12px 14px', gap: 14, background: 'transparent', border: 'none' }}>
                    <span className="shrink-0 overflow-hidden flex items-center justify-center"
                        style={{ width: 52, height: 52, borderRadius: R.pill, background: SETTINGS_HUE.tint, color: SETTINGS_HUE.ink, fontFamily: FONT.heading, fontSize: 22, fontWeight: 700 }}>
                        {userProfile.avatar
                            ? <TokenImg value={userProfile.avatar} className="w-full h-full object-cover" />
                            : (userProfile.name || '我').slice(0, 1)}
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block truncate" style={{ fontSize: 18, lineHeight: '24px', fontWeight: 600, color: F.textPrimary }}>{userProfile.name || '还没起名字'}</span>
                        <span className="block" style={{ fontSize: 13, lineHeight: '18px', color: F.textSecondary }}>头像、名字、关于我</span>
                    </span>
                    <CaretRight size={14} weight="bold" color={F.borderStrong} className="shrink-0" />
                </button>
            </SettingsGroup>

            {alerts.length > 0 && (
                <SettingsGroup>
                    {alerts.map((a, i) => (
                        <SettingsRow key={a.id} first={i === 0} title={a.title} sub={a.detail} badge={1} onClick={() => onOpen(a.page)} />
                    ))}
                </SettingsGroup>
            )}

            <SettingsGroup title="API">
                <SettingsRow first icon={Key} title="主 API" value={values.mainApi} onClick={() => onOpen('api-main')} />
                <SettingsRow icon={Eye} title="识图" value={values.vision} onClick={() => onOpen('api-vision')} />
                <SettingsRow icon={ImageSquare} title="生图" value={values.image} onClick={() => onOpen('api-image')} />
                <SettingsRow icon={ListBullets} title="调用记录" value="最近 5 天" onClick={onOpenApiLog} />
            </SettingsGroup>

            {/* 2026-10-22 结构梳理：按「给角色什么」分——感知是 TA 被动知道的（写进提示词），工具是 TA 能主动去做的 */}
            <SettingsGroup title="角色能感知" foot="写进提示词，TA 只是知道">
                <SettingsRow first icon={CloudSun} title="实时感知" sub="天气、新闻" value={values.realtime} onClick={() => onOpen('realtime')} />
            </SettingsGroup>

            <SettingsGroup title="角色能用的工具" foot="TA 聊着聊着能自己去用">
                <SettingsRow first icon={NotePencil} title="日记同步" sub="Notion" value={values.diary} onClick={() => onOpen('diary-sync')} />
                <SettingsRow icon={BookOpenText} title="小红书" value={values.xhs} onClick={() => onOpen('xhs')} />
                <SettingsRow icon={PlugsConnected} title="MCP 工具" sub="日历提醒、开灯、B 站、自定义" value={mcp.text} valueTone={mcp.bad ? 'bad' : 'plain'} dot={mcp.dot ? (mcp.bad ? 'bad' : 'ok') : null} onClick={() => onOpen('mcp')} />
                <SettingsRow icon={Globe} title="网页抓取" onClick={() => onOpen('web-fetch')} />
            </SettingsGroup>

            <SettingsGroup title="设备与网络">
                <SettingsRow first icon={Vibrate} title="Intiface 硬件" onClick={() => onOpen('intiface')} />
                <SettingsRow icon={Path} title="Worker 代理" value={values.proxy} onClick={() => onOpen('proxy')} />
            </SettingsGroup>

            <SettingsGroup title="备份">
                <SettingsRow first icon={Archive} title="备份与恢复" value={values.backup} valueTone={values.staleBackupDays !== null ? 'bad' : 'plain'} onClick={() => onOpen('backup')} />
                <SettingsRow icon={HardDrives} title="存储空间" value={storage} onClick={() => onOpen('storage')} />
                <SettingsRow icon={LinkSimple} title="外链图片" sub="别人图床上的表情、头像存到本机" onClick={() => onOpen('external-images')} />
            </SettingsGroup>

            <SettingsGroup title="后台">
                <SettingsRow first icon={Desktop} title="Mac mini" value={miniValue.text} dot={miniValue.dot} valueTone={miniValue.dot === 'bad' ? 'bad' : 'plain'} onClick={() => onOpen('mini')} />
                <SettingsRow icon={ClockCountdown} title="主动消息 2.0" value={values.amsg} onClick={() => onOpen('amsg')} />
                <SettingsRow icon={BellSimple} title="推送" value={values.push} onClick={() => onOpen('push')} />
            </SettingsGroup>

            <SettingsGroup title="其他">
                <SettingsRow first icon={Waveform} title="语音与写歌" value={values.voice} onClick={() => onOpen('voice')} />
                <SettingsRow icon={FirstAid} title="外观急救" sub="美化把页面弄坏了，从这里还原" onClick={() => onOpen('appearance')} />
                <SettingsRow icon={Info} title="关于" value={values.version} onClick={() => onOpen('about')} />
            </SettingsGroup>
        </div>
    );
};

export default SettingsHome;
// [EM-END: settings-ios-list]
