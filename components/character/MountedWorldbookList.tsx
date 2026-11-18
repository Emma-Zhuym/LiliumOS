// [EM-START: mounted-worldbook-groups]
/**
 * 角色设定页里「已挂载的世界书」按整组显示（2026-11-17 阿萌：一下十几条看着乱）。
 *
 * - 按世界书分组（导入时一个文件 = 一组 = category），默认收起，组头写条数、关着几条
 * - 点开看每条：名字、注入位置、是否关着；× 一直露着（手机没有悬停）
 * - 组头「卸下整组」点两下才卸（第一下变成「确认卸下」，3 秒后复原）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CaretRight, X } from '@phosphor-icons/react';
import type { MountedWorldbook } from '../../types';
import { F, R, STATUS } from '../../utils/clayTokens';
import { WORLDBOOK_POSITION_LABELS } from '../../utils/worldbook';
import { groupMountedWorldbooks } from '../../utils/mountedWorldbookGroups';

const MountedWorldbookList: React.FC<{
    books: MountedWorldbook[];
    onUnmount: (id: string) => void;
    onUnmountGroup: (ids: string[]) => void;
}> = ({ books, onUnmount, onUnmountGroup }) => {
    const groups = useMemo(() => groupMountedWorldbooks(books), [books]);
    const [open, setOpen] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<string | null>(null);
    useEffect(() => {
        if (!confirming) return;
        const t = window.setTimeout(() => setConfirming(null), 3000);
        return () => window.clearTimeout(t);
    }, [confirming]);

    if (!books.length) {
        return (
            <div className="text-center" style={{ padding: '16px 0', borderRadius: R.bigCard, border: `1px dashed ${F.borderStrong}`, background: F.surfaceSunken, color: F.textTertiary, fontSize: 12 }}>
                暂未挂载任何世界书
            </div>
        );
    }

    return (
        <div className="flex flex-col" style={{ gap: 8 }}>
            {groups.map(([category, rows]) => {
                const isOpen = open === category;
                const off = rows.filter(r => r.disable).length;
                return (
                    <div key={category} style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, overflow: 'hidden' }}>
                        <div className="flex items-center" style={{ minHeight: 52, paddingRight: 6 }}>
                            <button type="button" onClick={() => setOpen(isOpen ? null : category)} aria-expanded={isOpen}
                                className="flex-1 min-w-0 flex items-center text-left active:opacity-60" style={{ gap: 8, padding: '10px 4px 10px 12px', background: 'transparent', border: 'none' }}>
                                <CaretRight size={14} weight="bold" color={F.textTertiary} className="shrink-0" style={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform 160ms' }} />
                                <span className="flex-1 min-w-0">
                                    <span className="block truncate" style={{ fontSize: 14, fontWeight: 600, color: F.textPrimary }}>{category}</span>
                                    <span className="block" style={{ fontSize: 12, color: F.textTertiary }}>{rows.length} 条{off ? ` · 关着 ${off} 条` : ''}</span>
                                </span>
                            </button>
                            <button type="button"
                                onClick={() => { if (confirming === category) { onUnmountGroup(rows.map(r => r.id)); setConfirming(null); } else setConfirming(category); }}
                                className="shrink-0 active:opacity-40" style={{ minHeight: 44, padding: '0 8px', background: 'transparent', border: 'none', fontSize: 13, fontWeight: 500, color: confirming === category ? STATUS.danger.main : F.textTertiary }}>
                                {confirming === category ? '确认卸下' : '卸下整组'}
                            </button>
                        </div>
                        {isOpen && rows.map(r => (
                            <div key={r.id} className="flex items-center" style={{ gap: 8, padding: '6px 0 6px 34px', borderTop: `1px solid ${F.divider}` }}>
                                <span className="flex-1 min-w-0">
                                    <span className="block truncate" style={{ fontSize: 14, color: r.disable ? F.textTertiary : F.textPrimary }}>{r.title}</span>
                                    <span className="block truncate" style={{ fontSize: 12, color: F.textTertiary }}>
                                        {WORLDBOOK_POSITION_LABELS[(r.position ?? 1) as keyof typeof WORLDBOOK_POSITION_LABELS] || '角色设定后'}
                                        {r.constant === false && r.key?.length ? ' · 关键词触发' : ''}
                                        {r.disable ? ' · 关着' : ''}
                                    </span>
                                </span>
                                <button type="button" aria-label={`卸下 ${r.title}`} onClick={() => onUnmount(r.id)}
                                    className="shrink-0 grid place-items-center active:opacity-40" style={{ width: 44, height: 44, background: 'transparent', border: 'none', color: F.textTertiary }}>
                                    <X size={16} weight="bold" />
                                </button>
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
};

export default MountedWorldbookList;
// [EM-END: mounted-worldbook-groups]
