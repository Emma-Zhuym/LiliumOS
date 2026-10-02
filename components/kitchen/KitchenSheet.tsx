import React, { useEffect, useId, useRef } from 'react';
import { X } from '@phosphor-icons/react';

interface Props {
  title: string;
  label?: string;
  busy: boolean;
  backgroundRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
  children: React.ReactNode;
}

/** A paper sheet stays inside the simulated phone and keeps keyboard focus there. */
export default function KitchenSheet({ title, label, busy, backgroundRef, onClose, children }: Props) {
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef({ busy, onClose });
  close.current = { busy, onClose };

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const background = backgroundRef.current;
    if (background) background.inert = true;
    sheet.current?.focus({ preventScroll: true });
    return () => {
      if (background) background.inert = false;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else background?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    };
  }, [backgroundRef]);

  return <div className="kitchen-sheet-backdrop" onClick={event => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <div ref={sheet} className="kitchen-sheet" role="dialog" aria-modal="true"
      aria-label={label} aria-labelledby={label ? undefined : titleId} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!close.current.busy) close.current.onClose();
        }
        if (event.key !== 'Tab') return;
        const elements = Array.from(sheet.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
        ) ?? []).filter(element => !element.closest('details:not([open])') || element.tagName === 'SUMMARY');
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet.current)) {
          event.preventDefault(); first.focus();
        }
      }}>
      <header className="kitchen-sheet-header">
        <h2 id={titleId} className="kitchen-heading">{title}</h2>
        <button type="button" className="kitchen-icon" aria-label="关闭" onClick={onClose} disabled={busy}><X size={21} /></button>
      </header>
      <div className="kitchen-sheet-body">{children}</div>
    </div>
  </div>;
}
