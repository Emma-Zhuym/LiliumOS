import React, { useEffect, useRef, useState } from 'react';
import { CaretLeft, Shuffle, Sparkle } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { F, R, S, HUE, STATUS } from '../../../utils/clayTokens';
import type { StoryVariantIdentityCard, StoryVariantSimulationRun, StoryVariantRecord } from '../../../types';
import { STORY_VARIANT_OPTIONS, STORY_WORLD_OPTIONS, getStoryVariantOption, randomStoryVariantCombination } from '../../../utils/storyVariantCatalog';
import { generateStoryVariantCard } from '../../../utils/storyVariant';
import { StoryVariantStore } from '../../../utils/storyVariantStore';
import StoryVariantSession from './StoryVariantSession';

export const variantCardStyle = { background: F.surface, borderRadius: R.bigCard, boxShadow: S.raisedSoft, color: F.textPrimary };
export const variantButtonStyle = { minHeight: 44, borderRadius: R.button, background: F.surface, boxShadow: S.raisedSoft, color: F.textPrimary, border: `1px solid ${F.borderSoft}` };
export const variantInputStyle = { minHeight: 44, borderRadius: R.input, background: F.surfaceSunken, boxShadow: S.sunken, color: F.textPrimary, border: 0 };

export default function StoryVariantHub({ onBack }: { onBack: () => void }) {
    const { characters, activeCharacterId, apiConfig, apiPresets, userProfile, registerBackHandler } = useOS();
    const [charId, setCharId] = useState(activeCharacterId || characters[0]?.id || '');
    const [combination, setCombination] = useState({ variantId: STORY_VARIANT_OPTIONS[0].id, storyId: STORY_WORLD_OPTIONS[0].id });
    const [records, setRecords] = useState<StoryVariantRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState('');
    const [pendingCard, setPendingCard] = useState<StoryVariantIdentityCard | null>(null);
    const [active, setActive] = useState<{ card: StoryVariantIdentityCard; run: StoryVariantSimulationRun } | null>(null);
    const char = characters.find(item => item.id === charId);
    const cards = records.filter((row): row is StoryVariantIdentityCard => row.kind === 'card').sort((a, b) => b.createdAt - a.createdAt);
    const runs = records.filter((row): row is StoryVariantSimulationRun => row.kind === 'run').sort((a, b) => b.updatedAt - a.updatedAt);
    const reload = async () => { setLoading(true); try { setRecords(await StoryVariantStore.list()); setError(''); } catch (reason: any) { setError(reason?.message || '读取异格存档失败'); } finally { setLoading(false); } };
    useEffect(() => { void reload(); }, []);
    useEffect(() => registerBackHandler(() => { if (!active) { if (!busyRef.current && !pendingCard) onBack(); return true; } return false; }), [registerBackHandler, onBack, active, pendingCard]);

    const saveCard = async (card: StoryVariantIdentityCard) => {
        await StoryVariantStore.saveCard(card);
        setPendingCard(null);
        setRecords(current => [card, ...current.filter(item => item.id !== card.id)]);
    };
    const create = async () => {
        if (!char || busyRef.current || pendingCard) return;
        busyRef.current = true; setBusy(true); setError('');
        let generated: StoryVariantIdentityCard | null = null;
        try {
            generated = await generateStoryVariantCard({ char, userProfile, apiConfig, apiPresets, ...combination });
            setPendingCard(generated);
            await saveCard(generated);
        } catch (reason: any) { setError(`${generated ? '身份已生成，保存失败；可重试保存，不再请求模型。' : ''}${reason?.message || '创建失败'}`); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const retrySave = async () => {
        if (!pendingCard || busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try { await saveCard(pendingCard); } catch (reason: any) { setError(`尚未保存：${reason?.message || '请重试'}`); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const start = async (card: StoryVariantIdentityCard) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try { setActive({ card, run: await StoryVariantStore.start(card.id) }); }
        catch (reason: any) { setError(reason?.message || '故事未能保存'); }
        finally { busyRef.current = false; setBusy(false); }
    };
    if (active) return <StoryVariantSession key={active.run.id} card={active.card} initialRun={active.run} onBack={() => { setActive(null); void reload(); }} />;

    return <div className="flex h-full min-h-0 flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
        <header className="relative flex shrink-0 items-center justify-between px-4 pb-3" style={{ paddingTop: 'var(--chrome-top)' }}>
            <button aria-label="返回剧情" disabled={busy || !!pendingCard} onClick={onBack} className="grid h-11 w-11 place-items-center disabled:opacity-40" style={{ ...variantButtonStyle, borderRadius: R.pill }}><CaretLeft size={20} weight="bold" /></button>
            <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold">异格</h1>
            <span className="grid h-11 w-11 place-items-center" style={{ color: HUE.violet.ink }}><Sparkle size={22} /></span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(2rem,var(--safe-bottom))]">
            <div className="mx-auto max-w-2xl space-y-5">
                <p className="py-3 text-sm leading-relaxed" style={{ color: F.textSecondary }}>换一种人生，进入另一个世界。人格分岔和世界都可直接选择；随机只替你挑组合。</p>
                <section className="space-y-4 p-5" style={variantCardStyle}>
                    <label className="block text-sm font-semibold">角色<select aria-label="异格角色" disabled={busy || !!pendingCard} value={charId} onChange={event => setCharId(event.target.value)} className="mt-2 w-full px-3" style={variantInputStyle}><option value="" disabled>选择角色</option>{characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    {(['variant', 'story'] as const).map(pool => {
                        const key = pool === 'variant' ? 'variantId' : 'storyId';
                        const options = pool === 'variant' ? STORY_VARIANT_OPTIONS : STORY_WORLD_OPTIONS;
                        return <label key={pool} className="block text-sm font-semibold">{pool === 'variant' ? '人格分岔' : '世界背景'}<select aria-label={pool === 'variant' ? '人格分岔' : '世界背景'} disabled={busy || !!pendingCard} value={combination[key]} onChange={event => setCombination(current => ({ ...current, [key]: event.target.value }))} className="mt-2 w-full px-3" style={variantInputStyle}>{options.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}</select><span className="mt-2 block text-xs font-normal leading-relaxed" style={{ color: F.textSecondary }}>{getStoryVariantOption(combination[key])?.summary}</span></label>;
                    })}
                    <div className="flex flex-wrap gap-3">
                        <button disabled={busy || !!pendingCard} onClick={() => setCombination(randomStoryVariantCombination())} className="flex items-center justify-center gap-2 px-4 text-sm disabled:opacity-40" style={variantButtonStyle}><Shuffle size={18} />随机组合</button>
                        <button disabled={busy || !char || !!pendingCard || loading} onClick={() => void create()} className="flex-1 px-4 text-sm font-semibold disabled:opacity-40" style={{ ...variantButtonStyle, background: HUE.violet.tint, color: HUE.violet.ink }}>{busy ? '正在创建…' : '创建异格身份'}</button>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: F.textTertiary }}>创建身份请求一次模型。每次互动再请求一次，最多 50 轮，也可提前封存。故事独立保存，由你决定是否分享回私聊。</p>
                </section>
                {error && <p role="alert" className="rounded-2xl p-4 text-sm" style={{ background: STATUS.danger.tint, color: STATUS.danger.ink }}>{error}</p>}
                {pendingCard && <section className="space-y-3 p-5" style={variantCardStyle}><h2 className="font-semibold">{pendingCard.profile.title} · 尚未保存</h2><p className="text-sm leading-relaxed">{pendingCard.profile.identity}</p><p className="text-xs" style={{ color: F.textSecondary }}>结果暂存在当前页面，保存成功前请保留页面。</p><button disabled={busy} onClick={() => void retrySave()} className="w-full px-4 text-sm" style={variantButtonStyle}>重试保存</button></section>}
                {loading ? <p className="py-5 text-center text-sm">读取存档中…</p> : <>
                    <h2 className="pt-2 text-base font-semibold">收藏的身份</h2>
                    {!cards.length && <p className="flex items-start gap-2 p-4 text-sm" style={{ ...variantInputStyle, color: F.textSecondary }}><Sparkle size={18} className="shrink-0" />创建的身份会留在这里，可以反复开启新的故事。</p>}
                    {cards.map(card => <details key={card.id} className="p-5" style={variantCardStyle}><summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3"><span className="font-semibold">{card.profile.title}</span><span className="text-xs" style={{ color: F.textSecondary }}>{card.charName}</span></summary><div className="space-y-3 pt-3 text-sm leading-relaxed"><p>{card.profile.identity}</p><p style={{ color: F.textSecondary }}>人生变化：{card.profile.lifePatch}</p><p>人格底线：{card.profile.steelSeal}</p><p>改变的代价：{card.profile.patchCost}</p><p style={{ color: F.textSecondary }}>你的面具：{card.profile.userMaskTitle} · {card.profile.userIdentity}</p><button disabled={busy || !!pendingCard || !characters.some(char => char.id === card.charId)} onClick={() => void start(card)} className="w-full px-4 text-sm font-semibold disabled:opacity-40" style={variantButtonStyle}>开启一段新故事</button></div></details>)}
                    {runs.length > 0 && <h2 className="pt-2 text-base font-semibold">故事记录</h2>}
                    {runs.map(run => { const card = cards.find(item => item.id === run.cardId); return card && <button key={run.id} disabled={busy || !!pendingCard} onClick={() => setActive({ card, run })} className="block w-full p-5 text-left" style={variantCardStyle}><span className="block text-sm font-semibold">{card.profile.title}</span><span className="mt-2 block text-xs" style={{ color: F.textSecondary }}>{run.status === 'archived' ? '已封存' : '继续故事'} · {run.interactionsUsed}/50 轮 · {new Date(run.updatedAt).toLocaleDateString()}</span></button>; })}
                    {error && <button onClick={() => void reload()} className="px-4 text-sm" style={variantButtonStyle}>重新读取存档</button>}
                </>}
            </div>
        </main>
    </div>;
}
