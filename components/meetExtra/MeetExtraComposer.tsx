// [EM-START: meet-extra]
/** 写一篇番外：选谁 → 贴梗概 → 带多少记忆 / 篇幅 / 人称 → 开写。上次的选择按角色记在本机。 */
import React, { useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { F, FONT, R } from '../../utils/clayTokens';
import { resolveCharacterApiConfig } from '../../utils/characterApi';
import { MEET_EXTRA_LENGTHS, MEET_EXTRA_MEMORY, MEET_EXTRA_POV, rollMeetExtraSynopsis, type MeetExtraLength, type MeetExtraMemory, type MeetExtraPov } from '../../utils/meetExtra';
import type { PresetItem } from '../../utils/presetLibrary';
import { usePresetItems } from './PresetLibraryPage';
import { createMeetExtra } from '../../utils/meetExtraActions';
import { Segmented } from '../settings/SettingsParts';
import TokenImg from '../os/TokenImg';
import { ExtraHeader } from './ExtraHeader';

const PREFS_KEY = 'em_meet_extra_prefs_v1';
/** toneId：undefined = 跟角色在见面设置里选的默认基调；'' = 这篇不要基调 */
type Prefs = { memory: MeetExtraMemory; length: MeetExtraLength; pov: MeetExtraPov; styleId?: string; toneId?: string };
const DEFAULT_PREFS: Prefs = { memory: 'together', length: 'medium', pov: 'third' };

const readPrefs = (charId: string): Prefs => {
    try {
        const all = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        return { ...DEFAULT_PREFS, ...(all[charId] || {}) };
    } catch { return DEFAULT_PREFS; }
};
const writePrefs = (charId: string, prefs: Prefs) => {
    try {
        const all = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        localStorage.setItem(PREFS_KEY, JSON.stringify({ ...all, [charId]: prefs }));
    } catch { /* 存不了就下次再选 */ }
};

const Label: React.FC<{ children: React.ReactNode; hint?: React.ReactNode }> = ({ children, hint }) => (
    <div className="flex flex-col" style={{ gap: 2, padding: '0 4px' }}>
        <span style={{ fontSize: 12, color: F.textTertiary, letterSpacing: '.04em' }}>{children}</span>
        {hint && <span style={{ fontSize: 12, lineHeight: '17px', color: F.textTertiary }}>{hint}</span>}
    </div>
);

/** 素材库里的一排（不指定 + 各条），选中白块；多了横着滚 */
const ChipRow: React.FC<{ items: PresetItem[]; value: string; onChange: (id: string) => void; emptyLabel: string; label: string }> = ({ items, value, onChange, emptyLabel, label }) => (
    <div role="radiogroup" aria-label={label} className="flex overflow-x-auto no-scrollbar" style={{ gap: 4, padding: 2, background: F.surfaceSunken, borderRadius: R.medium }}>
        {[{ id: '', name: emptyLabel }, ...items].map(item => {
            const on = value === item.id;
            return (
                <button key={item.id || 'none'} type="button" role="radio" aria-checked={on} onClick={() => onChange(item.id)} className="shrink-0"
                    style={{ height: 32, padding: '0 14px', borderRadius: R.small, border: 'none', fontSize: 14, background: on ? F.surface : 'transparent', color: on ? F.textPrimary : F.textSecondary, fontWeight: on ? 600 : 400 }}>
                    {item.name}
                </button>
            );
        })}
    </div>
);

const area: React.CSSProperties = {
    width: '100%', borderRadius: R.input, border: '1px solid transparent', background: F.surfaceSunken, color: F.textPrimary,
    fontSize: 15, lineHeight: '23px', padding: '12px 14px', outline: 'none', resize: 'vertical',
};

const MeetExtraComposer: React.FC<{ initialCharId?: string; onBack: () => void; onStarted: (id: string) => void; onOpenLibrary: () => void }> = ({ initialCharId, onBack, onStarted, onOpenLibrary }) => {
    const { characters, userProfile, apiConfig, addToast } = useOS();
    const [charId, setCharId] = useState(initialCharId || characters[0]?.id || '');
    const [synopsis, setSynopsis] = useState('');
    const [extra, setExtra] = useState('');
    const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(charId));
    const [busy, setBusy] = useState(false);
    const styles = usePresetItems('style');
    const tones = usePresetItems('tone');
    useEffect(() => { setPrefs(readPrefs(charId)); }, [charId]);
    const char = characters.find(c => c.id === charId);
    const styleId = styles.some(s => s.id === prefs.styleId) ? prefs.styleId! : '';
    const rawTone = prefs.toneId === undefined ? (char?.meetToneId || '') : prefs.toneId;
    const toneId = tones.some(t => t.id === rawTone) ? rawTone : '';

    const setPref = (patch: Partial<Prefs>) => {
        const next = { ...prefs, ...patch };
        setPrefs(next);
        if (charId) writePrefs(charId, next);
    };

    const start = async () => {
        if (!char || !synopsis.trim() || busy) return;
        const { apiConfig: api } = resolveCharacterApiConfig(char, apiConfig);
        if (!api?.baseUrl) { addToast(`${char.name}还没接 API`, 'error'); return; }
        setBusy(true);
        try {
            const row = await createMeetExtra({
                char, user: userProfile, api, synopsis, extra,
                memory: prefs.memory, length: prefs.length, pov: prefs.pov, styleId: styleId || undefined, toneId: toneId || undefined,
            });
            onStarted(row.id);
        } catch (error: any) {
            addToast(error?.message || '没开成，再试一次', 'error');
            setBusy(false);
        }
    };

    return (
        <div className="h-full w-full flex flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
            <ExtraHeader title="写一篇番外" onBack={onBack} />
            <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col" style={{ gap: 20, padding: '4px 16px calc(24px + var(--safe-bottom))' }}>
                <section className="flex flex-col" style={{ gap: 8 }}>
                    <Label>和谁</Label>
                    <div className="flex overflow-x-auto no-scrollbar" style={{ gap: 12, padding: '2px 4px' }}>
                        {characters.map(c => {
                            const on = c.id === charId;
                            return (
                                <button key={c.id} type="button" onClick={() => setCharId(c.id)} aria-pressed={on} className="shrink-0 flex flex-col items-center"
                                    style={{ gap: 6, width: 64, background: 'transparent', border: 'none', padding: 0 }}>
                                    <span className="overflow-hidden" style={{ width: 52, height: 52, borderRadius: R.pill, background: F.surfaceSunken, outline: on ? `2px solid ${F.textPrimary}` : 'none', outlineOffset: 2 }}>
                                        {c.avatar && <TokenImg value={c.avatar} className="w-full h-full object-cover" alt="" />}
                                    </span>
                                    <span className="w-full truncate text-center" style={{ fontSize: 12, color: on ? F.textPrimary : F.textSecondary, fontWeight: on ? 600 : 400 }}>{c.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="flex flex-col" style={{ gap: 8 }}>
                    <div className="flex items-end justify-between">
                        <Label hint="刷到的 AU / 小故事梗概，直接贴进来">梗概</Label>
                        <button type="button" onClick={() => setSynopsis(rollMeetExtraSynopsis())} className="shrink-0 active:opacity-40 transition-opacity"
                            style={{ minHeight: 44, padding: '0 4px', background: 'transparent', border: 'none', fontSize: 14, fontWeight: 500, color: F.textSecondary }}>
                            没想好？抽一个
                        </button>
                    </div>
                    <textarea value={synopsis} onChange={e => setSynopsis(e.target.value)} rows={7} aria-label="梗概"
                        placeholder="比如：民国，他是报社主笔，她是来投稿的女学生。一封退稿信里夹了一张电影票……" style={{ ...area, minHeight: 168 }} />
                </section>

                <section className="flex flex-col" style={{ gap: 8 }}>
                    <Label hint={MEET_EXTRA_MEMORY[prefs.memory].hint}>带多少记忆</Label>
                    <Segmented<MeetExtraMemory> standalone label="带多少记忆" value={prefs.memory} onChange={v => setPref({ memory: v })}
                        options={(['persona', 'together'] as const).map(v => ({ value: v, label: v === 'persona' ? '只带人设' : '带上现在的我们' }))} />
                </section>

                <section className="flex flex-col" style={{ gap: 8 }}>
                    <Label hint={`大约 ${MEET_EXTRA_LENGTHS[prefs.length].min}–${MEET_EXTRA_LENGTHS[prefs.length].max} 字`}>篇幅</Label>
                    <Segmented<MeetExtraLength> standalone label="篇幅" value={prefs.length} onChange={v => setPref({ length: v })}
                        options={(['short', 'medium', 'long'] as const).map(v => ({ value: v, label: MEET_EXTRA_LENGTHS[v].label }))} />
                </section>

                <section className="flex flex-col" style={{ gap: 8 }}>
                    <Label hint={MEET_EXTRA_POV[prefs.pov]}>人称</Label>
                    <Segmented<MeetExtraPov> standalone label="人称" value={prefs.pov} onChange={v => setPref({ pov: v })}
                        options={[{ value: 'third', label: '第三人称' }, { value: 'first', label: '我和你' }, { value: 'second', label: '你' }]} />
                </section>

                <section className="flex flex-col" style={{ gap: 8 }}>
                    <div className="flex items-end justify-between">
                        <Label hint={toneId ? `${tones.find(t => t.id === toneId)?.name}${prefs.toneId === undefined ? '（跟这个角色的默认）' : ''}` : '你们相处的底色，比如细水共渡'}>基调</Label>
                        <button type="button" onClick={onOpenLibrary} className="shrink-0 active:opacity-40"
                            style={{ minHeight: 44, padding: '0 4px', background: 'transparent', border: 'none', fontSize: 14, fontWeight: 500, color: F.textSecondary }}>
                            {styles.length + tones.length ? '管理 / 导入' : '从酒馆预设导入'}
                        </button>
                    </div>
                    <ChipRow label="基调" items={tones} value={toneId} emptyLabel="不指定" onChange={id => setPref({ toneId: id })} />
                </section>

                <section className="flex flex-col" style={{ gap: 8 }}>
                    <Label>文风</Label>
                    <ChipRow label="文风" items={styles} value={styleId} emptyLabel="不指定" onChange={id => setPref({ styleId: id || undefined })} />
                </section>

                <section className="flex flex-col" style={{ gap: 8 }}>
                    <Label>补充要求（可选）</Label>
                    <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={2} aria-label="补充要求" placeholder="比如：结局要甜；多写对话" style={area} />
                </section>

                <button type="button" onClick={() => void start()} disabled={!char || !synopsis.trim() || busy} className="active:opacity-80 disabled:opacity-40"
                    style={{ height: 46, borderRadius: R.button, border: 'none', background: F.textPrimary, color: F.surface, fontSize: 15, fontWeight: 600, fontFamily: FONT.body }}>
                    {busy ? '正在开写…' : `让${char?.name || 'TA'}开写`}
                </button>
            </main>

        </div>
    );
};

export default MeetExtraComposer;
// [EM-END: meet-extra]
