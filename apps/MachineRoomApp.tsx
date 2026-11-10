// [EM-START: machine-room]
/**
 * MachineRoomApp.tsx — 窗台（原机房）：看 TA 们这会儿和最近怎么样。
 *
 * 起因（阿萌 2026-10-20）：跟 mini 有关的东西散在设置页十几处，收成了机房。
 * 2026-10-27 拆开：机器那半搬回「设置 → Mac mini」，脾气搬进神经链接，这里只看 TA。
 * 2026-11-10 改成窗台（画布 https://claude.ai/artifact/BfunjkLhpiV2D9kNayYLvP 定稿）：
 *   首页一人一张牌（components/windowSill/SillHome.tsx），点进去是这个人的详情（SillDetail.tsx）。
 *   窗台不走 F，取值只从 utils/sillTokens.ts 来（阿萌 11-10 定）。
 *   三套颜色不绑角色，阿萌在详情页右上角自己选，存本机（utils/emWindowSill.ts）。
 *
 * mini 每天 4–7 点休眠，连不上时安静显示上一次拿到的样子，不弹错。
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, CaretLeft } from '@phosphor-icons/react';

import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { isAgentPaired } from '../utils/emAgentBackend';
import { useAgentMiniData } from '../hooks/useAgentMiniData';
import { settingsLaunch } from '../utils/emSettingsPages';
import { saveSillTheme, sillThemeFor } from '../utils/emWindowSill';
import { SILL, SILL_FONT, SILL_THEME_ORDER, SILL_THEMES, type SillTheme, type SillThemeId } from '../utils/sillTokens';
import SillHome from '../components/windowSill/SillHome';
import SillDetail from '../components/windowSill/SillDetail';

const IconBtn: React.FC<{ onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean; expanded?: boolean }> = ({ onClick, label, children, disabled, expanded }) => (
    <button type="button" onClick={onClick} aria-label={label} aria-expanded={expanded} disabled={disabled}
        className="flex items-center justify-center active:opacity-40 transition-opacity disabled:opacity-50"
        style={{ width: 44, height: 44, borderRadius: 999, background: 'transparent', border: 'none', boxShadow: 'none', color: SILL.ink }}>
        {children}
    </button>
);

/** 颜色的小样：底色 + 右上角一点形状 + 左下角一点深色块 */
const Swatch: React.FC<{ theme: SillTheme; size: number }> = ({ theme, size }) => (
    <span style={{ position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: theme.field, boxShadow: `0 0 0 1px ${SILL.switchOff}` }}>
        <span style={{ position: 'absolute', width: size * 0.64, height: size * 0.64, borderRadius: '50%', right: -size * 0.14, top: -size * 0.14, background: theme.shape }} />
        <span style={{ position: 'absolute', width: size * 0.46, height: size * 0.32, left: 0, bottom: 0, borderTopRightRadius: size * 0.32, background: theme.block }} />
    </span>
);

const MachineRoomApp: React.FC = () => {
    const { closeApp, openApp, characters } = useOS();
    const data = useAgentMiniData();
    const [charId, setCharId] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [themeVersion, setThemeVersion] = useState(0);
    const scroller = useRef<HTMLDivElement>(null);
    const paired = isAgentPaired();

    const themeOf = useCallback((id: string) => {
        const index = characters.findIndex(item => item.id === id);
        return SILL_THEMES[sillThemeFor(id, Math.max(0, index))];
    }, [characters, themeVersion]); // eslint-disable-line react-hooks/exhaustive-deps
    const pickTheme = (id: SillThemeId) => {
        if (!charId) return;
        saveSillTheme(charId, id);
        setThemeVersion(v => v + 1);
    };

    const openChar = (id: string) => { setCharId(id); setPicking(false); scroller.current?.scrollTo({ top: 0 }); };
    const char = useMemo(() => characters.find(item => item.id === charId) ?? null, [characters, charId]);
    /** 去「设置 → Mac mini」：机器那半都在那里 */
    const openMiniSettings = () => { settingsLaunch.request('mini'); openApp(AppID.Settings); };
    const theme = char ? themeOf(char.id) : null;

    const body = !paired ? (
        <div className="flex flex-col" style={{ gap: 12, paddingTop: 24, color: SILL.ink }}>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: SILL.inkSoft }}>还没连上 Mac mini。先在「设置 → Mac mini」里配对，配好了这里就能看到 TA 们在干嘛。</p>
            <div>
                <button type="button" onClick={openMiniSettings} className="active:opacity-40"
                    style={{ minHeight: 44, border: 'none', background: 'none', padding: 0, fontSize: 14, color: SILL.ink, textDecoration: 'underline', textUnderlineOffset: 4 }}>去设置里配对</button>
            </div>
        </div>
    ) : char && theme ? (
        <SillDetail key={char.id} char={char} data={data} theme={theme} />
    ) : (
        <SillHome data={data} themeOf={themeOf} onOpenChar={openChar} onOpenSettings={openMiniSettings} />
    );

    return (
        <div className="h-full flex flex-col relative" style={{ background: SILL.page, color: SILL.ink }}>
            <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
                <div className="relative flex items-center justify-between" style={{ minHeight: 44, padding: '0 8px' }}>
                    <IconBtn onClick={() => (char ? setCharId(null) : closeApp())} label="返回"><CaretLeft size={22} weight="bold" /></IconBtn>
                    <span className="absolute left-0 right-0 flex justify-center pointer-events-none truncate"
                        style={{ fontSize: 17, fontWeight: 700, fontFamily: SILL_FONT.serif, padding: '0 64px' }}>{char ? char.name : '窗台'}</span>
                    {char && theme ? (
                        <IconBtn onClick={() => setPicking(v => !v)} label="换一套颜色" expanded={picking}><Swatch theme={theme} size={22} /></IconBtn>
                    ) : (
                        <IconBtn onClick={() => void data.refresh()} label="刷新" disabled={!paired || data.loading}>
                            <ArrowsClockwise size={21} weight="bold" className={data.loading ? 'animate-spin' : ''} />
                        </IconBtn>
                    )}
                </div>
                {char && theme && picking && (
                    <div role="radiogroup" aria-label="颜色" className="flex justify-end" style={{ gap: 4, padding: '0 12px 4px' }}>
                        {SILL_THEME_ORDER.map(id => {
                            const on = id === theme.id;
                            return (
                                <button key={id} type="button" role="radio" aria-checked={on} onClick={() => pickTheme(id)}
                                    className="flex items-center"
                                    style={{ minWidth: 64, minHeight: 44, padding: '0 10px', gap: 8, border: 'none', borderRadius: 999, background: on ? SILL.chipOn : 'transparent', color: SILL.ink, fontSize: 13, fontWeight: on ? 700 : 400 }}>
                                    <Swatch theme={SILL_THEMES[id]} size={18} />{SILL_THEMES[id].name}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto"
                style={{ padding: '12px 16px calc(24px + var(--safe-bottom))', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain', touchAction: 'pan-y' }}>
                {paired && data.revoked && (
                    <p style={{ fontSize: 13, lineHeight: 1.6, color: SILL.inkSoft, marginBottom: 12 }}>这台手机在 mini 上的钥匙失效了，要去「设置 → Mac mini」重新配对。</p>
                )}
                {body}
            </div>
        </div>
    );
};

export default MachineRoomApp;
// [EM-END: machine-room]
