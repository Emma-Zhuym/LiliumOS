// [EM-START: clay-dialog]
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { F, R, S } from '../../utils/clayTokens';

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
        close.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, [isOpen]);
    if (!isOpen) return null;
    return createPortal(<div className="fixed inset-0 z-[1800] flex items-end justify-center md:items-center md:p-6" onClick={event => { event.stopPropagation(); onClose(); }}>
        <div className="absolute inset-0 opacity-35" style={{ background: F.textPrimary }} />
        <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[90dvh] w-full flex-col rounded-t-[var(--clay-sheet-radius)] md:max-w-md md:rounded-[var(--clay-dialog-radius)]"
            style={{ '--clay-sheet-radius': `${R.sheet}px`, '--clay-dialog-radius': `${R.panel}px`, background: F.surface, color: F.textPrimary, boxShadow: S.floating } as React.CSSProperties}
            onClick={event => event.stopPropagation()} onKeyDown={event => {
                if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
                if (event.key !== 'Tab') return;
                const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
                if (!controls.length) return;
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }}>
            <div className="mx-auto mt-3 h-1 w-9 md:hidden" style={{ background: F.borderStrong, borderRadius: R.pill }} />
            <header className="relative flex shrink-0 items-center justify-end p-4">
                <h2 className="pointer-events-none absolute inset-x-16 text-center text-base font-semibold">{title}</h2>
                <button ref={close} type="button" aria-label={`关闭${title}`} onClick={onClose} className="grid h-11 w-11 place-items-center" style={{ background: F.surface, color: F.textSecondary, borderRadius: R.pill, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}><X size={20} weight="bold" /></button>
            </header>
            <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div>
            {footer ? <footer className="shrink-0 px-5 pt-3 pb-[max(1.25rem,var(--safe-bottom))]">{footer}</footer> : <div className="shrink-0 pb-[var(--safe-bottom)]" />}
        </div>
    </div>, document.body);
}
// [EM-END: clay-dialog]
