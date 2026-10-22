// [EM-START: emoji-group-intro]
import React, { useEffect, useState } from 'react';
import type { EmojiCategory } from '../../types';
import Modal from '../os/Modal';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { cleanGroupIntro, EMOJI_GROUP_INTRO_MAX } from '../../utils/emEmojiStickerLabel';
import { F, R } from '../../utils/clayTokens';

/**
 * 表情分组长按 →「这一组是谁」：一句话说清这组表情包的主角（小豆泥：圆眼睛的小暹罗猫）。
 * 写进角色的表情清单；阿萌发这组的表情时带上组名；让 AI 写描述时也告诉读图的模型。
 */
const EmojiGroupIntroModal: React.FC<{
    category: EmojiCategory | null;
    onClose: () => void;
    /** 存完让聊天页重读表情库 */
    onSaved: () => void | Promise<void>;
}> = ({ category, onClose, onSaved }) => {
    const { addToast } = useOS();
    const [text, setText] = useState('');

    useEffect(() => { setText(category?.intro ?? ''); }, [category]);

    if (!category) return null;

    const save = async () => {
        const intro = cleanGroupIntro(text);
        try {
            await DB.saveEmojiCategory({ ...category, intro: intro || undefined });
            await onSaved();
            addToast(intro ? '介绍已保存' : '介绍已清空', 'success');
            onClose();
        } catch (error) {
            addToast((error as Error)?.message || '保存失败', 'error');
        }
    };

    return <Modal
        isOpen
        title={`「${category.name}」是谁`}
        onClose={onClose}
        footer={<>
            <button onClick={onClose} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button>
            <button onClick={() => { void save(); }} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button>
        </>}
    >
        <div className="space-y-2">
            <textarea
                id={`emoji-group-intro-${category.id}`}
                value={text}
                onChange={event => setText(event.target.value.slice(0, EMOJI_GROUP_INTRO_MAX))}
                placeholder="比如：一只圆眼睛的小暹罗猫，表情很软"
                aria-label={`${category.name} 的介绍`}
                className="w-full h-24 p-3 text-sm leading-relaxed resize-none outline-none"
                style={{ background: F.surfaceSunken, borderRadius: R.input, color: F.textPrimary }}
            />
            <p className="text-xs leading-5" style={{ color: F.textTertiary }}>
                一句话说清这组表情包的主角。角色会在表情清单里看到它；你发这组的表情时，角色也会知道是「{category.name}」。
                {text.length}/{EMOJI_GROUP_INTRO_MAX}
            </p>
        </div>
    </Modal>;
};

export default EmojiGroupIntroModal;
// [EM-END: emoji-group-intro]
