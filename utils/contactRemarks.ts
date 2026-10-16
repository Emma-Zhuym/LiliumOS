import { useSyncExternalStore } from 'react';

// UI-only storage. Never attach remarks to CharacterProfile or prompt/message data.
const PREFIX = 'em_contact_remark_';
const CHANGE = 'em-contact-remark-changed';

export function getContactRemark(characterId: string): string {
    return localStorage.getItem(PREFIX + characterId) || '';
}

export function saveContactRemark(characterId: string, value: string): void {
    const remark = value.trim();
    if (remark) localStorage.setItem(PREFIX + characterId, remark);
    else localStorage.removeItem(PREFIX + characterId);
    window.dispatchEvent(new Event(CHANGE));
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
