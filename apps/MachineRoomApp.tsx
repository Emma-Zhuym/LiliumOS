// [EM-START: machine-room]
/**
 * MachineRoomApp.tsx — 机房：看 TA 们这会儿和最近怎么样。
 *
 * 起因（阿萌 2026-10-20）：跟 mini 有关的东西散在设置页十几处、层层弹窗里，收成了这个 App。
 * 2026-10-27 拆开（roadmap 结构梳理第 4 步）：把「TA 是什么样的人」和 mini 的开关摆在一起让人幻灭，
 * 所以机器那半（服务状态、开关、报错原因、心跳流水、每个角色的心跳设置、这台手机的推送）搬回「设置 → Mac mini」，
 * 脾气搬进神经链接。这里只剩：此刻每个人在干嘛，点进去看心里、攒着想说的、最近几跳。
 * 以后改成「窗台」（一屏小卡 + 混排时间线 + 心思热力条）也在这一页上长。
 *
 * mini 每天 4–7 点休眠，连不上时安静显示上一次拿到的样子，不弹错。主色 mint，F 规范（全平），取值只从 clayTokens。
 */

import React, { useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, CaretLeft, HardDrives } from '@phosphor-icons/react';

import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { F, FONT, R } from '../utils/clayTokens';
import { isAgentPaired } from '../utils/emAgentBackend';
import { useAgentMiniData } from '../hooks/useAgentMiniData';
import { settingsLaunch } from '../utils/emSettingsPages';
import { Card, Empty, PillButton } from '../components/machineRoom/ui';
import NowView from '../components/machineRoom/NowView';
import CharacterView from '../components/machineRoom/CharacterView';

const IconBtn: React.FC<{ onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }> = ({ onClick, label, children, disabled }) => (
    <button onClick={onClick} aria-label={label} disabled={disabled}
        className="flex items-center justify-center active:opacity-40 transition-opacity disabled:opacity-50"
        style={{ width: 44, height: 44, borderRadius: R.pill, background: 'transparent', border: 'none', boxShadow: 'none' }}>
        {children}
    </button>
);

const MachineRoomApp: React.FC = () => {
    const { closeApp, openApp, characters } = useOS();
    const data = useAgentMiniData();
    const [charId, setCharId] = useState<string | null>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const paired = isAgentPaired();

    const openChar = (id: string) => { setCharId(id); scroller.current?.scrollTo({ top: 0 }); };
    const char = useMemo(() => characters.find(item => item.id === charId) ?? null, [characters, charId]);
    /** 去「设置 → Mac mini」：机器那半都在那里 */
    const openMiniSettings = () => { settingsLaunch.request('mini'); openApp(AppID.Settings); };

    const body = !paired ? (
        <div className="flex flex-col" style={{ gap: 12, paddingTop: 24 }}>
            <Empty icon={<HardDrives size={18} weight="bold" color={F.textTertiary} />}>
                还没连上 Mac mini。先在「设置 → Mac mini」里配对，配好了这里就能看到 TA 们在干嘛。
            </Empty>
            <div className="flex justify-center"><PillButton strong onClick={openMiniSettings}>去设置里配对</PillButton></div>
        </div>
    ) : char ? (
        <CharacterView char={char} data={data} />
    ) : (
        <NowView data={data} onOpenChar={openChar} onOpenSettings={openMiniSettings} />
    );

    return (
        <div className="h-full flex flex-col relative" style={{ background: F.appBg }}>
            <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
                <div className="relative flex items-center justify-between" style={{ minHeight: 44, padding: '0 20px' }}>
                    <IconBtn onClick={() => (char ? setCharId(null) : closeApp())} label="返回"><CaretLeft size={22} weight="bold" color={F.textPrimary} /></IconBtn>
                    <span className="absolute left-0 right-0 flex justify-center pointer-events-none truncate" style={{ ...FONT.navTitle, fontFamily: FONT.heading, color: F.textPrimary, padding: '0 64px' }}>{char ? char.name : '机房'}</span>
                    <IconBtn onClick={() => void data.refresh()} label="刷新" disabled={!paired || data.loading}>
                        <ArrowsClockwise size={21} weight="bold" color={F.textPrimary} className={data.loading ? 'animate-spin' : ''} />
                    </IconBtn>
                </div>
            </div>

            <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3.5"
                style={{ padding: '8px 20px calc(16px + var(--safe-bottom))', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain', touchAction: 'pan-y' }}>
                {paired && data.revoked && (
                    <Card><p style={{ fontSize: 13, color: F.textSecondary, lineHeight: 1.6 }}>这台手机在 mini 上的钥匙失效了，要去「设置 → Mac mini」重新配对。</p></Card>
                )}
                {body}
            </div>
        </div>
    );
};

export default MachineRoomApp;
// [EM-END: machine-room]
