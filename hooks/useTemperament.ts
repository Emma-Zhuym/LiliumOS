// [EM-START: machine-room]
/**
 * 脾气读数的两件事：读人设生成一份、改某一项。神经链接里的「脾气」卡用它（2026-10-27 从机房搬过去）。
 * 改完存在角色身上（随备份走），配对了 mini 就顺手重传一份近况，mini 下一跳就按新的算。
 *
 * persist：神经链接那页是「改 formData → 整份自动存」，直接 updateCharacter 会被它下一次自动存盖回去，
 * 所以那里传 persist 走页面自己的 handleChange；不传就直接写角色。
 */

import { useState } from 'react';

import { useOS } from '../context/OSContext';
import type { CharacterProfile, DriveTemperament } from '../types';
import { isAgentPaired } from '../utils/emAgentBackend';
import { uploadCharacterSnapshot } from '../utils/emAgentConnect';
import { resolveHeartbeatApi } from '../utils/emHeartbeatApi';
import { generateTemperament } from '../utils/emTemperament';

export const useTemperament = (char: CharacterProfile, persist?: (next: DriveTemperament) => void) => {
    const { addToast, apiConfig, apiPresets, updateCharacter, userProfile } = useOS();
    const [busy, setBusy] = useState(false);

    const save = async (next: DriveTemperament) => {
        if (persist) persist(next);
        else updateCharacter(char.id, { emDriveTemperament: next });
        if (isAgentPaired()) await uploadCharacterSnapshot({ ...char, emDriveTemperament: next }, userProfile?.name);
    };

    /** 读人设：优先角色的副 API（情绪评估那套），没配就用心跳那套。 */
    const read = async () => {
        setBusy(true);
        try {
            const emotionApi = char.emotionConfig?.api;
            const api = emotionApi?.baseUrl && emotionApi.apiKey && emotionApi.model
                ? emotionApi
                : resolveHeartbeatApi(char, apiConfig, apiPresets);
            const next = await generateTemperament(char, api);
            await save(next);
            addToast(`读好了：${next.reasoning || char.name}`, 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '读脾气失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    return { temperament: char.emDriveTemperament, busy, save, read };
};
// [EM-END: machine-room]
