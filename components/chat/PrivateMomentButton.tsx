// [EM-START: char-drives-private]
/**
 * 聊天工具栏的「贴贴」按钮（阿萌 2026-10-20）：她自己说开始 / 结束两个人的时间。
 *
 * 原来全靠副 API 从聊天里猜「她是不是说要开始了」，评估没跑、猜错、mini 不在线排队，
 * 都会落到同一个结果——该安静的时候他来插一句「在干嘛」。按钮是主开关，自动判断只兜底：
 * - 点一下开始：mini 上心跳 2 小时内整个跳过，连模型都不叫
 * - 再点一下结束：按「事后」算，念想落下来、进不应期；忘了点，2 小时后自己结束
 * 状态以 mini 为准（每次打开工具栏问一次），问不到就用本机上次记下的。
 * 样式跟同一格子里的其他按钮一致（className 由 ChatInputArea 按主题传进来）。
 */

import React, { useEffect, useState } from 'react';
import { Heart } from '@phosphor-icons/react';

import { useOS } from '../../context/OSContext';
import { AgentBackend, isAgentPaired, type AgentPrivateMoment } from '../../utils/emAgentBackend';
// [EM-START: tietie-record] 结束时 TA 写事后记录：本机记下这一次从几点开始（docs/spec-tietie-record.md）
import { autoSessionStart, beginTietieSession, clearTietieSession, readTietieSession, sessionStartFor, tietieEndKind, TIETIE_WINDOW_MS } from '../../utils/tietie';
import { announceTietieEnded } from '../tietie/useTietie';
import ClayDialog from '../os/ClayDialog';
import { F, R } from '../../utils/clayTokens';
// [EM-END: tietie-record]

const cacheKey = (charId: string) => `em_private_moment_v1:${charId}`;

const readCached = (charId: string): AgentPrivateMoment | null => {
    try {
        const parsed = JSON.parse(localStorage.getItem(cacheKey(charId)) || 'null');
        return parsed && typeof parsed.active === 'boolean' ? parsed : null;
    } catch {
        return null;
    }
};

const writeCached = (charId: string, value: AgentPrivateMoment) => {
    try { localStorage.setItem(cacheKey(charId), JSON.stringify(value)); } catch { /* 存不下就算了 */ }
};

/** 缓存里记的「到几点」过了就当已经结束。 */
export const isPrivateActive = (value: AgentPrivateMoment | null, now = Date.now()): boolean =>
    Boolean(value?.active && value.until && Date.parse(value.until) > now);

interface Props {
    charId: string;
    /** 整个按钮（图标 + 文字）的颜色类，跟旁边的按钮同一套 */
    textClassName: string;
    /** 图标底块的类：平时 / 进行中 */
    tileClassName: (active: boolean) => string;
    onDone: () => void;
}

const PrivateMomentButton: React.FC<Props> = ({ charId, textClassName, tileClassName, onDone }) => {
    const { addToast } = useOS();
    const [state, setState] = useState<AgentPrivateMoment | null>(() => readCached(charId));
    const [busy, setBusy] = useState(false);
    const [asking, setAsking] = useState(false); // [EM: tietie-record] 不是她点的开始：先问是不是贴贴

    useEffect(() => {
        let alive = true;
        setState(readCached(charId));
        AgentBackend.privateMoment(charId)
            .then(next => {
                if (!alive) return;
                setState(next);
                writeCached(charId, next);
            })
            .catch(() => { /* mini 不在线：先按本机记的显示 */ });
        return () => { alive = false; };
    }, [charId]);

    if (!isAgentPaired()) return null;
    const active = isPrivateActive(state);

    /** confirmed：她在「刚才是贴贴吗」里选了「是」，不再问 */
    const toggle = async (confirmed = false) => {
        if (busy) return;
        // [EM-START: tietie-record] 结束前先分清：真结束了 / 按错了 / 副 API 猜错了（阿萌 2026-10-30）
        if (active && !confirmed) {
            const kind = tietieEndKind({ session: readTietieSession(charId), source: state?.source, now: Date.now() });
            if (kind === 'ask') { setAsking(true); return; }
            if (kind === 'mistap') { await cancel('刚开始就关了，这次不算'); return; }
        }
        // [EM-END: tietie-record]
        setBusy(true);
        try {
            const previous = state; // [EM: tietie-record]
            const next = await AgentBackend.setPrivateMoment(charId, !active);
            setState(next);
            writeCached(charId, next);
            // [EM-START: tietie-record]
            const now = Date.now();
            if (next.active) {
                beginTietieSession(charId, next.until ? Date.parse(next.until) : now + TIETIE_WINDOW_MS, now);
            } else {
                const session = readTietieSession(charId);
                clearTietieSession(charId);
                // 副 API 猜着开、她确认是真的：开始时刻按 mini 的 until 往前推
                announceTietieEnded(charId, session ? sessionStartFor(session, now) : autoSessionStart(previous?.until, now), now);
            }
            // [EM-END: tietie-record]
            addToast(next.active
                ? '两个人的时间开始了：2 小时内 TA 不会主动来打扰，结束时再点一下'
                : '两个人的时间结束了', 'success');
            onDone();
        } catch {
            addToast('连不上 mini，这次没记上', 'error');
        } finally {
            setBusy(false);
        }
    };

    // [EM-START: tietie-record] 不是贴贴：mini 只关掉（不算事后），本机不写记录
    const cancel = async (message: string) => {
        setAsking(false);
        setBusy(true);
        try {
            const next = await AgentBackend.cancelPrivateMoment(charId);
            setState(next);
            writeCached(charId, next);
            clearTietieSession(charId);
            addToast(message, 'success');
            onDone();
        } catch {
            addToast('连不上 mini，这次没关上', 'error');
        } finally {
            setBusy(false);
        }
    };
    // [EM-END: tietie-record]

    return (
        <>
        <button onClick={() => { void toggle(); }} disabled={busy} className={`flex flex-col items-center gap-2 tool-btn ${textClassName} ${busy ? 'opacity-50' : ''}`}>
            <div className={tileClassName(active)}>
                <Heart className="w-6 h-6" weight={active ? 'fill' : 'bold'} />
            </div>
            <span className="text-xs font-bold">{active ? '结束贴贴' : '贴贴'}</span>
        </button>
            {/* [EM-START: tietie-record] */}
            <ClayDialog isOpen={asking} title="刚才是贴贴吗？" onClose={() => setAsking(false)} footer={
                <div className="flex" style={{ gap: 10 }}>
                    <button type="button" onClick={() => { void cancel('知道了，刚才不算，TA 不会写事后记录'); }} className="flex-1 clay-press"
                        style={{ height: 44, borderRadius: R.button, background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary, fontSize: 15, fontWeight: 600 }}>
                        不是，TA 误会了
                    </button>
                    <button type="button" onClick={() => { setAsking(false); void toggle(true); }} className="flex-1 clay-press"
                        style={{ height: 44, borderRadius: R.button, background: F.textPrimary, border: 'none', color: F.surface, fontSize: 15, fontWeight: 600 }}>
                        是，结束了
                    </button>
                </div>
            }>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary, textAlign: 'left' }}>
                    这次不是你点的开始，是从聊天里猜的。猜错了就选「不是」：只关掉，不写事后记录，也不算「事后」。
                </p>
            </ClayDialog>
            {/* [EM-END: tietie-record] */}
        </>
    );
};

export default PrivateMomentButton;
// [EM-END: char-drives-private]
