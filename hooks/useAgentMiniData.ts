// [EM-START: machine-room]
/**
 * 跟 mini 要一份「现在怎么样」：状态、角色、心跳流水、开关、凭据用的模型。
 * 机房（看 TA）和设置 → Mac mini（管机器）都用这一份（2026-10-27 从机房拆出来）。
 * 连不上时保留上一次拿到的样子，并分清是钥匙失效、没网、被拦还是 mini 在休息。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
    AgentBackend, AgentBackendError, isAgentPaired, probeInternet,
    type AgentAdminSettings, type AgentCharacter, type AgentModelRun, type AgentStatus,
} from '../utils/emAgentBackend';
import { describeReachFailure, type ReachFailure } from '../utils/emMachineRoom'; // [EM: machine-room-reach-reason]

export interface AgentMiniData {
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

export const useAgentMiniData = (): AgentMiniData => {
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
// [EM-END: machine-room]
