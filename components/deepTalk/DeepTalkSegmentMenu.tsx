// [EM-START: deep-talk-actions]
/**
 * 长按纸上一段话的菜单：同聊天的消息操作。纸面盖住了聊天，这些得自己有。
 * 信笺只给复制和收藏（那一夜已经收成卡了，不再改原文）。
 */
import React, { useEffect, useState } from 'react';
import type { Message } from '../../types';
import { useOS } from '../../context/OSContext';
import { F, R, STATUS } from '../../utils/clayTokens';
import { DB } from '../../utils/db';
import { notifyDeepTalkChanged } from '../../utils/deepTalkDb';
import { contentFavoriteIdForMessage, getContentFavoriteById } from '../../utils/contentFavorites';
import { toggleChatMessageFavorite } from '../../utils/messageFavorites';
import ClayDialog from '../os/ClayDialog';

export const copyDeepTalkText = async (text: string, toast: (msg: string, type: 'success' | 'error') => void) => {
    try {
        await navigator.clipboard.writeText(text);
        toast('已复制', 'success');
    } catch {
        toast('复制失败，请再试一次', 'error');
    }
};

const Row: React.FC<{ onClick: () => void; danger?: boolean; children: React.ReactNode }> = ({ onClick, danger, children }) => (
    <button type="button" onClick={onClick} className="w-full clay-press"
        style={{ height: 46, borderRadius: R.button, background: F.surfaceSunken, border: 'none', color: danger ? STATUS.danger.main : F.textPrimary, fontSize: 15, fontWeight: 600 }}>
        {children}
    </button>
);

export default function DeepTalkSegmentMenu({ message, charName, userName, onClose, onQuote, editable = false }: {
    message: Message | null;
    charName: string;
    userName: string;
    onClose: () => void;
    /** 只有开着的纸面能引用 */
    onQuote?: (message: Message) => void;
    /** 只有开着的纸面能改、能删 */
    editable?: boolean;
}) {
    const { addToast } = useOS();
    const [mode, setMode] = useState<'menu' | 'edit' | 'delete'>('menu');
    const [favorited, setFavorited] = useState(false);
    const [text, setText] = useState('');

    useEffect(() => {
        setMode('menu');
        setText(message?.content ?? '');
        setFavorited(false);
        if (!message) return;
        let alive = true;
        void getContentFavoriteById(contentFavoriteIdForMessage(message))
            .then(found => { if (alive) setFavorited(!!found?.owners.some(owner => owner.kind === 'user')); })
            .catch(() => {});
        return () => { alive = false; };
    }, [message]);

    if (!message) return null;

    const toggleFavorite = async () => {
        try {
            const saved = await toggleChatMessageFavorite(message, charName, userName);
            addToast(saved ? '已加入收藏夹' : '已取消收藏', 'success');
            onClose();
        } catch (error) {
            addToast(error instanceof Error ? error.message : '收藏失败，请重试', 'error');
        }
    };
    const saveEdit = async () => {
        const next = text.trim();
        if (!next) return;
        await DB.updateMessage(message.id, next);
        notifyDeepTalkChanged(message.charId);
        onClose();
    };
    const remove = async () => {
        await DB.deleteMessage(message.id);
        notifyDeepTalkChanged(message.charId);
        onClose();
    };

    if (mode === 'edit') {
        return (
            <ClayDialog isOpen title="改这一段" onClose={onClose} footer={<Row onClick={() => void saveEdit()}>存好</Row>}>
                <textarea value={text} onChange={event => setText(event.target.value)} rows={8} aria-label="这一段的内容" className="w-full outline-none resize-none"
                    style={{ padding: '10px 12px', borderRadius: R.input, border: `1px solid ${F.borderSoft}`, background: F.surface, color: F.textPrimary, fontSize: 15, lineHeight: '23px' }} />
            </ClayDialog>
        );
    }
    if (mode === 'delete') {
        return (
            <ClayDialog isOpen title="删掉这一段吗" onClose={onClose} footer={<Row danger onClick={() => void remove()}>删掉</Row>}>
                <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: F.textSecondary }}>删了就找不回来了。</p>
            </ClayDialog>
        );
    }
    return (
        <ClayDialog isOpen title="这一段" onClose={onClose}>
            <div className="flex flex-col" style={{ gap: 8 }}>
                {onQuote && <Row onClick={() => { onQuote(message); onClose(); }}>引用</Row>}
                <Row onClick={() => { void copyDeepTalkText(message.content, addToast); onClose(); }}>复制</Row>
                <Row onClick={() => void toggleFavorite()}>{favorited ? '取消收藏' : '收藏'}</Row>
                {editable && <Row onClick={() => setMode('edit')}>编辑</Row>}
                {editable && <Row danger onClick={() => setMode('delete')}>删除</Row>}
            </div>
        </ClayDialog>
    );
}
// [EM-END: deep-talk-actions]
