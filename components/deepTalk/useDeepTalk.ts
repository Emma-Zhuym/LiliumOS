// [EM-START: deep-talk]
import { useCallback, useEffect, useState } from 'react';
import type { Message } from '../../types';
import type { DeepTalkNight } from '../../utils/deepTalk';
import { DeepTalkDB, DEEP_TALK_CHANGED_EVENT } from '../../utils/deepTalkDb';
import { loadNightSegments } from '../../utils/deepTalkActions';

/** 订阅某个角色的深谈变化（状态改了、多了一段话） */
const useDeepTalkChanged = (charId: string | undefined, onChange: () => void) => {
    useEffect(() => {
        if (!charId) return;
        const handler = (event: Event) => {
            if ((event as CustomEvent<{ charId?: string }>).detail?.charId === charId) onChange();
        };
        window.addEventListener(DEEP_TALK_CHANGED_EVENT, handler);
        return () => window.removeEventListener(DEEP_TALK_CHANGED_EVENT, handler);
    }, [charId, onChange]);
};

/** 这个角色正在进行的那一夜（invited / later / open），没有就是 null；loaded 之前是 undefined */
export const useActiveDeepTalk = (charId: string | undefined): DeepTalkNight | null | undefined => {
    const [night, setNight] = useState<DeepTalkNight | null | undefined>(undefined);
    const load = useCallback(() => {
        if (!charId) { setNight(null); return; }
        DeepTalkDB.getActive(charId).then(setNight).catch(() => setNight(null));
    }, [charId]);
    useEffect(() => { setNight(undefined); load(); }, [load]);
    useDeepTalkChanged(charId, load);
    return night;
};

/** 某一夜的所有话，按顺序 */
export const useNightSegments = (charId: string | undefined, nightId: string | undefined): Message[] => {
    const [segments, setSegments] = useState<Message[]>([]);
    const load = useCallback(() => {
        if (!charId || !nightId) { setSegments([]); return; }
        loadNightSegments(charId, nightId).then(setSegments).catch(() => setSegments([]));
    }, [charId, nightId]);
    useEffect(load, [load]);
    useDeepTalkChanged(charId, load);
    return segments;
};

/** 一夜的记录（卡片、信笺用） */
export const useNight = (charId: string | undefined, nightId: string | undefined): DeepTalkNight | null => {
    const [night, setNight] = useState<DeepTalkNight | null>(null);
    const load = useCallback(() => {
        if (!nightId) { setNight(null); return; }
        DeepTalkDB.getNight(nightId).then(setNight).catch(() => setNight(null));
    }, [nightId]);
    useEffect(load, [load]);
    useDeepTalkChanged(charId, load);
    return night;
};

/** 已经结束的那些夜，新的在前 */
export const useClosedNights = (charId: string | undefined): DeepTalkNight[] => {
    const [nights, setNights] = useState<DeepTalkNight[]>([]);
    const load = useCallback(() => {
        if (!charId) { setNights([]); return; }
        DeepTalkDB.listClosed(charId).then(setNights).catch(() => setNights([]));
    }, [charId]);
    useEffect(load, [load]);
    useDeepTalkChanged(charId, load);
    return nights;
};

/** 卡片 → 信笺、蜡烛先留着 → 重新点上：消息项不拿回调，发事件给聊天页 */
export const DEEP_TALK_OPEN_LETTER_EVENT = 'em-deep-talk-open-letter';
export const DEEP_TALK_RELIGHT_EVENT = 'em-deep-talk-relight';

export const openDeepTalkLetter = (charId: string, nightId: string) =>
    window.dispatchEvent(new CustomEvent(DEEP_TALK_OPEN_LETTER_EVENT, { detail: { charId, nightId } }));

export const requestDeepTalkRelight = (charId: string) =>
    window.dispatchEvent(new CustomEvent(DEEP_TALK_RELIGHT_EVENT, { detail: { charId } }));
// [EM-END: deep-talk]
