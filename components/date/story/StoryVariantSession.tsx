import { CHAT_GEN_EVENTS } from '../../../utils/chatGenEvents';
import React, { useEffect, useRef, useState } from 'react';
import { CaretLeft, DownloadSimple } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import type { Message, StoryVariantIdentityCard, StoryVariantSimulationRun } from '../../../types';
import { F, R, S, HUE, STATUS } from '../../../utils/clayTokens';
import { StoryVariantStore } from '../../../utils/storyVariantStore';
import { buildStoryVariantArchiveMarkdown, buildStoryVariantCharacterShareText, generateStoryVariantTurn, getStoryVariantArchiveFilename, getStoryVariantSimulationPhase, getStoryVariantWorldNarration } from '../../../utils/storyVariant';
import ClayDialog from '../../os/ClayDialog';

type PendingTurn = Awaited<ReturnType<typeof generateStoryVariantTurn>>;
const buttonStyle = { minHeight: 44, background: F.surface, color: F.textPrimary, borderRadius: R.button, boxShadow: S.raisedSoft, border: `1px solid ${F.borderSoft}` };

export default function StoryVariantSession({ card, initialRun, onBack }: { card: StoryVariantIdentityCard; initialRun: StoryVariantSimulationRun; onBack: () => void }) {
    const { characters, userProfile, apiConfig, apiPresets, registerBackHandler, addToast } = useOS();
    const char = characters.find(item => item.id === card.charId);
    const [run, setRun] = useState(initialRun);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [text, setText] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [pending, setPending] = useState<PendingTurn | null>(null);
    const [confirm, setConfirm] = useState<'archive' | 'share' | null>(null);
    const tail = useRef<HTMLDivElement>(null);
    const refresh = async () => {
        setLoaded(false);
        try { const [latest, rows] = await Promise.all([StoryVariantStore.getRun(run.id), StoryVariantStore.messages(run.id)]); setRun(latest); setMessages(rows); setLoaded(true); }
        catch (reason: any) { setError(reason?.message || '读取正文失败，请重试'); }
    };
    useEffect(() => { void refresh(); }, []);
    useEffect(() => { tail.current?.scrollIntoView({ block: 'end' }); }, [messages.length, pending]);
    useEffect(() => registerBackHandler(() => { if (confirm) setConfirm(null); else if (!busyRef.current && !pending) onBack(); return true; }), [registerBackHandler, onBack, confirm, pending]);
    const persist = async (result: PendingTurn) => {
        const next = await StoryVariantStore.commitTurn(result);
        setRun(next); setPending(null); setText('');
        await refresh();
    };
    const send = async () => {
        if (busyRef.current || pending || !char || !loaded || run.status !== 'active') return;
        busyRef.current = true; setBusy(true); setError('');
        let generated: PendingTurn | null = null;
        try {
            generated = await generateStoryVariantTurn({ card, run, char, userProfile, apiConfig, apiPresets, userText: text });
            setPending(generated); await persist(generated);
        } catch (reason: any) { setError(`${generated ? '正文已生成但未保存。重试保存不会再次请求模型。' : ''}${reason?.message || '本轮未完成'}`); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const retrySave = async () => {
        if (!pending || busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try { await persist(pending); } catch (reason: any) { setError(reason?.message || '尚未保存，请重试'); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const finishAction = async () => {
        if (busyRef.current || !confirm) return;
        busyRef.current = true; setBusy(true); setError('');
        try {
            if (confirm === 'archive') setRun(await StoryVariantStore.archive(run.id));
            else { setRun(await StoryVariantStore.share(run.id, buildStoryVariantCharacterShareText(card, run, messages, userProfile.name))); window.dispatchEvent(new CustomEvent(CHAT_GEN_EVENTS.replyEnd)); addToast('封存简报已分享到私聊', 'success'); }
            setConfirm(null);
        } catch (reason: any) { setError(reason?.message || '操作未完成'); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const download = () => {
        const url = URL.createObjectURL(new Blob([buildStoryVariantArchiveMarkdown(card, run, messages, userProfile.name)], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = getStoryVariantArchiveFilename(card, run); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return <div className="flex h-full min-h-0 flex-col" style={{ background: F.appBg, color: F.textPrimary }}>
        <header className="flex shrink-0 items-center gap-3 px-4 pb-3" style={{ paddingTop: 'var(--chrome-top)' }}>
            <button aria-label="返回异格" disabled={busy || !!pending} onClick={onBack} className="grid h-11 w-11 shrink-0 place-items-center disabled:opacity-40" style={{ ...buttonStyle, borderRadius: R.pill }}><CaretLeft size={20} weight="bold" /></button>
            <div className="min-w-0 flex-1 text-center"><h1 className="truncate text-base font-semibold">{card.profile.title}</h1><p className="mt-1 text-xs" style={{ color: F.textSecondary }}>{run.status === 'archived' ? '已封存' : getStoryVariantSimulationPhase(run.interactionsUsed).label} · {run.interactionsUsed}/50</p></div>
            <button aria-label="下载异格全文" disabled={!loaded || busy || !!pending} onClick={download} className="grid h-11 w-11 shrink-0 place-items-center disabled:opacity-40" style={{ ...buttonStyle, borderRadius: R.pill }}><DownloadSimple size={20} /></button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="mx-auto max-w-2xl space-y-6 text-sm leading-7">
                <div className="space-y-4 p-5" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}><p className="text-xs font-semibold" style={{ color: HUE.violet.ink }}>{card.profile.worldName || '开场'}</p><p className="whitespace-pre-wrap" style={{ color: F.textSecondary }}>{card.profile.openingScene}</p><p className="font-semibold">{card.charName}</p><p className="whitespace-pre-wrap">{card.profile.openingLine}</p></div>
                {messages.map(message => <section key={message.id} className="space-y-3">
                    {message.role === 'assistant' && getStoryVariantWorldNarration(message) && <p className="whitespace-pre-wrap border-l-2 pl-4" style={{ color: F.textSecondary, borderColor: F.borderStrong }}>{getStoryVariantWorldNarration(message)}</p>}
                    <p className="text-xs font-semibold" style={{ color: message.role === 'user' ? HUE.violet.ink : F.textSecondary }}>{message.role === 'user' ? userProfile.name : card.charName}</p><p className="whitespace-pre-wrap break-words">{message.content}</p>
                </section>)}
                {pending && <section className="space-y-3 p-5" style={{ background: STATUS.warning.tint, color: STATUS.warning.ink, borderRadius: R.bigCard }}><p className="font-semibold">这一轮尚未保存</p><p className="whitespace-pre-wrap">{pending.reply.worldNarration}</p><p className="whitespace-pre-wrap">{pending.reply.character}</p><p className="text-xs">保存成功前请保留当前页面。</p><button disabled={busy} onClick={() => void retrySave()} className="w-full px-4" style={buttonStyle}>重试保存</button></section>}
                {error && <p role="alert" className="rounded-2xl p-4" style={{ background: STATUS.danger.tint, color: STATUS.danger.ink }}>{error}</p>}
                {!loaded && <button disabled={busy} onClick={() => void refresh()} className="w-full px-4" style={buttonStyle}>重新读取正文</button>}
                {!char && <p style={{ color: F.textSecondary }}>原角色已不存在，这段故事仍可阅读和下载。</p>}
                <div ref={tail} />
            </div>
        </main>
        <footer className="shrink-0 px-5 pt-3 pb-[max(1rem,var(--safe-bottom))]" style={{ background: F.appBg }}>
            <div className="mx-auto max-w-2xl space-y-3">
                {run.status === 'active' ? <>
                    <textarea aria-label="异格中的言语或行动" disabled={busy || !!pending || !char || !loaded} maxLength={4000} value={text} onChange={event => setText(event.target.value)} placeholder="说一句话，或写下你的行动…" rows={2} className="w-full resize-none px-4 py-3 text-base disabled:opacity-50" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken, color: F.textPrimary }} />
                    <div className="flex gap-3"><button disabled={busy || !!pending || !loaded} onClick={() => setConfirm('archive')} className="px-4 text-sm disabled:opacity-40" style={buttonStyle}>提前封存</button><button disabled={busy || !!pending || !text.trim() || !char || !loaded} onClick={() => void send()} className="flex-1 px-4 text-sm font-semibold disabled:opacity-40" style={{ ...buttonStyle, background: HUE.violet.tint, color: HUE.violet.ink }}>{busy ? '正在续写…' : '继续故事'}</button></div>
                </> : <button disabled={busy || !loaded || !char || !!run.sharedAt} onClick={() => setConfirm('share')} className="w-full px-4 text-sm font-semibold disabled:opacity-40" style={buttonStyle}>{run.sharedAt ? '已分享到私聊' : '分享封存简报到私聊'}</button>}
            </div>
        </footer>
        <ClayDialog isOpen={confirm !== null} title={confirm === 'share' ? '分享封存简报' : '提前封存'} onClose={() => { if (!busy) setConfirm(null); }} footer={<button disabled={busy} onClick={() => void finishAction()} className="w-full px-4 text-sm font-semibold" style={buttonStyle}>{busy ? '保存中…' : '确认'}</button>}><p className="text-sm leading-relaxed">{confirm === 'share' ? `把故事概况和最后几条记录分享给 ${card.charName}，作为你主动发送的一条私聊消息。不会自动请求回复。` : '这段故事会结束并保留全文。之后仍可用同一身份开启新的故事。'}</p></ClayDialog>
    </div>;
}
