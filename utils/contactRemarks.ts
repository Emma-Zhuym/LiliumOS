import { useSyncExternalStore } from 'react';
import type { Message } from '../types';

// 备注只存本机 localStorage，不挂在 CharacterProfile 上；角色从聊天提示词和心跳快照里看到它
// （buildContactRemarkInjection / contactRemarkForSnapshot，2026-10-29 起）。
// 改了备注在私聊里留一条系统提示（contactRemarkActions.ts），TA 从聊天记录里看到改动。
const PREFIX = 'em_contact_remark_';
const CHANGE = 'em-contact-remark-changed';
// 最近一次改动，每个角色一条。别用 PREFIX 开头：exportContactRemarks 按前缀扫备注。
const CHANGES_KEY = 'em_remark_changes_v1';
/** 改了备注之后多久内还提醒 TA：超过一天就不提了。 */
const CHANGE_NOTICE_MS = 24 * 60 * 60 * 1000;
const REMARK_MAX = 60;

export interface ContactRemarkChange {
    /** 改之前的备注，原来没写就是空字符串 */
    from: string;
    /** 改成的备注，删掉了就是空字符串 */
    to: string;
    changedAt: number;
}

export function getContactRemark(characterId: string): string {
    return localStorage.getItem(PREFIX + characterId) || '';
}

const loadChanges = (): Record<string, ContactRemarkChange> => {
    try {
        const parsed = JSON.parse(localStorage.getItem(CHANGES_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

const isChange = (value: unknown): value is ContactRemarkChange => {
    const c = value as ContactRemarkChange;
    return !!c && typeof c.from === 'string' && typeof c.to === 'string' && Number.isFinite(c.changedAt);
};

export function getContactRemarkChange(characterId: string): ContactRemarkChange | null {
    const change = loadChanges()[characterId];
    return isChange(change) ? change : null;
}

/** 存备注；真改了就返回这次改动（没变返回 null）。 */
export function saveContactRemark(characterId: string, value: string, now = Date.now()): ContactRemarkChange | null {
    const remark = value.trim();
    const previous = getContactRemark(characterId);
    if (remark) localStorage.setItem(PREFIX + characterId, remark);
    else localStorage.removeItem(PREFIX + characterId);
    // 改动只在这里记：从什么改成什么、什么时候。第一次写（从空到有）、删掉也算
    let change: ContactRemarkChange | null = null;
    if (remark !== previous) {
        change = { from: previous, to: remark, changedAt: now };
        try {
            localStorage.setItem(CHANGES_KEY, JSON.stringify({ ...loadChanges(), [characterId]: change }));
        } catch { /* 存不下就算了，备注本身已经存好 */ }
    }
    window.dispatchEvent(new Event(CHANGE));
    return change;
}

export const CONTACT_REMARK_NOTICE_KIND = 'contact_remark_change';

/** 私聊里那条系统提示：她和 TA 都看得到，所以用名字说，不用「你」 */
export function remarkChangeNotice(change: ContactRemarkChange, userName: string, charName: string): string {
    if (!change.from) return `${userName}给${charName}写了备注「${clip(change.to)}」`;
    if (!change.to) return `${userName}删掉了${charName}的备注「${clip(change.from)}」`;
    return `${userName}把${charName}的备注从「${clip(change.from)}」改成了「${clip(change.to)}」`;
}

/**
 * 还没跟 TA 提过的那次改动：一天之内、改完之后 TA 还没说过话。
 * TA 回过一次（不管提没提）就算知道了，之后不再挂着。
 */
export function pendingContactRemarkChange(
    characterId: string,
    messages: Pick<Message, 'role' | 'type' | 'timestamp'>[] = [],
    now = Date.now(),
): ContactRemarkChange | null {
    const change = getContactRemarkChange(characterId);
    if (!change || now - change.changedAt > CHANGE_NOTICE_MS) return null;
    const answered = messages.some(m => m.role === 'assistant' && m.type !== 'system' && (m.timestamp || 0) > change.changedAt);
    return answered ? null : change;
}

const clip = (text: string) => text.slice(0, REMARK_MAX);

/**
 * 聊天提示词：当前备注每轮都带；没写就不加。
 * 改动本身不在这里复述——私聊里那条系统提示就在聊天记录里，位置和时间都对；
 * 只在 TA 还没回过话（一天内）时补一句「那条提示是什么意思、可以怎么反应」。
 * fire_pack 不带这一句：打包时的「刚改了」到点就过期了。
 */
export function buildContactRemarkInjection(
    characterId: string,
    userName: string,
    { messages = [], now = Date.now(), includeChange = true }: { messages?: Pick<Message, 'role' | 'type' | 'timestamp'>[]; now?: number; includeChange?: boolean } = {},
): string {
    const remark = getContactRemark(characterId);
    const change = includeChange ? pendingContactRemarkChange(characterId, messages, now) : null;
    if (!remark && !change) return '';
    let text = '\n### 通讯录备注\n';
    // 刚改过时不说「不用老提」：模型见到一句可以不说就真的不说了（阿萌 2026-10-30）
    if (remark) text += `${userName}在自己手机通讯录里给你的备注是「${clip(remark)}」。这是 ta 私下对你的叫法${change ? '。' : '，你知道就好，不用老提。'}\n`;
    if (change) {
        text += `聊天记录里那条「${userName}${!change.from ? '给你写了备注' : !change.to ? '删掉了你的备注' : '把你的备注从…改成了…'}」的系统提示，是 ta 刚在手机通讯录里动了给你的备注。`
            + '你注意到了：这次回复要照你的性格对这件事有个反应——好奇、得意、吐槽、追问为什么都行；之后别再拿它说事。\n';
    }
    return text;
}

/** 心跳快照：当前备注 + 还没提过的改动 */
export function contactRemarkForSnapshot(
    characterId: string,
    messages: Pick<Message, 'role' | 'type' | 'timestamp'>[],
    now = Date.now(),
): { contactRemark?: string; contactRemarkChange?: { from: string; to: string; at: string } } {
    if (typeof localStorage === 'undefined') return {};
    const remark = getContactRemark(characterId);
    const change = pendingContactRemarkChange(characterId, messages, now);
    return {
        ...(remark ? { contactRemark: clip(remark) } : {}),
        ...(change ? { contactRemarkChange: { from: clip(change.from), to: clip(change.to), at: new Date(change.changedAt).toISOString() } } : {}),
    };
}

/** 备份用：所有角色的备注，没有就是 undefined。 */
export function exportContactRemarks(): Record<string, string> | undefined {
    const remarks: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        const value = localStorage.getItem(key);
        if (value) remarks[key.slice(PREFIX.length)] = value;
    }
    return Object.keys(remarks).length ? remarks : undefined;
}

/** 恢复备份里的备注；备份里没提到的角色保留本机原有备注。 */
export function importContactRemarks(remarks: unknown): void {
    if (!remarks || typeof remarks !== 'object' || Array.isArray(remarks)) return;
    for (const [characterId, value] of Object.entries(remarks)) {
        if (characterId && typeof value === 'string' && value.trim()) localStorage.setItem(PREFIX + characterId, value.trim());
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE));
}

/** 备份用：每个角色最近一次改备注的记录，没有就是 undefined。 */
export function exportContactRemarkChanges(): Record<string, ContactRemarkChange> | undefined {
    const changes = Object.fromEntries(Object.entries(loadChanges()).filter(([, c]) => isChange(c)));
    return Object.keys(changes).length ? changes : undefined;
}

/** 恢复改动记录；备份里没提到的角色保留本机原有记录。 */
export function importContactRemarkChanges(changes: unknown): void {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return;
    const merged = loadChanges();
    for (const [characterId, change] of Object.entries(changes)) {
        if (characterId && isChange(change)) merged[characterId] = { from: change.from, to: change.to, changedAt: change.changedAt };
    }
    try { localStorage.setItem(CHANGES_KEY, JSON.stringify(merged)); } catch { /* 存不下就算了 */ }
}

function subscribe(listener: () => void) {
    window.addEventListener(CHANGE, listener);
    window.addEventListener('storage', listener);
    return () => {
        window.removeEventListener(CHANGE, listener);
        window.removeEventListener('storage', listener);
    };
}

export function useContactRemark(characterId: string): string {
    return useSyncExternalStore(subscribe, () => getContactRemark(characterId), () => '');
}
