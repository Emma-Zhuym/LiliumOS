// [EM-START: ooc]
/**
 * 工具栏第二页的「OOC」：说明怎么出戏、一键在输入框里写好「// 」，列出钉住的要求（能取消）。
 * 真正判断是不是 OOC 的是发送时的前缀（utils/emOoc.ts parseOocInput），这里只是入口和管理。
 */
import React, { useEffect, useState } from 'react';
import { PushPin, Terminal } from '@phosphor-icons/react';
import ClayDialog from '../os/ClayDialog';
import { F, R } from '../../utils/clayTokens';
import { loadOocPins, OOC_PINS_CHANGED_EVENT, unpinOoc, type OocPin } from '../../utils/emOoc';

interface Props {
    charId: string;
    /** 跟同一格子里其他按钮一致的颜色类 */
    textClassName: string;
    tileClassName: string;
    /** 在输入框里写好「// 」并聚焦 */
    onStart: () => void;
}

const OocButton: React.FC<Props> = ({ charId, textClassName, tileClassName, onStart }) => {
    const [open, setOpen] = useState(false);
    const [pins, setPins] = useState<OocPin[]>(() => loadOocPins(charId));
    useEffect(() => {
        setPins(loadOocPins(charId));
        const handler = (event: Event) => {
            if ((event as CustomEvent<{ charId?: string }>).detail?.charId === charId) setPins(loadOocPins(charId));
        };
        window.addEventListener(OOC_PINS_CHANGED_EVENT, handler);
        return () => window.removeEventListener(OOC_PINS_CHANGED_EVENT, handler);
    }, [charId]);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className={`flex flex-col items-center gap-2 tool-btn ${textClassName}`}>
                <div className={tileClassName}><Terminal className="w-6 h-6" weight="bold" /></div>
                <span className="text-xs font-bold">OOC{pins.length ? ` · ${pins.length}` : ''}</span>
            </button>
            <ClayDialog isOpen={open} title="OOC · 跟模型说" onClose={() => setOpen(false)} footer={
                <button type="button" className="w-full clay-press" onClick={() => { setOpen(false); onStart(); }}
                    style={{ height: 46, borderRadius: R.button, background: F.textPrimary, border: 'none', color: F.surface, fontSize: 15, fontWeight: 600 }}>
                    写一条 OOC
                </button>
            }>
                <div className="flex flex-col" style={{ gap: 14 }}>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>
                        以 <b style={{ color: F.textPrimary }}>//</b> 开头发出去（「OOC：」也行），就是出戏跟模型本身说话：灰色小气泡，模型也出戏回你一段。
                        这些不算剧情——不进情绪、不进记忆，心跳也看不到。点灰气泡上的图钉可以钉住，每一轮都提醒。
                    </p>
                    <div style={{ fontSize: 12, color: F.textTertiary }}>钉住的要求</div>
                    {pins.length ? (
                        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, overflow: 'hidden' }}>
                            {pins.map((pin, index) => (
                                <div key={pin.id} className="flex items-center" style={{ gap: 8, padding: '4px 4px 4px 14px', borderTop: index ? `1px solid ${F.divider}` : 'none' }}>
                                    <span className="flex-1 min-w-0" style={{ fontSize: 14, lineHeight: '21px', color: F.textPrimary, padding: '8px 0' }}>{pin.text}</span>
                                    <button type="button" aria-label="取消钉住" onClick={() => unpinOoc(charId, pin.id)}
                                        className="grid place-items-center shrink-0 active:opacity-40 transition-opacity"
                                        style={{ width: 44, height: 44, background: 'transparent', border: 'none' }}>
                                        <PushPin size={18} weight="fill" color={F.textSecondary} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center" style={{ gap: 10, background: F.surfaceSunken, borderRadius: R.medium, padding: '12px 14px', fontSize: 14, color: F.textTertiary }}>
                            <PushPin size={18} weight="bold" color={F.textTertiary} />
                            还没有钉住的
                        </div>
                    )}
                </div>
            </ClayDialog>
        </>
    );
};

export default OocButton;
// [EM-END: ooc]
