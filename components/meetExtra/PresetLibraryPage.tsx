// [EM-START: preset-library]
/**
 * 素材库：文风和基调。从酒馆预设 JSON 里勾着导入，也能手贴一条。
 * 原文只在这台设备和私有备份里（见 utils/presetLibrary.ts 文件头）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { F, FONT, R, STATUS } from '../../utils/clayTokens';
import {
    PRESET_KIND_LABEL, PRESET_LIBRARY_CHANGED_EVENT, addPresetItems, listPresetItems, parseTavernPreset, removePresetItem, savePresetItem,
    type PresetImportEntry, type PresetItem, type PresetItemKind,
} from '../../utils/presetLibrary';
import ClayDialog from '../os/ClayDialog';
import { Segmented } from '../settings/SettingsParts';
import { ExtraHeader } from './ExtraHeader';

export const usePresetItems = (kind?: PresetItemKind): PresetItem[] => {
    const [rows, setRows] = useState<PresetItem[]>(() => listPresetItems(kind));
    useEffect(() => {
        const load = () => setRows(listPresetItems(kind));
        load();
        window.addEventListener(PRESET_LIBRARY_CHANGED_EVENT, load);
        return () => window.removeEventListener(PRESET_LIBRARY_CHANGED_EVENT, load);
    }, [kind]);
    return rows;
};

const card: React.CSSProperties = { background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, overflow: 'hidden' };
const area: React.CSSProperties = {
    width: '100%', borderRadius: R.input, border: 'none', background: F.surfaceSunken, color: F.textPrimary,
    fontSize: 15, lineHeight: '22px', padding: '10px 12px', outline: 'none', resize: 'vertical',
};
const primary: React.CSSProperties = { height: 46, borderRadius: R.button, border: 'none', background: F.textPrimary, color: F.surface, fontSize: 15, fontWeight: 600 };

type Pick = { checked: boolean; kind: PresetItemKind };

/** 导入：列出这份预设里的条目，勾要的、标成文风还是基调 */
const ImportView: React.FC<{ fileName: string; entries: PresetImportEntry[]; onCancel: () => void; onDone: (n: number) => void }> = ({ fileName, entries, onCancel, onDone }) => {
    const [showAll, setShowAll] = useState(false);
    const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(entries.map(e => [e.key, { checked: e.enabled && !!e.guess, kind: e.guess || 'style' }])));
    const [peek, setPeek] = useState<PresetImportEntry | null>(null);
    const shown = entries.filter(e => showAll || e.guess);
    const groups = useMemo(() => {
        const out: { group: string; rows: PresetImportEntry[] }[] = [];
        for (const e of shown) {
            const last = out[out.length - 1];
            if (last && last.group === e.group) last.rows.push(e); else out.push({ group: e.group, rows: [e] });
        }
        return out;
    }, [shown]);
    const count = entries.filter(e => picks[e.key]?.checked).length;
    const save = () => {
        const items = entries.filter(e => picks[e.key]?.checked).map(e => ({ kind: picks[e.key].kind, name: e.name, text: e.text, source: fileName }));
        onDone(addPresetItems(items));
    };
    return (
        <div className="h-full w-full flex flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
            <ExtraHeader title="挑要导入的" onBack={onCancel} />
            <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col" style={{ gap: 16, padding: '4px 16px 16px' }}>
                <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: F.textSecondary }}>
                    {fileName}：认出 {entries.filter(e => e.guess === 'style').length} 条文风、{entries.filter(e => e.guess === 'tone').length} 条基调。预设里开着的已经帮你勾上；点名字能看全文。
                </p>
                {groups.map((g, gi) => (
                    <section key={`${g.group}-${gi}`} className="flex flex-col" style={{ gap: 6 }}>
                        {g.group && <h3 className="px-1" style={{ margin: 0, fontSize: 12, fontWeight: 400, color: F.textTertiary, letterSpacing: '.04em' }}>{g.group}</h3>}
                        <div style={card}>
                            {g.rows.map((e, i) => {
                                const pick = picks[e.key];
                                return (
                                    <div key={e.key} className="relative flex items-center" style={{ gap: 10, padding: '8px 10px 8px 4px', minHeight: 52 }}>
                                        {i > 0 && <span aria-hidden className="absolute top-0 right-0" style={{ left: 44, height: 1, background: F.divider }} />}
                                        <button type="button" role="checkbox" aria-checked={pick.checked} aria-label={`导入 ${e.name}`}
                                            onClick={() => setPicks(p => ({ ...p, [e.key]: { ...p[e.key], checked: !p[e.key].checked } }))}
                                            className="shrink-0 grid place-items-center" style={{ width: 40, height: 44, background: 'transparent', border: 'none' }}>
                                            <span style={{ width: 20, height: 20, borderRadius: R.tiny, border: `1.5px solid ${pick.checked ? F.textPrimary : F.borderStrong}`, background: pick.checked ? F.textPrimary : 'transparent', color: F.surface, fontSize: 13, lineHeight: '17px', textAlign: 'center' }}>{pick.checked ? '✓' : ''}</span>
                                        </button>
                                        <button type="button" onClick={() => setPeek(e)} className="flex-1 min-w-0 text-left active:opacity-60" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                                            <span className="block truncate" style={{ fontSize: 15, color: F.textPrimary }}>{e.name}</span>
                                            <span className="block truncate" style={{ fontSize: 12, color: F.textTertiary }}>{e.enabled ? '预设里开着 · ' : ''}{e.text.length} 字</span>
                                        </button>
                                        {pick.checked && (
                                            <span className="shrink-0" style={{ width: 104 }}>
                                                <Segmented<PresetItemKind> standalone label={`${e.name} 的用途`} value={pick.kind}
                                                    onChange={v => setPicks(p => ({ ...p, [e.key]: { ...p[e.key], kind: v } }))}
                                                    options={[{ value: 'style', label: '文风' }, { value: 'tone', label: '基调' }]} />
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))}
                <button type="button" onClick={() => setShowAll(v => !v)} className="self-center active:opacity-40"
                    style={{ minHeight: 44, padding: '0 8px', background: 'transparent', border: 'none', fontSize: 13, color: F.textTertiary }}>
                    {showAll ? '只看文风和基调' : `其他条目也列出来（${entries.filter(e => !e.guess).length}）`}
                </button>
            </main>
            <div className="shrink-0" style={{ padding: '10px 16px calc(12px + var(--safe-bottom))', borderTop: `1px solid ${F.borderSoft}`, background: F.appBg }}>
                <button type="button" onClick={save} disabled={!count} className="w-full active:opacity-80 disabled:opacity-40" style={primary}>导入 {count} 条</button>
            </div>
            <ClayDialog isOpen={!!peek} title={peek?.name || ''} onClose={() => setPeek(null)}>
                <p className="whitespace-pre-wrap" style={{ margin: 0, maxHeight: '55vh', overflowY: 'auto', fontSize: 13, lineHeight: '20px', color: F.textSecondary }}>{peek?.text}</p>
            </ClayDialog>
        </div>
    );
};

const PresetLibraryPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { addToast, registerBackHandler } = useOS();
    const items = usePresetItems();
    const fileRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState<{ fileName: string; entries: PresetImportEntry[] } | null>(null);
    const [editing, setEditing] = useState<Partial<PresetItem> & { kind: PresetItemKind } | null>(null);
    useEffect(() => registerBackHandler(() => { if (importing) setImporting(null); else onBack(); return true; }), [importing, onBack, registerBackHandler]);

    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileRef.current) fileRef.current.value = '';
        if (!file) return;
        try {
            const entries = parseTavernPreset(await file.text());
            if (!entries.length) { addToast('这份预设里没有能用的条目', 'error'); return; }
            setImporting({ fileName: file.name.replace(/\.json$/i, ''), entries });
        } catch (err: any) {
            addToast(err?.message || '读不出来', 'error');
        }
    };

    if (importing) {
        return <ImportView fileName={importing.fileName} entries={importing.entries} onCancel={() => setImporting(null)}
            onDone={n => { setImporting(null); addToast(`导入了 ${n} 条`, 'success'); }} />;
    }

    return (
        <div className="h-full w-full flex flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
            <ExtraHeader title="文风和基调" onBack={onBack} />
            <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col" style={{ gap: 20, padding: '4px 16px calc(28px + var(--safe-bottom))' }}>
                <div className="flex flex-col" style={{ gap: 8 }}>
                    <button type="button" onClick={() => fileRef.current?.click()} className="active:opacity-80" style={primary}>从酒馆预设导入</button>
                    <button type="button" onClick={() => setEditing({ kind: 'style', name: '', text: '' })} className="active:opacity-60"
                        style={{ ...primary, background: F.surfaceSunken, color: F.textPrimary }}>手贴一条</button>
                    <p style={{ margin: '4px 4px 0', fontSize: 12, lineHeight: '18px', color: F.textTertiary }}>
                        选酒馆导出的对话补全预设（.json）。原文只存在这台设备和你的私有备份里，不进 LiliumOS 的代码仓库。
                    </p>
                </div>
                {(['style', 'tone'] as const).map(kind => {
                    const rows = items.filter(r => r.kind === kind);
                    return (
                        <section key={kind} className="flex flex-col" style={{ gap: 6 }}>
                            <h3 className="px-1" style={{ margin: 0, fontFamily: FONT.heading, fontSize: 15, fontWeight: 600 }}>{PRESET_KIND_LABEL[kind]}（{rows.length}）</h3>
                            {rows.length === 0 ? (
                                <p className="px-1" style={{ margin: 0, fontSize: 13, color: F.textTertiary }}>{kind === 'style' ? '番外新建时从这里选文风。' : '番外和见面的相处底色，比如细水共渡、势均力敌。见面设置里给每个角色选一个默认的。'}</p>
                            ) : (
                                <div style={card}>
                                    {rows.map((r, i) => (
                                        <button key={r.id} type="button" onClick={() => setEditing(r)} className="relative w-full flex items-center text-left active:opacity-60"
                                            style={{ gap: 12, padding: '10px 14px', minHeight: 52, background: 'transparent', border: 'none' }}>
                                            {i > 0 && <span aria-hidden className="absolute top-0 right-0" style={{ left: 14, height: 1, background: F.divider }} />}
                                            <span className="flex-1 min-w-0">
                                                <span className="block truncate" style={{ fontSize: 15 }}>{r.name}</span>
                                                <span className="block truncate" style={{ fontSize: 12, color: F.textTertiary }}>{[r.source, `${r.text.length} 字`].filter(Boolean).join(' · ')}</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })}
            </main>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />

            <ClayDialog isOpen={!!editing} title={editing?.id ? '改一条' : '手贴一条'} onClose={() => setEditing(null)}
                footer={<div className="flex" style={{ gap: 8 }}>
                    {editing?.id && (
                        <button type="button" onClick={() => { removePresetItem(editing.id!); setEditing(null); }} className="flex-1 active:opacity-60"
                            style={{ ...primary, background: F.surfaceSunken, color: STATUS.danger.main }}>删掉</button>
                    )}
                    <button type="button" disabled={!editing?.name?.trim() || !editing?.text?.trim()} className="flex-1 active:opacity-80 disabled:opacity-40" style={primary}
                        onClick={() => { if (!editing) return; savePresetItem({ id: editing.id, kind: editing.kind, name: editing.name || '', text: editing.text || '', source: editing.source }); setEditing(null); }}>存下</button>
                </div>}>
                <div className="flex flex-col" style={{ gap: 10 }}>
                    <Segmented<PresetItemKind> standalone label="用途" value={editing?.kind || 'style'} onChange={v => setEditing(e => e && { ...e, kind: v })}
                        options={[{ value: 'style', label: '文风' }, { value: 'tone', label: '基调' }]} />
                    <input value={editing?.name || ''} onChange={e => setEditing(v => v && { ...v, name: e.target.value })} aria-label="名字" placeholder="名字"
                        style={{ ...area, height: 44, resize: undefined }} />
                    <textarea value={editing?.text || ''} onChange={e => setEditing(v => v && { ...v, text: e.target.value })} rows={9} aria-label="全文" placeholder="全文" style={area} />
                    <p style={{ margin: 0, fontSize: 12, lineHeight: '17px', color: F.textTertiary }}>里面的 {'{{user}}'} {'{{char}}'} 会换成名字，{'{{random::甲::乙}}'} 每次随机抽一个。</p>
                </div>
            </ClayDialog>
        </div>
    );
};

export default PresetLibraryPage;
// [EM-END: preset-library]
