// [EM-START: machine-room]
/**
 * MachineRoomApp.tsx — 机房：Mac mini 后端的家。
 *
 * 起因（阿萌 2026-10-20）：跟 mini 有关的东西散在设置页十几处、层层弹窗里，
 * 有几个开关（心跳真不真发、心思试运行）只能在 mini 终端里敲命令改。这里收成一个 App：
 * - 此刻：mini 在不在、心跳在不在真发、各个角色刚才在干嘛、下一跳几点；点角色进详情
 * - 记录：所有角色的心跳流水，能按「发了消息 / 过日子 / 被跳过 / 出错」筛
 * - 连接：推送、日历、小红书、HA 的状态，和那几个开关
 *
 * 配对、解绑留在「设置 → Mac mini」；其余跟 mini 有关的（含推送登记、聊天交给 mini）都在这里。mini 每天 4–7 点休眠，
 * 连不上时安静显示上一次拿到的样子，不弹错。主色 mint，F 规范（全平），取值只从 clayTokens。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, CaretLeft, HardDrives, ListBullets, Plugs, Pulse } from '@phosphor-icons/react';

import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { F, FONT, MOTION, R, S } from '../utils/clayTokens';
import {
    AgentBackend, AgentBackendError, isAgentPaired, probeInternet,
    type AgentAdminSettings, type AgentCharacter, type AgentModelRun, type AgentStatus,
} from '../utils/emAgentBackend';
import { describeReachFailure, type ReachFailure } from '../utils/emMachineRoom'; // [EM: machine-room-reach-reason]
import { Card, Empty, P, PillButton } from '../components/machineRoom/ui';
import NowView from '../components/machineRoom/NowView';
import RunsView from '../components/machineRoom/RunsView';
import LinksView from '../components/machineRoom/LinksView';
import CharacterView from '../components/machineRoom/CharacterView';

type Tab = 'now' | 'runs' | 'links';
const TABS: { id: Tab; label: string; icon: React.FC<any> }[] = [
    { id: 'now', label: '此刻', icon: Pulse },
    { id: 'runs', label: '记录', icon: ListBullets },
    { id: 'links', label: '连接', icon: Plugs },
];

export interface MachineRoomData {
    status: AgentStatus | null;
    characters: AgentCharacter[];
    runs: AgentModelRun[];
    settings: AgentAdminSettings | null;
    credModels: Record<string, string>;
    /** null = 还没问过；false = 连不上（多半在休眠） */
    reachable: boolean | null;
    revoked: boolean;
    /** 连不上时的具体原因；连得上时为 null */
    failure: ReachFailure | null;
    loading: boolean;
    refresh: () => Promise<void>;
}

const IconBtn: React.FC<{ onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }> = ({ onClick, label, children, disabled }) => (
    <button onClick={onClick} aria-label={label} disabled={disabled}
        className="flex items-center justify-center active:opacity-40 transition-opacity disabled:opacity-50"
        style={{ width: 44, height: 44, borderRadius: R.pill, background: 'transparent', border: 'none', boxShadow: 'none' }}>
        {children}
    </button>
);

const useMachineRoomData = (): MachineRoomData => {
    const [status, setStatus] = useState<AgentStatus | null>(null);
    const [characters, setCharacters] = useState<AgentCharacter[]>([]);
    const [runs, setRuns] = useState<AgentModelRun[]>([]);
    const [settings, setSettings] = useState<AgentAdminSettings | null>(null);
    const [credModels, setCredModels] = useState<Record<string, string>>({});
    const [reachable, setReachable] = useState<boolean | null>(null);
    const [revoked, setRevoked] = useState(false);
    const [failure, setFailure] = useState<ReachFailure | null>(null);
    const [loading, setLoading] = useState(false);
    const version = useRef(0);

    const refresh = useCallback(async () => {
        if (!isAgentPaired()) return;
        const mine = ++version.current;
        setLoading(true);
        try {
            const [nextStatus, list, audit, creds, nextSettings] = await Promise.all([
                AgentBackend.status(),
                AgentBackend.characters(),
                AgentBackend.audit(undefined, 80),
                AgentBackend.credentials().catch(() => []),
                // 旧后端没有 /settings：开关那块显示「在 mini 上改」
                AgentBackend.settings().catch(() => null),
            ]);
            if (mine !== version.current) return;
            setStatus(nextStatus);
            setCharacters(list);
            // 按时间排，别信后端的行号顺序（补跑、重跳的那几行 id 跟时间不一定同序）
            setRuns([...audit].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)));
            setCredModels(Object.fromEntries(creds.map(cred => [cred.ref, cred.model])));
            setSettings(nextSettings);
            setReachable(true);
            setRevoked(false);
            setFailure(null);
        } catch (error) {
            if (mine !== version.current) return;
            const agentError = error instanceof AgentBackendError ? error : null;
            // 碰不到 mini 时再对照一下本站通不通，分出「没网」「这张网拦了 mini」「mini 真休息」
            const lost = agentError?.code === 'UNREACHABLE' || agentError?.code === 'TIMEOUT';
            const internetOk = lost ? await probeInternet() : null;
            if (mine !== version.current) return;
            setReachable(false);
            setRevoked(agentError?.status === 401);
            setFailure(describeReachFailure(agentError, internetOk));
        } finally {
            if (mine === version.current) setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);
    // 回到前台时刷一下：心跳一直在跑，放着不动的页面很快就是旧的
    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [refresh]);

    return { status, characters, runs, settings, credModels, reachable, revoked, failure, loading, refresh };
};

const MachineRoomApp: React.FC = () => {
    const { closeApp, openApp, characters } = useOS();
    const data = useMachineRoomData();
    const [tab, setTab] = useState<Tab>('now');
    const [charId, setCharId] = useState<string | null>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const paired = isAgentPaired();

    const openChar = (id: string) => { setCharId(id); scroller.current?.scrollTo({ top: 0 }); };
    const char = useMemo(() => characters.find(item => item.id === charId) ?? null, [characters, charId]);
    const title = char ? char.name : tab === 'now' ? '机房' : tab === 'runs' ? '记录' : '连接';

    const body = !paired ? (
        <div className="flex flex-col" style={{ gap: 12, paddingTop: 24 }}>
            <Empty icon={<HardDrives size={18} weight="bold" color={F.textTertiary} />}>
                还没连上 Mac mini。先在「设置 → Mac mini」里配对，配好了这里就是 mini 的家。
            </Empty>
            <div className="flex justify-center"><PillButton strong onClick={() => openApp(AppID.Settings)}>去设置里配对</PillButton></div>
        </div>
    ) : char ? (
        <CharacterView char={char} data={data} />
    ) : tab === 'now' ? (
        <NowView data={data} onOpenChar={openChar} />
    ) : tab === 'runs' ? (
        <RunsView data={data} onOpenChar={openChar} />
    ) : (
        <LinksView data={data} />
    );

    return (
        <div className="h-full flex flex-col relative" style={{ background: F.appBg }}>
            <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
                <div className="relative flex items-center justify-between" style={{ minHeight: 44, padding: '0 20px' }}>
                    <IconBtn onClick={() => (char ? setCharId(null) : closeApp())} label="返回"><CaretLeft size={22} weight="bold" color={F.textPrimary} /></IconBtn>
                    <span className="absolute left-0 right-0 flex justify-center pointer-events-none truncate" style={{ ...FONT.navTitle, fontFamily: FONT.heading, color: F.textPrimary, padding: '0 64px' }}>{title}</span>
                    <IconBtn onClick={() => void data.refresh()} label="刷新" disabled={!paired || data.loading}>
                        <ArrowsClockwise size={21} weight="bold" color={F.textPrimary} className={data.loading ? 'animate-spin' : ''} />
                    </IconBtn>
                </div>
            </div>

            <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3.5"
                style={{ padding: '8px 20px 16px', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain', touchAction: 'pan-y' }}>
                {paired && data.revoked && (
                    <Card><p style={{ fontSize: 13, color: F.textSecondary, lineHeight: 1.6 }}>这台手机在 mini 上的钥匙失效了，要去「设置 → Mac mini」重新配对。</p></Card>
                )}
                {body}
            </div>

            {/* 底部主导航：进了角色详情就收起来（层级导航用返回键，不 tab 套 tab） */}
            {paired && !char && (
                <div className="shrink-0 flex items-center justify-around mx-5 p-1.5"
                    style={{ background: F.surfaceRaised, border: `1px solid ${F.borderSoft}`, borderRadius: R.panel, boxShadow: S.raisedMedium, marginBottom: 'calc(0.5rem + var(--safe-bottom))' }}>
                    {TABS.map(item => {
                        const active = tab === item.id;
                        const Icon = item.icon;
                        return (
                            <button key={item.id} onClick={() => { setTab(item.id); scroller.current?.scrollTo({ top: 0 }); }}
                                className="flex flex-col items-center gap-0.5 flex-1 py-2"
                                style={{
                                    borderRadius: R.medium, color: active ? P.main : F.textTertiary,
                                    background: active ? F.surfaceSunken : 'transparent', fontWeight: active ? 600 : 400,
                                    transition: `all ${MOTION.hover} ${MOTION.ease}`,
                                }}>
                                <Icon className="w-5 h-5" weight={active ? 'fill' : 'regular'} />
                                <span className="text-[11px]" style={{ color: active ? F.textPrimary : F.textTertiary }}>{item.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default MachineRoomApp;
// [EM-END: machine-room]
