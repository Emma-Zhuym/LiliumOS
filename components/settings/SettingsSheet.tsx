// [EM-START: settings-inline-config]
/**
 * 设置里那几块「点配置 → 弹窗」的内容（实时感知、MCP、主动消息 2.0），在它们自己的子页里直接铺开：
 * 阿萌 2026-10-22：「点进去还要再点进去」。
 *
 * 跟上游 os/Modal 同一套参数，多一个 inline：
 * - inline = false：原样渲染 Modal（别处照旧弹窗）
 * - inline = true：把内容挂进设置子页的滚动区（SettingsInlineSlotContext 给的那个节点），
 *   不要标题（顶栏写了）、不要「关闭」，footer 照放在内容下面（比如「保存配置」）
 */

import React, { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import Modal from '../os/Modal';
import { F, R } from '../../utils/clayTokens';

/** 设置子页滚动区里留给内嵌配置的那个节点；不在设置子页里时是 null。 */
export const SettingsInlineSlotContext = createContext<HTMLElement | null>(null);

interface Props {
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    inline?: boolean;
}

const SettingsSheet: React.FC<Props> = ({ isOpen, title, onClose, children, footer, inline }) => {
    const slot = useContext(SettingsInlineSlotContext);
    if (!inline) return <Modal isOpen={isOpen} title={title} onClose={onClose} footer={footer}>{children}</Modal>;
    if (!slot) return null; // 子页刚挂上、节点还没给出来：下一帧再画
    return createPortal(
        <div className="flex flex-col" style={{ gap: 16 }}>
            <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: 16 }}>
                {children}
            </div>
            {footer && <div className="flex" style={{ gap: 12 }}>{footer}</div>}
        </div>,
        slot,
    );
};

export default SettingsSheet;
// [EM-END: settings-inline-config]
