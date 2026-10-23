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
import { F, R } from '../../utils/clayTokens';
import { SETTINGS_HUE } from './SettingsHome';
import { Group, Hero, Notice, Page, Row } from './SettingsParts'; // [EM: settings-subpages-f]

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
    // [EM: settings-subpages-f] 一组：标题行显示数量，点开每张一行（用在哪 + 为什么）
    return <Group>
        <Row title={title} value={`${failures.length} 张`} valueTone={tone === 'danger' ? 'bad' : 'plain'} dot={tone === 'danger' ? 'bad' : null}
            onClick={() => setOpen(v => !v)} />
        {open && failures.map(({ image, reason }) => (
            <Row key={image.url} title={image.uses.map(use => use.label).join('、')} sub={<span className="break-all">{reason}</span>} />
        ))}
    </Group>;
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
    const percent = phase.kind === 'running' ? Math.round((phase.done / Math.max(1, phase.total)) * 100) : 0;

    // [EM-START: settings-subpages-f] 状态卡 + 一行动作 + 结果组，跟其他子页一个样子
    return <Page testId="settings-external-images-page">
        <Hero title={images === null ? '正在数…' : total === 0 ? '都存在本机了' : `还有 ${total} 张挂在外面`}
            sub={images && total > 0 ? countByHost(images).map(([host, n]) => `${host} ${n} 张`).join('，') : '贴链接加的表情包、头像，图其实在别人的图床上，图床一挂就变问号。'}
            dot={images && total === 0 ? 'ok' : null} />

        {running && <div className="flex flex-col" style={{ gap: 6 }}>
            <div style={{ height: 6, overflow: 'hidden', background: F.surfaceSunken, borderRadius: R.pill }}>
                <div style={{ height: '100%', width: `${percent}%`, background: SETTINGS_HUE.main, borderRadius: R.pill, transition: 'width 200ms' }} />
            </div>
            <p style={{ margin: 0, fontSize: 12, color: F.textTertiary }}>正在下载 {phase.done} / {phase.total}，别关页面</p>
        </div>}

        {total > 0 && !running && <Group foot={paired ? '存到本机后断网也能看，同时在 Mac mini 上存一份底（每天的自动备份只带文字，不带图）。' : '存到本机后断网也能看。连上 Mac mini 后还能让它代为下载、存一份底。'}>
            <Row title={phase.kind === 'done' ? '再试一次' : `检查并存到本机（${total} 张）`} tone="link" onClick={() => { void run(); }} />
        </Group>}

        {phase.kind === 'error' && <Notice tone="danger">{phase.message}</Notice>}

        {phase.kind === 'done' && (() => {
            const { outcome, summary } = phase;
            const saved = outcome.replacements.size;
            const failures = [...outcome.dead, ...outcome.unknown];
            const deadEmojis = deadEmojiNames(outcome.dead).length;
            return <>
                <Notice tone={saved ? 'info' : 'warning'}>
                    {saved
                        ? `存好了 ${saved} 张：表情包 ${summary.emojis} 个、角色头像 ${summary.characterAvatars} 个、我的头像 ${summary.userAvatars} 个，聊天里发过的 ${summary.messages} 条也一起换了。`
                        : '这次一张都没存下来。'}
                    {paired && saved > 0 && ` Mac mini 上存了 ${outcome.backedUp} 张${outcome.backupFailed ? `，${outcome.backupFailed} 张没传上（下次再点会补）` : ''}。`}
                </Notice>
                <FailureList title="现在打不开" failures={outcome.dead} tone="danger" />
                <FailureList title="没判断出来" failures={outcome.unknown} tone="warning" />
                {failures.length > 0 && <Group foot={outcome.dead.length > 0 ? '图床可能只是暂时挂了，过几天可以再点一次。确定救不回来的，找到原图后在表情库重新从相册添加。' : undefined}>
                    <Row title="复制打不开的链接" tone="link" onClick={() => { void copyLinks(failures); }} />
                    {deadEmojis > 0 && <Row title={`删掉打不开的表情包（${deadEmojis}）`} tone="danger" onClick={() => { void removeDeadEmojis(outcome.dead); }} />}
                </Group>}
            </>;
        })()}

        {note && <p style={{ margin: 0, fontSize: 13, color: F.textSecondary }}>{note}</p>}
    </Page>;
    // [EM-END: settings-subpages-f]
}
// [EM-END: external-images-rescue]
