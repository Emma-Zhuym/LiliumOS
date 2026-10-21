// [EM-START: external-images-rescue]
import React, { useCallback, useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { putImageBlobDeduped } from '../../utils/blobRef';
import { AgentBackend, isAgentPaired } from '../../utils/emAgentBackend';
import {
    applyImageReplacements, blobToBase64, collectExternalImages, deadEmojiNames, rescueExternalImages,
    type ApplySummary, type ExternalImage, type RescueFailure, type RescueOutcome,
} from '../../utils/emExternalImages';
import { tryAcquireMaintenanceLock, releaseMaintenanceLock, currentMaintenanceHolder } from '../../utils/maintenanceLock';
import { F, HUE, R, STATUS } from '../../utils/clayTokens';

type Phase =
    | { kind: 'idle' }
    | { kind: 'running'; done: number; total: number }
    | { kind: 'done'; outcome: RescueOutcome; summary: ApplySummary }
    | { kind: 'error'; message: string };

/** 按图床分组数一数，给「共几张、分别在哪」那一行用。 */
const countByHost = (images: ExternalImage[]) => {
    const counts = new Map<string, number>();
    for (const image of images) counts.set(image.host, (counts.get(image.host) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const FailureList: React.FC<{ title: string; failures: RescueFailure[]; tone: 'danger' | 'warning' }> = ({ title, failures, tone }) => {
    const [open, setOpen] = useState(false);
    if (!failures.length) return null;
    const color = STATUS[tone];
    return <div className="px-3 py-2 text-xs leading-5" style={{ background: color.tint, color: color.ink, borderRadius: R.smallCard }}>
        <button type="button" className="w-full text-left font-semibold" onClick={() => setOpen(v => !v)}>
            {title}（{failures.length}）{open ? '收起' : '展开'}
        </button>
        {open && <ul className="mt-1 space-y-1">
            {failures.map(({ image, reason }) => <li key={image.url} className="break-all">
                <span className="font-semibold">{image.uses.map(use => use.label).join('、')}</span>
                <span style={{ opacity: 0.8 }}> · {reason}</span>
            </li>)}
        </ul>}
    </div>;
};

/** 设置 → 备份与恢复：把挂在别人图床上的表情包、头像存进手机，并在 mini 留一份底。 */
export default function ExternalImagesPanel() {
    const { characters, userProfile, updateCharacter, updateUserProfile } = useOS();
    const [images, setImages] = useState<ExternalImage[] | null>(null);
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const [note, setNote] = useState('');
    // 改完要重数一遍：别在 run 里直接调 scan——那份闭包里还是改之前的角色列表，数出来是旧的。
    // 涨一下 rev，让下一次渲染用最新的角色 / 头像去数。
    const [rev, setRev] = useState(0);
    const paired = isAgentPaired();

    const scan = useCallback(async () => {
        const emojis = await DB.getEmojis();
        setImages(collectExternalImages({ emojis, characters, user: userProfile }));
    }, [characters, userProfile]);

    useEffect(() => { void scan(); }, [scan, rev]);

    const run = async () => {
        if (!images?.length) return;
        if (!tryAcquireMaintenanceLock('外链图片存本机')) {
            setPhase({ kind: 'error', message: `另一项存储维护（${currentMaintenanceHolder()}）正在进行，等它做完再试。` });
            return;
        }
        setNote('');
        setPhase({ kind: 'running', done: 0, total: images.length });
        try {
            const outcome = await rescueExternalImages(images, {
                miniFetch: paired ? (url, label) => AgentBackend.fetchImage(url, label) : null,
                pageIsHttps: typeof location !== 'undefined' && location.protocol === 'https:',
                storeBlob: async blob => (await putImageBlobDeduped(blob)).token,
                miniBackup: paired
                    ? async (blob, url, label) => { await AgentBackend.putImage({ dataBase64: await blobToBase64(blob), mime: blob.type || 'image/png', source: url, label }); }
                    : null,
                onProgress: (done, total) => setPhase({ kind: 'running', done, total }),
            });
            const summary = await applyImageReplacements(outcome.replacements, {
                getEmojis: () => DB.getEmojis(),
                saveEmoji: (name, url, categoryId) => DB.saveEmoji(name, url, categoryId),
                characters,
                updateCharacterAvatar: (charId, avatar) => updateCharacter(charId, { avatar }),
                user: userProfile,
                updateUserAvatars: updates => updateUserProfile(updates),
                getMessagesPage: (afterKey, limit) => DB.getStoreRowsPage('messages', afterKey, limit),
                putMessages: rows => DB.putStoreRows('messages', rows),
            });
            setPhase({ kind: 'done', outcome, summary });
            setRev(r => r + 1);
        } catch (error) {
            setPhase({ kind: 'error', message: (error as Error)?.message || '出错了' });
        } finally {
            releaseMaintenanceLock();
        }
    };

    const removeDeadEmojis = async (failures: RescueFailure[]) => {
        const names = deadEmojiNames(failures);
        if (!names.length) return;
        if (!window.confirm(`从表情库删掉这 ${names.length} 个打不开的表情包？聊天记录里发过的不受影响（本来也显示不出来）。`)) return;
        for (const name of names) await DB.deleteEmoji(name);
        setNote(`删掉了 ${names.length} 个表情包。`);
        setRev(r => r + 1);
    };

    const copyLinks = async (failures: RescueFailure[]) => {
        const text = failures.map(({ image }) => `${image.uses.map(use => use.label).join('、')}  ${image.url}`).join('\n');
        try { await navigator.clipboard.writeText(text); setNote('打不开的链接已复制。'); } catch { setNote('复制失败，浏览器不让读写剪贴板。'); }
    };

    const total = images?.length ?? 0;
    const running = phase.kind === 'running';
    const buttonStyle: React.CSSProperties = { height: 44, borderRadius: R.button, background: F.textPrimary, color: F.surface };
    const secondaryStyle: React.CSSProperties = { height: 40, borderRadius: R.button, background: F.surface, border: `1px solid ${F.borderSoft}`, color: F.textPrimary };

    return <div className="mb-3 p-3 space-y-2" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard }}>
        <div className="text-sm font-semibold" style={{ color: F.textPrimary }}>外链图片存到本机</div>
        <p className="text-xs leading-5" style={{ color: F.textSecondary }}>
            贴链接加的表情包、头像，图其实放在别人的图床上，图床一挂就变成问号。存到本机后断网也能看
            {paired ? '，同时在 Mac mini 上存一份底（每天的自动备份只带文字，不带图）。' : '。连上 Mac mini 后还能让它代为下载、存一份底。'}
        </p>

        {images === null
            ? <p className="text-xs" style={{ color: F.textTertiary }}>正在数…</p>
            : <p className="text-xs leading-5" style={{ color: F.textSecondary }}>
                {total === 0 ? '没有挂在外面的图了。' : <>还有 {total} 张挂在外面：{countByHost(images).map(([host, n]) => `${host} ${n} 张`).join('，')}</>}
            </p>}

        {phase.kind === 'running' && <div className="space-y-1">
            <div className="h-1.5 overflow-hidden" style={{ background: F.surfaceSunken, borderRadius: R.pill }}>
                <div className="h-full" style={{ width: `${Math.round((phase.done / Math.max(1, phase.total)) * 100)}%`, background: HUE.blue.main, borderRadius: R.pill }} />
            </div>
            <p className="text-xs" style={{ color: F.textTertiary }}>正在下载 {phase.done} / {phase.total}，别关页面</p>
        </div>}

        {total > 0 && !running && <button type="button" className="w-full text-sm font-semibold clay-press" style={buttonStyle} onClick={() => { void run(); }}>
            {phase.kind === 'done' ? '再试一次' : `检查并存到本机（${total} 张）`}
        </button>}

        {phase.kind === 'error' && <div role="alert" className="px-3 py-2 text-xs leading-5" style={{ background: STATUS.danger.tint, color: STATUS.danger.ink, borderRadius: R.smallCard }}>
            {phase.message}
        </div>}

        {phase.kind === 'done' && (() => {
            const { outcome, summary } = phase;
            const saved = outcome.replacements.size;
            const failures = [...outcome.dead, ...outcome.unknown];
            const deadEmojis = deadEmojiNames(outcome.dead).length;
            return <div className="space-y-2">
                <div role="status" className="px-3 py-2 text-xs leading-5" style={{ background: saved ? STATUS.success.tint : F.surfaceWarm, color: saved ? STATUS.success.ink : F.textSecondary, borderRadius: R.smallCard }}>
                    <p>{saved
                        ? `存好了 ${saved} 张：表情包 ${summary.emojis} 个、角色头像 ${summary.characterAvatars} 个、我的头像 ${summary.userAvatars} 个，聊天里发过的 ${summary.messages} 条也一起换了。`
                        : '这次一张都没存下来。'}</p>
                    {paired && saved > 0 && <p>Mac mini 上存了 {outcome.backedUp} 张{outcome.backupFailed ? `，${outcome.backupFailed} 张没传上（下次再点会补）` : ''}。</p>}
                </div>
                <FailureList title="现在打不开" failures={outcome.dead} tone="danger" />
                <FailureList title="没判断出来" failures={outcome.unknown} tone="warning" />
                {outcome.dead.length > 0 && <p className="text-xs leading-5" style={{ color: F.textTertiary }}>
                    图床可能只是暂时挂了，过几天可以再点一次。确定救不回来的，找到原图后在表情库重新从相册添加。
                </p>}
                {failures.length > 0 && <div className="flex gap-2">
                    <button type="button" className="flex-1 text-xs font-semibold clay-press" style={secondaryStyle} onClick={() => { void copyLinks(failures); }}>复制打不开的链接</button>
                    {deadEmojis > 0 && <button type="button" className="flex-1 text-xs font-semibold clay-press" style={{ ...secondaryStyle, color: STATUS.danger.ink }} onClick={() => { void removeDeadEmojis(outcome.dead); }}>
                        删掉打不开的表情包（{deadEmojis}）
                    </button>}
                </div>}
            </div>;
        })()}

        {note && <p className="text-xs" style={{ color: F.textSecondary }}>{note}</p>}
    </div>;
}
// [EM-END: external-images-rescue]
