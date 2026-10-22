// [EM-START: emoji-descriptions]
import React, { useEffect, useRef, useState } from 'react';
import type { Emoji, EmojiCategory } from '../../types';
import { groupVisionHint } from '../../utils/emEmojiStickerLabel'; // [EM: emoji-group-intro]
import Modal from '../os/Modal';
import TokenImg from '../os/TokenImg';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import {
    cleanEmojiDescription, describeEmojiImage, describeEmojisInBatch, emojisMissingDescription,
    type DescribeBatchResult,
} from '../../utils/emEmojiDescriptions';
import { F, R, STATUS } from '../../utils/clayTokens';
import { EmojiDescriptionField, useEmojiVisionChoice } from './EmojiVisionControls';

/**
 * 表情包长按 →「图上画了什么」：改一个表情的描述，或者给所有没写的一起写。
 * 描述只在阿萌发这个表情时给角色看（utils/emEmojiDescriptions.ts）。
 */
const EmojiDescriptionModal: React.FC<{
    emoji: Emoji | null;
    allEmojis: Emoji[];
    /** [EM: emoji-group-intro] 表情分组：读图时告诉模型这一组是谁 */
    categories?: EmojiCategory[];
    onClose: () => void;
    /** 存完让聊天页重读表情库 */
    onSaved: () => void | Promise<void>;
}> = ({ emoji, allEmojis, categories = [], onClose, onSaved }) => {
    const hintFor = (target: Emoji) => groupVisionHint(categories.find(c => c.id === target.categoryId)); // [EM: emoji-group-intro]
    const { addToast } = useOS();
    const { choices, choice, select } = useEmojiVisionChoice();
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
    const [batchResult, setBatchResult] = useState<DescribeBatchResult | null>(null);
    const stopRef = useRef(false);

    useEffect(() => {
        setText(emoji?.description ?? '');
        setBatchResult(null);
    }, [emoji]);

    if (!emoji) return null;
    const missing = emojisMissingDescription(allEmojis).filter(e => e.name !== emoji.name);
    const batchRunning = batch !== null;

    const describeOne = async (selected: NonNullable<typeof choice>) => {
        setBusy(true);
        try { setText(await describeEmojiImage(emoji.url, selected.config, hintFor(emoji))); } catch (error) {
            addToast((error as Error)?.message || '没看出来', 'error');
        } finally { setBusy(false); }
    };

    const save = async () => {
        try {
            await DB.setEmojiDescription(emoji.name, cleanEmojiDescription(text));
            await onSaved();
            addToast(cleanEmojiDescription(text) ? '描述已保存' : '描述已清空', 'success');
            onClose();
        } catch (error) {
            addToast((error as Error)?.message || '保存失败', 'error');
        }
    };

    const runBatch = async () => {
        if (!choice || !missing.length) return;
        stopRef.current = false;
        setBatchResult(null);
        setBatch({ done: 0, total: missing.length });
        const result = await describeEmojisInBatch(missing, {
            describe: (image, target) => describeEmojiImage(image, choice.config, hintFor(target)),
            save: (name, description) => DB.setEmojiDescription(name, description),
            onProgress: (done, total) => setBatch({ done, total }),
            shouldStop: () => stopRef.current,
        });
        setBatch(null);
        setBatchResult(result);
        await onSaved();
    };

    return <Modal
        isOpen
        title="图上画了什么"
        onClose={() => { if (!batchRunning) onClose(); }}
        footer={<>
            <button onClick={onClose} disabled={batchRunning} className="flex-1 py-3 bg-slate-100 rounded-2xl disabled:opacity-50">取消</button>
            <button onClick={() => { void save(); }} disabled={batchRunning || busy} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl disabled:opacity-50">保存</button>
        </>}
    >
        <div className="space-y-3">
            <div className="flex flex-col items-center gap-1">
                <TokenImg value={emoji.url} className="w-20 h-20 object-contain" style={{ borderRadius: R.medium, border: `1px solid ${F.borderSoft}` }} />
                <span className="text-sm font-medium max-w-[12rem] truncate" style={{ color: F.textSecondary }}>{emoji.name}</span>
            </div>
            <EmojiDescriptionField
                value={text} onChange={setText} busy={busy || batchRunning}
                onDescribe={choiceToUse => { void describeOne(choiceToUse); }}
                choices={choices} choice={choice} onSelectChoice={select}
            />
            {choice && (missing.length > 0 || batchRunning || batchResult) && <div className="pt-2 space-y-2" style={{ borderTop: `1px solid ${F.divider}` }}>
                {batchRunning
                    ? <div className="space-y-1">
                        <div className="h-1.5 overflow-hidden" style={{ background: F.surfaceSunken, borderRadius: R.pill }}>
                            <div className="h-full" style={{ width: `${Math.round((batch.done / Math.max(1, batch.total)) * 100)}%`, background: F.textPrimary, borderRadius: R.pill }} />
                        </div>
                        <div className="flex items-center justify-between text-xs" style={{ color: F.textTertiary }}>
                            <span>在看第 {batch.done} / {batch.total} 个，别关</span>
                            <button type="button" className="font-semibold" style={{ color: F.textSecondary }} onClick={() => { stopRef.current = true; }}>停下</button>
                        </div>
                    </div>
                    : missing.length > 0 && <button type="button" onClick={() => { void runBatch(); }} className="w-full h-10 text-xs font-semibold clay-press"
                        style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.button, color: F.textPrimary }}>
                        其他还没写的 {missing.length} 个也让 AI 写上
                    </button>}
                {batchResult && <div role="status" className="px-3 py-2 text-xs leading-5" style={{
                    background: batchResult.failed.length ? STATUS.warning.tint : STATUS.success.tint,
                    color: batchResult.failed.length ? STATUS.warning.ink : STATUS.success.ink, borderRadius: R.smallCard,
                }}>
                    写好了 {batchResult.done} 个{batchResult.failed.length ? `，${batchResult.failed.length} 个没写成（图打不开或者模型看不了图，比如：${batchResult.failed[0].name}——${batchResult.failed[0].reason}）` : '。'}
                </div>}
            </div>}
        </div>
    </Modal>;
};

export default EmojiDescriptionModal;
// [EM-END: emoji-descriptions]
