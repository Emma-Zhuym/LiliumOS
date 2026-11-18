// [EM-START: meet-extra]
/**
 * 番外的文风：阿萌自己贴进来的文字，只存在这台设备（localStorage），不进仓库、不进备份。
 * 起因（2026-11-17）：她常用的文风来自酒馆预设，作者只许自己二改自用、不许传播；LiliumOS 仓库是公开的，
 * 备份也可能放在别人看得到的地方。番外记录里只存名字，写的时候按名字来这里找全文。
 */
import type { MeetExtraStyleText } from './meetExtra';

const KEY = 'em_meet_extra_styles_v1';

export const listMeetExtraStyles = (): MeetExtraStyleText[] => {
    try {
        const rows = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(rows) ? rows.filter(r => r && typeof r.name === 'string' && typeof r.text === 'string') : [];
    } catch { return []; }
};

const write = (rows: MeetExtraStyleText[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* 存不了就这一次 */ }
};

/** 同名覆盖；返回新的列表 */
export const saveMeetExtraStyle = (style: MeetExtraStyleText, previousName?: string): MeetExtraStyleText[] => {
    const name = style.name.trim();
    if (!name || !style.text.trim()) return listMeetExtraStyles();
    const rest = listMeetExtraStyles().filter(r => r.name !== name && r.name !== previousName);
    const next = [...rest, { name, text: style.text.trim() }];
    write(next);
    return next;
};

export const removeMeetExtraStyle = (name: string): MeetExtraStyleText[] => {
    const next = listMeetExtraStyles().filter(r => r.name !== name);
    write(next);
    return next;
};

export const findMeetExtraStyle = (name?: string): MeetExtraStyleText | undefined =>
    name ? listMeetExtraStyles().find(r => r.name === name) : undefined;
// [EM-END: meet-extra]
