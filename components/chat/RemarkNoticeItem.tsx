// [EM-START: contact-remark-aware]
/**
 * 改通讯录备注留下的那条提示：跟戳一戳一样常驻——上面一行小时间，下面一颗灰色胶囊，
 * 从她这边说（「你把备注从「小狗」改成了「大笨狗」」），不带图标（2026-10-30 阿萌定）。
 * 「隐藏系统消息」开着也显示（chatMessageVisibility.ts）。给 TA 看的那句仍是 content 里的第三人称。
 * 长按照常弹消息菜单（删除等）。
 */
import React from 'react';
import type { Message } from '../../types';
import { F, R } from '../../utils/clayTokens';

interface Props {
    msg: Message;
    /** MessageItem 的长按 / 选择那一套，原样挂上 */
    interactionProps: React.HTMLAttributes<HTMLDivElement>;
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const RemarkNoticeItem: React.FC<Props> = ({ msg, interactionProps }) => {
    const from = typeof msg.metadata?.from === 'string' ? msg.metadata.from : '';
    const to = typeof msg.metadata?.to === 'string' ? msg.metadata.to : '';
    const what = !from && !to ? null
        : !from ? <>写了备注「{to}」</>
        : !to ? <>删掉了备注「{from}」</>
        : <>把备注从「{from}」改成了「{to}」</>;
    return (
        <div className="flex flex-col items-center w-full px-10 my-3">
            <div style={{ fontSize: 10, lineHeight: '14px', color: F.textTertiary, marginBottom: 4 }}>{clock(msg.timestamp)}</div>
            <div {...interactionProps} className="select-none text-center"
                style={{ fontSize: 11, lineHeight: '16px', color: F.textSecondary, background: F.surfaceSunken, border: `1px solid ${F.borderSoft}`, borderRadius: R.pill, padding: '6px 16px', wordBreak: 'break-word' }}>
                {what ? <><span style={{ fontWeight: 600, color: F.textPrimary }}>你</span>{what}</> : msg.content}
            </div>
        </div>
    );
};

export default RemarkNoticeItem;
// [EM-END: contact-remark-aware]
