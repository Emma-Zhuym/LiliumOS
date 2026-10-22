// [EM-START: machine-room]
/**
 * 把一个角色接到 Mac mini 后端：登记 → 同步心跳要用的 API → 传一份近况。
 * 机房 App 的角色详情用它（原来设置里的心跳面板 2026-10-21 已并进机房）。
 *
 * 三步都做完心跳才有可能真的跑起来；少了 API 后端调不动模型，
 * 少了近况后端会一直卡在「还没收到近况」这道闸上安静跳过。
 */

import type { APIConfig, ApiPreset, CharacterProfile } from '../types';
import { DB } from './db';
import { resolveHeartbeatApi } from './emHeartbeatApi';
import { generateTemperament } from './emTemperament';
import { buildCharacterSnapshot } from './emAgentSnapshot';
import { AgentBackend, flushSnapshotUpload } from './emAgentBackend';

export interface ConnectResult { ok: boolean; message: string }

/** 凭据在 mini 上的名字：一个角色一份。 */
export const credRefFor = (charId: string) => `char-${charId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);

/** 重新传一份近况（脾气改了、接上之后）。失败不抛：下次聊天或打开 App 时会再传。 */
export const uploadCharacterSnapshot = async (char: CharacterProfile, userName?: string): Promise<boolean> => {
    try {
        const messages = await DB.getMessagesByCharId(char.id);
        return await flushSnapshotUpload(await buildCharacterSnapshot(char, messages, { userName }));
    } catch {
        return false;
    }
};

/**
 * 接上 / 重新同步。choice 是刚在下拉里选的那套 API（角色身上的字段还没来得及更新）。
 * 还没读过脾气的角色顺手读一次，读到了经 onTemperament 存回角色身上；失败不拦接入。
 */
export const connectCharacterToAgent = async (
    char: CharacterProfile,
    { apiConfig, apiPresets, userName, choice, onTemperament }: {
        apiConfig: APIConfig;
        apiPresets: ApiPreset[];
        userName?: string;
        choice?: string;
        onTemperament?: (temperament: NonNullable<CharacterProfile['emDriveTemperament']>) => void;
    },
): Promise<ConnectResult> => {
    // 心跳用哪套 API 由角色自己选（emHeartbeatApi.ts）；没选时优先副 API，没配副 API 才跟聊天 API
    const resolved = resolveHeartbeatApi(char, apiConfig, apiPresets, choice);
    if (!resolved.apiKey || !resolved.baseUrl || !resolved.model) {
        return { ok: false, message: '这个角色还没配好 API（地址 / Key / 模型）' };
    }
    const ref = credRefFor(char.id);
    await AgentBackend.putCredential({ ref, baseUrl: resolved.baseUrl, model: resolved.model, apiKey: resolved.apiKey });
    await AgentBackend.upsertCharacter({ charId: char.id, displayName: char.name, runtime: 'api', credRef: ref });

    let forSnapshot = char;
    if (!char.emDriveTemperament) {
        try {
            const emotionApi = char.emotionConfig?.api;
            const readApi = emotionApi?.baseUrl && emotionApi.apiKey && emotionApi.model ? emotionApi : resolved;
            const temperament = await generateTemperament(char, readApi);
            onTemperament?.(temperament);
            forSnapshot = { ...char, emDriveTemperament: temperament };
        } catch (error) {
            console.warn('读脾气失败，先按默认来', error);
        }
    }
    const uploaded = await uploadCharacterSnapshot(forSnapshot, userName);
    const prefix = resolved.missingPresetId ? '选的那套 API 预设已经删掉了，先按自动来。' : '';
    return uploaded
        ? { ok: true, message: `${prefix}已接上（${resolved.label} · ${resolved.model}），近况也传过去了` }
        : { ok: false, message: `${prefix}已接上，但近况没传成功` };
};
// [EM-END: machine-room]
