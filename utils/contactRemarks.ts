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
