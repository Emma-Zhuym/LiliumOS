// [EM-START: text-voice-favorites]
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Star, X } from '@phosphor-icons/react';
import { F, R, S } from '../../utils/clayTokens';

interface Props {
    open: boolean;
    favorited: boolean;
    busy?: boolean;
    title?: string;
    preview?: string;
    onToggle: () => void;
    onClose: () => void;
    onMessageOptions?: () => void;
}
export default function VoiceFavoriteActionSheet({ open, favorited, busy = false, title = '语音收藏', preview, onToggle, onClose, onMessageOptions }: Props) {
    const panel = useRef<HTMLDivElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        closeButton.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, [open]);
    if (!open) return null;
    return createPortal(<div className="fixed inset-0 z-[1800] flex items-end justify-center md:items-center md:p-6" onClick={event => { event.stopPropagation(); onClose(); }}>
        <div className="absolute inset-0 opacity-35" style={{ background: F.textPrimary }} />
        <div ref={panel} role="dialog" aria-modal="true" aria-label={title}
            className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-[var(--voice-sheet-radius)] md:rounded-[var(--voice-panel-radius)]"
            style={{ '--voice-sheet-radius': `${R.sheet}px`, '--voice-panel-radius': `${R.panel}px`, background: F.surface, color: F.textPrimary, boxShadow: S.floating } as React.CSSProperties}
            onClick={event => event.stopPropagation()} onKeyDown={event => {
                if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
                if (event.key === 'Tab') {
                    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
                    if (!buttons?.length) return;
                    const first = buttons[0], last = buttons[buttons.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                }
            }}>
            <div className="mx-auto mt-3 h-1 w-9 md:hidden" style={{ background: F.borderStrong, borderRadius: R.pill }} />
            <header className="relative flex shrink-0 items-center justify-end p-4">
                <h2 className="pointer-events-none absolute inset-x-16 text-center text-base font-semibold">{title}</h2>
                <button ref={closeButton} type="button" aria-label="关闭语音收藏菜单" onClick={onClose} className="grid h-11 w-11 place-items-center" style={{ background: F.surface, color: F.textSecondary, borderRadius: R.pill, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}><X size={20} weight="bold" /></button>
            </header>
            <div className="min-h-0 overflow-y-auto px-5"><p className="whitespace-pre-wrap break-words p-4 text-sm leading-6" style={{ background: F.surfaceSunken, color: F.textSecondary, borderRadius: R.input, boxShadow: S.sunken }}>{preview || '保存已有的语音内容'}</p></div>
            <footer className="shrink-0 space-y-3 px-5 pt-4 pb-[max(1.25rem,var(--safe-bottom))]">
                {onMessageOptions && <button type="button" disabled={busy} onClick={onMessageOptions} className="min-h-11 w-full text-sm font-medium disabled:opacity-50" style={{ background: F.surface, color: F.textSecondary, borderRadius: R.button, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>整条消息操作</button>}
                <button type="button" disabled={busy} onClick={onToggle} className="flex min-h-12 w-full items-center justify-center gap-2 text-sm font-semibold disabled:opacity-50" style={{ background: F.textPrimary, color: F.surface, borderRadius: R.button }}><Star size={18} weight="bold" />{busy ? '正在处理…' : favorited ? '取消语音收藏' : '收藏语音'}</button>
            </footer>
        </div>
    </div>, document.body);
}
// [EM-END: text-voice-favorites]
