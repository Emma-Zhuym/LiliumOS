import { DB } from './db';
import { CONTACT_REMARK_NOTICE_KIND, remarkChangeNotice, saveContactRemark } from './contactRemarks';

/**
 * 设置页「保存备注」：存备注，真改了就在私聊里留一条系统提示（她看得到，TA 从聊天记录里也看得到）。
 * 返回有没有写提示，好让聊天页刷新。
 */
export async function saveContactRemarkWithNotice(
    char: { id: string; name: string },
    value: string,
    userName: string,
    now = Date.now(),
): Promise<boolean> {
    const change = saveContactRemark(char.id, value, now);
    if (!change) return false;
    // 备注已经存好了：提示写不进去只少一条提示，不当保存失败（TA 照样从提示词里知道当前备注）
    try {
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: remarkChangeNotice(change, userName || '我', char.name),
            timestamp: now,
            metadata: { kind: CONTACT_REMARK_NOTICE_KIND, from: change.from, to: change.to },
        });
        return true;
    } catch (e) {
        console.error('Failed to save contact remark notice:', e);
        return false;
    }
}
