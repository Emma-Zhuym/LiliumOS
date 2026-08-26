import type { APIConfig } from '../types';
import { normalizeApiConfig } from './apiConfigNormalize';

const STORAGE_KEY = 'check_phone_api';
export const CHECK_PHONE_API_CHANGED_EVENT = 'check-phone-api-changed';

/** CheckPhone-specific API. Null means that CheckPhone follows the chat default. */
export function getCheckPhoneApi(): APIConfig | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = normalizeApiConfig(JSON.parse(raw) as APIConfig);
        return parsed.baseUrl ? parsed : null;
    } catch {
        return null;
    }
}

export function setCheckPhoneApi(config: APIConfig | null): void {
    try {
        if (!config?.baseUrl) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeApiConfig(config)));
        window.dispatchEvent(new CustomEvent(CHECK_PHONE_API_CHANGED_EVENT));
    } catch {
        // localStorage can be unavailable in private or restricted contexts.
    }
}

export function resolveCheckPhoneApi(independent: APIConfig | null, chatDefault: APIConfig): APIConfig {
    return independent?.baseUrl ? independent : chatDefault;
}
