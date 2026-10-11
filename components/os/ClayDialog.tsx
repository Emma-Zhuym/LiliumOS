// [EM-START: clay-dialog]
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { F, FONT, OVERLAY, R } from '../../utils/clayTokens';

export default function ClayDialog({ isOpen, title, children, footer, onClose }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    onClose: () => void;
}) {
    const panel = useRef<HTMLDivElement>(null);
    const close = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement as HTMLElement | null;
        close.current?.focus({ preventScroll: true }); // sheet 还在滑入，别把外层滚上去
        return () => { if (previous?.isConnected) previous.focus(); };
    }, [isOpen]);
    if (!isOpen) return null;
    return createPortal(<div className="fixed inset-0 z-[1800] flex items-end justify-center md:items-center md:p-6" onClick={event => { event.stopPropagation(); onClose(); }}>
        {/* [EM: skin-f] 手机上是雾面 sheet，不压暗；桌面居中弹窗才加遮罩 */}
        <div className="absolute inset-0 opacity-0 md:opacity-100" style={{ background: OVERLAY.scrimModal }} />
        <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="clay-sheet-in relative flex max-h-[90dvh] w-full flex-col rounded-t-[var(--clay-sheet-radius)] md:max-w-md md:rounded-[var(--clay-dialog-radius)]"
            style={{
                '--clay-sheet-radius': `${R.sheet}px`, '--clay-dialog-radius': `${R.panel}px`, color: F.textPrimary,
                background: OVERLAY.bg, backdropFilter: OVERLAY.blur, WebkitBackdropFilter: OVERLAY.blur,
                borderTop: OVERLAY.edge, boxShadow: OVERLAY.hairline,
            } as React.CSSProperties}
            onClick={event => event.stopPropagation()} onKeyDown={event => {
                if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
                if (event.key !== 'Tab') return;
                const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
                if (!controls.length) return;
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }}>
            <div className="mx-auto mt-2.5 h-1 w-9 md:hidden" style={{ background: OVERLAY.grab, borderRadius: R.pill }} />
            <header className="relative flex shrink-0 items-center justify-end p-4">
                <h2 className="pointer-events-none absolute inset-x-16 text-center" style={{ ...FONT.navTitle, fontFamily: FONT.heading }}>{title}</h2>
                <button ref={close} type="button" aria-label={`关闭${title}`} onClick={onClose} className="grid h-11 w-11 place-items-center active:opacity-40 transition-opacity" style={{ background: 'transparent', color: F.textPrimary, borderRadius: R.pill }}><X size={21} weight="bold" /></button>
            </header>
            <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div>
            {footer ? <footer className="shrink-0 px-5 pt-3 pb-[max(1.25rem,var(--safe-bottom))]">{footer}</footer> : <div className="shrink-0 pb-[var(--safe-bottom)]" />}
        </div>
    </div>, document.body);
}
// [EM-END: clay-dialog]
