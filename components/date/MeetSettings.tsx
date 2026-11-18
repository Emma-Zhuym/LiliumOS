// [EM-START: meet-redesign]
/**
 * 见面设置（2026-11-17 阿萌：设置页很乱，梳理一下）。契约见 docs/spec-meet-redesign.md「设置页」。
 *
 * 替掉上游 DateSettings：四组 —— 怎么写 / 立绘与背景 / 表情立绘 / 观测协议。
 * 改了就存，没有「保存」按钮；立绘位置滑块停手 400ms 存一次。
 * 零件借设置子页那套（components/settings/SettingsParts），颜色跟着设置走。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, Check, Plus } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { CharacterProfile, DateStyleConfig, SkinSet, SpriteConfig } from '../../types';
import { F, FONT, R, STATUS, iconButtonBare } from '../../utils/clayTokens';
import { processImageToBlob } from '../../utils/file';
import { putImageBlob, useBlobRefUrl } from '../../utils/blobRef';
import { DATE_WRITING_STYLE_PRESETS } from '../../utils/dateWritingStyle';
import { pickDateFallbackSprite } from '../../utils/dateSprites';
import { REQUIRED_DATE_EMOTIONS } from '../../utils/datePrompts';
import { isMeetLongform } from '../../utils/emMeetLongform';
import { MEET_LONGFORM_LENGTHS, meetExtraPatch, meetExtraText, meetLongformLength, meetStyleKey, meetStylePatch, type MeetLongformLength } from '../../utils/emMeetStyle';
import ClayDialog from '../os/ClayDialog';
import TokenImg from '../os/TokenImg';
import { FieldRow, Group, InlineAction, Page, Row, Segmented, ToggleRow } from '../settings/SettingsParts';
import { SETTINGS_HUE as P } from '../settings/SettingsHome';
import ObserveSettings from './ObserveSettings';
import { usePresetItems } from '../meetExtra/PresetLibraryPage'; // [EM: preset-library]

const DEFAULT_SPRITE_CONFIG: SpriteConfig = { scale: 1, x: 0, y: 0 };

const POV_LABEL: Record<string, string> = { default: '默认', 'third-name': '第三人称 · 叫名字', 'third-you': '第三人称 · 称「你」', 'first-you': '我和你' };

const DialogRow: React.FC<{ on?: boolean; title: React.ReactNode; sub?: React.ReactNode; danger?: boolean; onClick: () => void }> = ({ on, title, sub, danger, onClick }) => (
    <button type="button" onClick={onClick} className="w-full flex items-center text-left active:opacity-60 transition-opacity"
        style={{ minHeight: 52, gap: 12, padding: '8px 14px', borderRadius: R.button, border: 'none', background: on ? F.surface : F.surfaceSunken, color: danger ? STATUS.danger.ink : F.textPrimary }}>
        <span className="flex-1 min-w-0" style={{ fontSize: 15, lineHeight: '21px', fontWeight: on ? 600 : 400 }}>
            {title}
            {sub && <span className="block" style={{ fontSize: 12, lineHeight: '17px', color: F.textTertiary, fontWeight: 400, marginTop: 1 }}>{sub}</span>}
        </span>
        {on && <Check size={18} weight="bold" color={P.main} className="shrink-0" />}
    </button>
);

const SliderRow: React.FC<{ label: string; value: number; min: number; max: number; step: number; shown: string; onChange: (v: number) => void }> = ({ label, value, min, max, step, shown, onChange }) => (
    <label className="flex items-center" style={{ gap: 12, padding: '10px 14px', minHeight: 52 }}>
        <span style={{ width: 64, fontSize: 15, color: F.textPrimary }}>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
            className="flex-1 min-w-0" style={{ accentColor: P.main }} />
        <span style={{ width: 44, textAlign: 'right', fontSize: 14, color: F.textTertiary, fontVariantNumeric: 'tabular-nums' }}>{shown}</span>
    </label>
);

interface Props {
    char: CharacterProfile;
    onBack: () => void;
}

const MeetSettings: React.FC<Props> = ({ char, onBack }) => {
    const { updateCharacter, addToast, userProfile } = useOS();
    const longform = isMeetLongform(char);
    const fileRef = useRef<HTMLInputElement>(null);
    const uploadTarget = useRef<{ kind: 'bg' } | { kind: 'sprite'; key: string }>({ kind: 'bg' });

    const [picker, setPicker] = useState<'style' | 'pov' | 'skin' | 'tone' | null>(null);
    const tones = usePresetItems('tone'); // [EM: preset-library]
    const tone = tones.find(t => t.id === char.meetToneId);
    const [tile, setTile] = useState<string | null>(null);
    const [tileUrl, setTileUrl] = useState('');
    const [newSkin, setNewSkin] = useState('');
    const [newEmotion, setNewEmotion] = useState('');
    const [spriteOpen, setSpriteOpen] = useState(!longform);

    // ── 怎么写 ──
    const styleKey = meetStyleKey(char);
    const stylePreset = DATE_WRITING_STYLE_PRESETS.find(p => p.key === styleKey);
    const pov = char.dateStyleConfig?.pov;
    const patchStyle = (patch: Partial<DateStyleConfig>) => updateCharacter(char.id, { dateStyleConfig: { ...(char.dateStyleConfig || {}), ...patch } });

    // ── 立绘位置：本地跟手，停手 400ms 存 ──
    const [spriteCfg, setSpriteCfg] = useState<SpriteConfig>(char.spriteConfig || DEFAULT_SPRITE_CONFIG);
    useEffect(() => { setSpriteCfg(char.spriteConfig || DEFAULT_SPRITE_CONFIG); }, [char.id]);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestCfg = useRef(spriteCfg);
    const moveSprite = (patch: Partial<SpriteConfig>) => {
        const next = { ...latestCfg.current, ...patch };
        latestCfg.current = next;
        setSpriteCfg(next);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { saveTimer.current = null; updateCharacter(char.id, { spriteConfig: latestCfg.current }); }, 400);
    };
    useEffect(() => () => {
        if (saveTimer.current) { clearTimeout(saveTimer.current); updateCharacter(char.id, { spriteConfig: latestCfg.current }); }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 表情立绘：格子改的是正在用的那套（默认或某套皮肤） ──
    const skins = char.dateSkinSets || [];
    const activeSkin = skins.find(s => s.id === char.activeSkinSetId) || null;
    const customEmotions = char.customDateSprites || [];
    const emotions = [...REQUIRED_DATE_EMOTIONS, ...customEmotions];
    const sprites: Record<string, string> = activeSkin ? activeSkin.sprites : (char.sprites || {});
    const previewSprite = useMemo(() => {
        const pool = activeSkin && Object.keys(activeSkin.sprites).length > 0 ? activeSkin.sprites : (char.sprites || {});
        return pickDateFallbackSprite(pool, emotions, char.avatar);
    }, [activeSkin, char.sprites, char.avatar, emotions.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
    const bgUrl = useBlobRefUrl(char.dateBackground);

    const setSprite = (key: string, value: string | undefined) => {
        if (activeSkin) {
            const nextSprites = { ...activeSkin.sprites };
            if (value) nextSprites[key] = value; else delete nextSprites[key];
            updateCharacter(char.id, { dateSkinSets: skins.map(s => s.id === activeSkin.id ? { ...s, sprites: nextSprites } : s) });
        } else {
            const nextSprites = { ...(char.sprites || {}) };
            if (value) nextSprites[key] = value; else delete nextSprites[key];
            updateCharacter(char.id, { sprites: nextSprites });
        }
    };

    const pickFile = (target: typeof uploadTarget.current) => {
        uploadTarget.current = target;
        fileRef.current?.click();
    };
    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const target = uploadTarget.current;
        try {
            if (target.kind === 'bg') {
                // 背景要原画质；立绘照旧压到长边 1200（见上游 DateSettings 的说明）
                const ref = await putImageBlob(await processImageToBlob(file, { skipCompression: true }));
                updateCharacter(char.id, { dateBackground: ref });
                addToast('背景换好了', 'success');
            } else {
                const ref = await putImageBlob(await processImageToBlob(file));
                setSprite(target.key, ref);
                addToast(`${target.key} 换好了`, 'success');
                setTile(null);
            }
        } catch (err: any) {
            addToast(err?.message || '图片没存上，再试一次', 'error');
        } finally {
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const saveTileUrl = () => {
        const url = tileUrl.trim();
        if (!tile) return;
        if (!/^https?:\/\//.test(url)) { addToast('网址要以 http:// 或 https:// 开头', 'error'); return; }
        setSprite(tile, url);
        setTileUrl('');
        setTile(null);
        addToast(`${tile} 换好了`, 'success');
    };

    const addEmotion = () => {
        const key = newEmotion.trim().toLowerCase().replace(/\s+/g, '_');
        if (!key) return;
        if (emotions.includes(key)) { addToast('已经有这个情绪了', 'error'); return; }
        if (key === 'chibi') { addToast('chibi 留给 Q 版形象，换个名字', 'error'); return; }
        updateCharacter(char.id, { customDateSprites: [...customEmotions, key] });
        setNewEmotion('');
    };
    const removeEmotion = (key: string) => {
        const nextSprites = { ...(char.sprites || {}) };
        delete nextSprites[key];
        updateCharacter(char.id, {
            customDateSprites: customEmotions.filter(k => k !== key),
            sprites: nextSprites,
            dateSkinSets: skins.map(s => { const sp = { ...s.sprites }; delete sp[key]; return { ...s, sprites: sp }; }),
        });
        setTile(null);
    };

    const createSkin = () => {
        const name = newSkin.trim();
        if (!name) return;
        if (skins.some(s => s.name === name)) { addToast('已经有同名的了', 'error'); return; }
        const skin: SkinSet = { id: `skin_${Date.now()}`, name, sprites: {} };
        updateCharacter(char.id, { dateSkinSets: [...skins, skin], activeSkinSetId: skin.id });
        setNewSkin('');
    };
    const deleteSkin = (id: string) => {
        updateCharacter(char.id, { dateSkinSets: skins.filter(s => s.id !== id), ...(char.activeSkinSetId === id ? { activeSkinSetId: undefined } : {}) });
    };

    const tileIsCustom = !!tile && customEmotions.includes(tile);

    return (
        <div className="h-full w-full flex flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
            <header className="relative shrink-0 flex items-center" style={{ paddingTop: 'var(--chrome-top)', paddingLeft: 4, paddingRight: 4, minHeight: 52 }}>
                <button type="button" aria-label="返回" onClick={onBack} className="grid place-items-center active:opacity-40 transition-opacity" style={{ ...iconButtonBare, color: F.textPrimary }}>
                    <CaretLeft size={22} weight="bold" />
                </button>
                <h1 className="absolute left-1/2 -translate-x-1/2" style={{ margin: 0, bottom: 12, fontFamily: FONT.heading, ...FONT.navTitle }}>见面设置</h1>
            </header>

            <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ padding: '8px 16px calc(32px + var(--safe-bottom))' }}>
                <Page>
                    <Group title="怎么写" foot="改完从下一条回复开始生效。">
                        <Segmented label="呈现方式" value={longform ? 'longform' : 'sprite'}
                            options={[{ value: 'longform', label: '长文' }, { value: 'sprite', label: '立绘' }]}
                            onChange={v => updateCharacter(char.id, { dateSpriteMode: v === 'sprite' ? true : undefined })} />
                        {longform && (
                            <Row title="每轮篇幅" sub={`${MEET_LONGFORM_LENGTHS[meetLongformLength(char)].words}，${MEET_LONGFORM_LENGTHS[meetLongformLength(char)].paragraphs}`}
                                right={<span style={{ width: 150 }}><Segmented<MeetLongformLength> standalone label="每轮篇幅" value={meetLongformLength(char)}
                                    options={(['short', 'medium', 'long'] as const).map(v => ({ value: v, label: MEET_LONGFORM_LENGTHS[v].label }))}
                                    onChange={v => updateCharacter(char.id, { dateLongformLength: v === 'medium' ? undefined : v })} /></span>} />
                        )}
                        <Row title="写作风格" sub={stylePreset?.desc} value={stylePreset?.label || '默认'} onClick={() => setPicker('style')} />
                        <Row title="相处基调" sub={tone ? undefined : tones.length ? '从素材库里选一个，番外也默认用它' : '先在番外的「文风和基调」里导入'} value={tone?.name || '不指定'} onClick={() => setPicker('tone')} />
                        <Row title="叙事人称" sub={!pov && longform ? '长文下按「我看着你」写' : undefined} value={POV_LABEL[pov || 'default']} onClick={() => setPicker('pov')} />
                        <ToggleRow title="细节深挖" sub="每轮给 TA 一条不同的聚焦线索，少说空话" checked={char.dateStyleConfig?.digDeeper !== false}
                            onChange={on => patchStyle({ digDeeper: on ? undefined : false })} />
                        <FieldRow label="补充要求（可选，原样用上，比风格优先）" multiline value={meetExtraText(char)}
                            placeholder="比如：多写环境；对话多一些……"
                            onCommit={v => updateCharacter(char.id, meetExtraPatch(char, v))} />
                    </Group>

                    <Group title="立绘与背景" foot={longform ? '长文模式里立绘铺满整屏，不用背景和位置。' : undefined}>
                        {longform && !spriteOpen ? (
                            <Row title="立绘模式才用得上" value="展开" onClick={() => setSpriteOpen(true)} />
                        ) : (
                            <>
                                <div className="relative overflow-hidden" style={{ height: 220, background: F.textPrimary }}>
                                    {bgUrl && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bgUrl}")`, opacity: 0.6 }} />}
                                    <div className="absolute inset-0 flex items-end justify-center pointer-events-none">
                                        <TokenImg value={previewSprite} className="max-h-[90%] object-contain"
                                            style={{ transform: `translate(${spriteCfg.x}%, ${spriteCfg.y}%) scale(${spriteCfg.scale})` }} />
                                    </div>
                                </div>
                                <SliderRow label="大小" min={0.5} max={2} step={0.1} value={spriteCfg.scale} shown={`${spriteCfg.scale.toFixed(1)}×`} onChange={v => moveSprite({ scale: v })} />
                                <SliderRow label="左右" min={-100} max={100} step={5} value={spriteCfg.x} shown={`${spriteCfg.x}%`} onChange={v => moveSprite({ x: v })} />
                                <SliderRow label="上下" min={-50} max={50} step={5} value={spriteCfg.y} shown={`${spriteCfg.y}%`} onChange={v => moveSprite({ y: v })} />
                                <Row title="背景图" value={char.dateBackground ? '换一张' : '上传'} onClick={() => pickFile({ kind: 'bg' })} />
                            </>
                        )}
                    </Group>

                    <Group title="表情立绘" foot="TA 每段开头标的情绪决定用哪张；两种模式都用。点一格换图。">
                        <Row title="正在用" value={activeSkin?.name || '默认立绘'} onClick={() => setPicker('skin')} />
                        <div className="grid grid-cols-3" style={{ gap: 10, padding: 14 }}>
                            {emotions.map(key => (
                                <button key={key} type="button" onClick={() => { setTile(key); setTileUrl(''); }} className="flex flex-col items-center active:opacity-60 transition-opacity"
                                    style={{ gap: 6, background: 'transparent', border: 'none', padding: 0 }}>
                                    <span className="w-full grid place-items-center overflow-hidden" style={{ aspectRatio: '3 / 4', borderRadius: R.smallCard, background: F.surfaceSunken, border: `1px solid ${F.borderSoft}` }}>
                                        {sprites[key]
                                            ? <TokenImg value={sprites[key]} className="w-full h-full object-cover" />
                                            : <Plus size={20} weight="bold" color={F.textTertiary} />}
                                    </span>
                                    <span className="w-full truncate" style={{ fontSize: 13, color: F.textSecondary }}>{key}</span>
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center" style={{ gap: 8, padding: '10px 14px 12px' }}>
                            <input value={newEmotion} onChange={e => setNewEmotion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addEmotion(); }}
                                aria-label="加一种情绪" placeholder="加一种情绪（英文，比如 scared）" className="flex-1 min-w-0 outline-none" autoCapitalize="off"
                                style={{ height: 40, padding: '0 12px', borderRadius: R.input, border: 'none', background: F.surfaceSunken, fontSize: 15, color: F.textPrimary }} />
                            <InlineAction onClick={addEmotion} disabled={!newEmotion.trim()}>添加</InlineAction>
                        </div>
                    </Group>

                    <ObserveSettings char={char} />
                </Page>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            </main>

            <ClayDialog isOpen={picker === 'style'} title="写作风格" onClose={() => setPicker(null)}>
                <div className="flex flex-col" style={{ gap: 6 }}>
                    <DialogRow on={!styleKey} title="默认" sub="不加风格，只守五条底线" onClick={() => { updateCharacter(char.id, meetStylePatch(char, undefined)); setPicker(null); }} />
                    {DATE_WRITING_STYLE_PRESETS.map(p => (
                        <DialogRow key={p.key} on={styleKey === p.key} title={p.label} sub={p.desc}
                            onClick={() => { updateCharacter(char.id, meetStylePatch(char, p.key)); setPicker(null); }} />
                    ))}
                </div>
            </ClayDialog>

            <ClayDialog isOpen={picker === 'tone'} title="相处基调" onClose={() => setPicker(null)}>
                <div className="flex flex-col" style={{ gap: 6 }}>
                    <DialogRow on={!tone} title="不指定" onClick={() => { updateCharacter(char.id, { meetToneId: undefined }); setPicker(null); }} />
                    {tones.map(t => (
                        <DialogRow key={t.id} on={tone?.id === t.id} title={t.name} sub={t.source}
                            onClick={() => { updateCharacter(char.id, { meetToneId: t.id }); setPicker(null); }} />
                    ))}
                    {!tones.length && <p style={{ margin: '6px 4px 0', fontSize: 13, lineHeight: '20px', color: F.textTertiary }}>素材库里还没有基调。见面 → 番外 → 书架底下「文风和基调」→ 从酒馆预设导入。</p>}
                </div>
            </ClayDialog>

            <ClayDialog isOpen={picker === 'pov'} title="叙事人称" onClose={() => setPicker(null)}>
                <div className="flex flex-col" style={{ gap: 6 }}>
                    {([undefined, 'third-name', 'third-you', 'first-you'] as const).map(v => (
                        <DialogRow key={v || 'default'} on={pov === v} title={POV_LABEL[v || 'default']}
                            sub={v === 'third-name' ? `${char.name}看着${userProfile?.name || '你'}` : v === 'third-you' ? `${char.name}看着你` : v === 'first-you' ? '我看着你' : (longform ? '长文下按「我看着你」写' : '不指定')}
                            onClick={() => { patchStyle({ pov: v }); setPicker(null); }} />
                    ))}
                </div>
            </ClayDialog>

            <ClayDialog isOpen={picker === 'skin'} title="立绘皮肤" onClose={() => setPicker(null)}>
                <div className="flex flex-col" style={{ gap: 6 }}>
                    <DialogRow on={!activeSkin} title="默认立绘" onClick={() => { updateCharacter(char.id, { activeSkinSetId: undefined }); setPicker(null); }} />
                    {skins.map(s => (
                        <div key={s.id} className="flex items-center" style={{ gap: 6 }}>
                            <div className="flex-1 min-w-0">
                                <DialogRow on={activeSkin?.id === s.id} title={s.name} sub={`${Object.keys(s.sprites).length} 张`}
                                    onClick={() => { updateCharacter(char.id, { activeSkinSetId: s.id }); setPicker(null); }} />
                            </div>
                            <button type="button" onClick={() => deleteSkin(s.id)} className="shrink-0 active:opacity-40"
                                style={{ height: 52, padding: '0 10px', background: 'transparent', border: 'none', color: STATUS.danger.ink, fontSize: 14 }}>删除</button>
                        </div>
                    ))}
                    <div className="flex items-center" style={{ gap: 8, marginTop: 6 }}>
                        <input value={newSkin} onChange={e => setNewSkin(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createSkin(); }}
                            placeholder="新皮肤名字（冬装、泳装…）" className="flex-1 min-w-0 outline-none"
                            style={{ height: 44, padding: '0 12px', borderRadius: R.input, border: 'none', background: F.surfaceSunken, fontSize: 15, color: F.textPrimary }} />
                        <InlineAction onClick={createSkin} disabled={!newSkin.trim()}>新建</InlineAction>
                    </div>
                </div>
            </ClayDialog>

            <ClayDialog isOpen={!!tile} title={tile ? `${tile}${activeSkin ? ` · ${activeSkin.name}` : ''}` : ''} onClose={() => setTile(null)}>
                <div className="flex flex-col" style={{ gap: 8 }}>
                    <DialogRow title="从相册选一张" onClick={() => tile && pickFile({ kind: 'sprite', key: tile })} />
                    <div className="flex items-center" style={{ gap: 8 }}>
                        <input value={tileUrl} onChange={e => setTileUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveTileUrl(); }}
                            placeholder="或者贴图片网址 https://…" className="flex-1 min-w-0 outline-none" inputMode="url"
                            style={{ height: 44, padding: '0 12px', borderRadius: R.input, border: 'none', background: F.surfaceSunken, fontSize: 15, color: F.textPrimary }} />
                        <InlineAction onClick={saveTileUrl} disabled={!tileUrl.trim()}>用这张</InlineAction>
                    </div>
                    {tile && sprites[tile] && <DialogRow title="去掉这张图" danger onClick={() => { setSprite(tile, undefined); setTile(null); }} />}
                    {tileIsCustom && <DialogRow title="删掉这种情绪" danger onClick={() => tile && removeEmotion(tile)} />}
                </div>
            </ClayDialog>
        </div>
    );
};

export default MeetSettings;
// [EM-END: meet-redesign]
