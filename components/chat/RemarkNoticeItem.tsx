// [EM-START: contact-remark-aware]
/**
 * 改通讯录备注留下的那条系统提示：只是一行居中的灰字，不带底色、图标（2026-10-30 阿萌选「plain」）。
 * 长按照常弹消息菜单（删除等）。
 */
import React from 'react';
import type { Message } from '../../types';
import { F } from '../../utils/clayTokens';

interface Props {
    msg: Message;
    /** MessageItem 的长按 / 选择那一套，原样挂上 */
    interactionProps: React.HTMLAttributes<HTMLDivElement>;
}

const RemarkNoticeItem: React.FC<Props> = ({ msg, interactionProps }) => (
    <div className="flex justify-center w-full px-10 my-3">
        <div {...interactionProps} className="select-none text-center"
            style={{ fontSize: 12, lineHeight: '18px', color: F.textTertiary, wordBreak: 'break-word' }}>
            {msg.content}
        </div>
    </div>
);

export default RemarkNoticeItem;
// [EM-END: contact-remark-aware]
