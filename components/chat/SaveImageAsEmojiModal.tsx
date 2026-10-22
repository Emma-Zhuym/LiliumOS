// [EM-START: save-image-as-emoji]
import React, { useEffect, useState } from 'react';
import type { EmojiCategory, Message } from '../../types';
import Modal from '../os/Modal';
import TokenImg from '../os/TokenImg';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { isBlobRef, migrateDataUrlToRef, putImageBlobDeduped } from '../../utils/blobRef';
import { readVisionDescription } from '../../utils/visionApi';
import { cleanEmojiDescription, describeEmojiImage } from '../../utils/emEmojiDescriptions';
import { groupVisionHint } from '../../utils/emEmojiStickerLabel'; // [EM: emoji-group-intro]
import { looksLikeImage } from '../../utils/emExternalImages';
import { F, R } from '../../utils/clayTokens';
import { EmojiDescriptionField, inputStyle, useEmojiVisionChoice } from './EmojiVisionControls';

/**
 * 聊天里长按一张图 →「存为表情包」（阿萌 2026-10-21 要的）。
 *
 * 图一律存进本机：本来就是本机令牌的直接共用；data URL 转令牌；网址先试着下载下来，
 * 下不了才原样存网址（并提示）——不然又是一张挂在别人图床上的表情。
 * 聊天时识图 API 已经看过这张图的话，描述直接拿来当初稿。
 */

const toLocalImage = async (value: string): Promise<{ url: string; local: boolean }> => {
    if (isBlobRef(value)) return { url: value, local: true };
    if (value.startsWith('data:')) {
        const token = await migrateDataUrlToRef(value);
        return { url: token, local: token !== value };
    }
    if (/^https?:\/\//i.test(value)) {
        try {
            const response = await fetch(value, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', __sullySuppressNetworkFailureLog: true } as RequestInit);
            if (response.ok) {
                const blob = await response.blob();
                if (looksLikeImage(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))) {
                    return { url: (await putImageBlobDeduped(blob)).token, local: true };
                }
            }
        } catch { /* 下不了就原样存网址 */ }
    }
    return { url: value, local: false };
};

const SaveImageAsEmojiModal: React.FC<{
    message: Message | null;
    categories: EmojiCategory[];
    /** 表情面板当前选中的分类（'default' = 默认） */
    defaultCategoryId: string;
    onClose: () => void;
    onSaved: () => void | Promise<void>;
}> = ({ message, categories, defaultCategoryId, onClose, onSaved }) => {
    const { addToast } = useOS();
    const { choices, choice, select } = useEmojiVisionChoice();
    const [name, setName] = useState('');
    const [categoryId, setCategoryId] = useState(defaultCategoryId);
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!message) return;
        setName('');
        setCategoryId(defaultCategoryId);
        setDescription(cleanEmojiDescription(readVisionDescription(message)));
    }, [message, defaultCategoryId]);

    if (!message) return null;
    const image = typeof message.content === 'string' ? message.content : '';
    const otherCategories = categories.filter(c => c.id !== 'default');

    const describe = async (selected: NonNullable<typeof choice>) => {
        setBusy(true);
        try { setDescription(await describeEmojiImage(image, selected.config, groupVisionHint(categories.find(c => c.id === categoryId)))); } catch (error) { // [EM: emoji-group-intro]
            addToast((error as Error)?.message || '没看出来', 'error');
        } finally { setBusy(false); }
    };

    const save = async () => {
        const trimmed = name.trim();
        if (!trimmed) { addToast('给表情包起个名字（角色发表情时按名字挑）', 'error'); return; }
        setSaving(true);
        try {
            if ((await DB.getEmojis()).some(e => e.name === trimmed)) { addToast('已经有同名的表情包了，换个名字', 'error'); return; }
            const { url, local } = await toLocalImage(image);
            await DB.saveEmoji(trimmed, url, categoryId === 'default' ? undefined : categoryId);
            const clean = cleanEmojiDescription(description);
            if (clean) await DB.setEmojiDescription(trimmed, clean);
            await onSaved();
            addToast(local ? '已存为表情包' : '已存为表情包（图没能下载到本机，还是原来的链接）', local ? 'success' : 'info');
            onClose();
        } catch (error) {
            addToast((error as Error)?.message || '保存失败', 'error');
        } finally { setSaving(false); }
    };

    return <Modal
        isOpen
        title="存为表情包"
        onClose={onClose}
        footer={<>
            <button onClick={onClose} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
            <button onClick={() => { void save(); }} disabled={saving || busy} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl disabled:opacity-50">{saving ? '存着…' : '保存'}</button>
        </>}
    >
        <div className="space-y-3">
            <div className="flex justify-center">
                <TokenImg value={image} className="w-24 h-24 object-contain" style={{ borderRadius: R.medium, border: `1px solid ${F.borderSoft}` }} />
            </div>
            <div className="space-y-1">
                <div className="text-xs font-semibold" style={{ color: F.textSecondary }}>名字</div>
                <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="比如：乖乖当狗"
                    maxLength={40}
                    className="w-full h-11 px-3 text-sm focus:outline-none"
                    style={inputStyle}
                />
            </div>
            <div className="space-y-1">
                <div className="text-xs font-semibold" style={{ color: F.textSecondary }}>放进哪个分类</div>
                <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full h-10 px-2 text-sm focus:outline-none" style={inputStyle}>
                    <option value="default">默认</option>
                    {otherCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>
            <EmojiDescriptionField
                value={description} onChange={setDescription} busy={busy}
                onDescribe={selected => { void describe(selected); }}
                choices={choices} choice={choice} onSelectChoice={select}
            />
        </div>
    </Modal>;
};

export default SaveImageAsEmojiModal;
// [EM-END: save-image-as-emoji]
