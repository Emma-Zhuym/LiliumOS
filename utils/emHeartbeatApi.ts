// [EM-START: heartbeat-api]
/**
 * Mac mini 心跳用哪套 API（阿萌 2026-10-19：心跳 API 要可选）。
 *
 * 原来写死：副 API 优先，没有就跟聊天 API。可有的中转会偶尔给模型套上别的身份、拒绝角色扮演
 * （心跳记录里的「I'm Kiro…」），想给心跳单独换一套就没地方换。现在每个角色可以选：
 * - 自动（空）：老规矩，副 API → 聊天 API
 * - 'chat'：跟这个角色的聊天 API 走
 * - 设置里任一个命名预设
 * 选的预设被删了就退回自动，并告诉调用方。
 */

import type { APIConfig, ApiPreset, CharacterProfile } from '../types';
import { resolveCharacterApiConfig } from './characterApi';

export const HEARTBEAT_API_AUTO = '';
export const HEARTBEAT_API_CHAT = 'chat';

export interface HeartbeatApiResolution {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** 给界面看的：这次实际用的是哪一套 */
    label: string;
    /** 选的预设已经不在了，退回了自动 */
    missingPresetId?: string;
}

type HeartbeatChar = Pick<CharacterProfile, 'heartbeatApiPresetId' | 'chatApiPresetId' | 'proactiveConfig'>;

const complete = (cfg: { baseUrl?: string; apiKey?: string; model?: string } | undefined | null) =>
    Boolean(cfg?.baseUrl && cfg?.apiKey && cfg?.model);

/** choice 不传就用角色身上存的那个。 */
export const resolveHeartbeatApi = (
    char: HeartbeatChar,
    globalApiConfig: APIConfig,
    apiPresets: ApiPreset[],
    choice: string | undefined = char.heartbeatApiPresetId,
): HeartbeatApiResolution => {
    const chat = resolveCharacterApiConfig(char, globalApiConfig, apiPresets).apiConfig;
    const chatResolution = { baseUrl: chat.baseUrl, apiKey: chat.apiKey, model: chat.model, label: '聊天 API' };
    const picked = (choice ?? '').trim();
    if (picked === HEARTBEAT_API_CHAT) return chatResolution;
    if (picked) {
        const preset = apiPresets.find(item => item.id === picked);
        if (preset && complete(preset.config)) {
            return { baseUrl: preset.config.baseUrl, apiKey: preset.config.apiKey, model: preset.config.model, label: preset.name };
        }
        return { ...autoResolution(char, chatResolution), missingPresetId: picked };
    }
    return autoResolution(char, chatResolution);
};

const autoResolution = (char: HeartbeatChar, chat: HeartbeatApiResolution): HeartbeatApiResolution => {
    const secondary = char.proactiveConfig?.secondaryApi;
    return complete(secondary)
        ? { baseUrl: secondary!.baseUrl, apiKey: secondary!.apiKey, model: secondary!.model, label: '副 API' }
        : chat;
};
// [EM-END: heartbeat-api]
