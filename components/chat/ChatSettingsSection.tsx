import { F, S, R } from '../../utils/clayTokens';
import React, { useId, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';

/** Compact counterpart of the Settings app's sections; each group starts collapsed. */
export default function ChatSettingsSection({ title, summary, children, standalone = false }: {
    standalone?: boolean;
    title: string;
    summary: string;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const contentId = useId();
    if (standalone) return <div className="space-y-5">{children}</div>;
    return (
        <section className="overflow-hidden" style={{ borderRadius: R.smallCard, background: F.surface, boxShadow: S.raisedSoft }} data-chat-settings-section={title}>
            <button type="button" aria-expanded={open} aria-controls={contentId}
                onClick={() => setOpen(value => !value)}
                className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-primary">
                <span className="min-w-0" style={{ color: F.textSecondary }}>
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="mt-1 block text-xs leading-relaxed">{summary}</span>
                </span>
                <CaretDown aria-hidden="true" size={14} weight="bold" className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
            </button>
            <div id={contentId} hidden={!open} className="space-y-5 border-t px-4 py-4" style={{ borderColor: F.divider }}>
                {children}
            </div>
        </section>
    );
}
