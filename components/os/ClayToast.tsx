// [EM-START: skin-f-toast]
/**
 * ClayToast — 换皮「F」的顶部提示条。PhoneShell 只负责排队和定位，长相全在这里。
 * 比背景深一档的雾面底 + 1px 墨色边，不靠投影；从顶上带一点过冲地弹下来（MOTION.easePop）。
 */
import React from 'react';
import { Check, Info, X } from '@phosphor-icons/react';
import { F, OVERLAY, R, STATUS } from '../../utils/clayTokens';

export type ClayToastType = 'success' | 'error' | 'info';

const TONE: Record<ClayToastType, { bg: string; Icon: typeof Check }> = {
    success: { bg: STATUS.success.main, Icon: Check },
    error: { bg: STATUS.danger.main, Icon: X },
    info: { bg: STATUS.info.main, Icon: Info },
};

export default function ClayToast({ message, type }: { message: string; type?: string }) {
    const tone = TONE[(type as ClayToastType) in TONE ? (type as ClayToastType) : 'info'];
    const { Icon } = tone;
    return (
        <div role="status" className="clay-toast-in flex items-start gap-2.5 max-w-[85%]"
            style={{
                background: OVERLAY.toastBg, backdropFilter: OVERLAY.blur, WebkitBackdropFilter: OVERLAY.blur,
                border: OVERLAY.toastEdge, borderRadius: R.bigCard, padding: '9px 14px 9px 10px',
            }}>
            <span className="shrink-0 flex items-center justify-center"
                style={{ width: 20, height: 20, marginTop: 0, borderRadius: R.pill, background: tone.bg, color: F.surfaceRaised }}>
                <Icon size={12} weight="bold" />
            </span>
            <span className="min-w-0 text-left whitespace-normal break-words [overflow-wrap:anywhere]"
                style={{ fontSize: 13, fontWeight: 600, lineHeight: '20px', color: F.textPrimary }}>
                {message}
            </span>
        </div>
    );
}
// [EM-END: skin-f-toast]
