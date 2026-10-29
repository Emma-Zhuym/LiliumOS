import { useCallback, useEffect, useState } from 'react';
import type { TietieRecord } from '../../utils/tietie';
import { TietieDB, TIETIE_CHANGED_EVENT } from '../../utils/tietieDb';

/** 贴贴按钮 → 聊天页：两个人的时间结束了，去写这一次（detail: charId, startedAt, endedAt） */
export const TIETIE_ENDED_EVENT = 'em-tietie-ended';
/** 卡片 → 聊天页：翻开日记 / 重写 */
export const TIETIE_OPEN_EVENT = 'em-tietie-open';
export const TIETIE_RETRY_EVENT = 'em-tietie-retry';

export const announceTietieEnded = (charId: string, startedAt: number, endedAt: number) =>
    window.dispatchEvent(new CustomEvent(TIETIE_ENDED_EVENT, { detail: { charId, startedAt, endedAt } }));
export const openTietieDiary = (charId: string, recordId: string) =>
    window.dispatchEvent(new CustomEvent(TIETIE_OPEN_EVENT, { detail: { charId, recordId } }));
export const requestTietieRetry = (charId: string, recordId: string) =>
    window.dispatchEvent(new CustomEvent(TIETIE_RETRY_EVENT, { detail: { charId, recordId } }));

/** 一条记录（卡片、日记用），改了就重读 */
export const useTietieRecord = (charId: string | undefined, recordId: string | undefined): TietieRecord | null => {
    const [record, setRecord] = useState<TietieRecord | null>(null);
    const load = useCallback(() => {
        if (!recordId) { setRecord(null); return; }
        TietieDB.get(recordId).then(setRecord).catch(() => setRecord(null));
    }, [recordId]);
    useEffect(load, [load]);
    useEffect(() => {
        if (!charId) return;
        const handler = (event: Event) => {
            if ((event as CustomEvent<{ charId?: string }>).detail?.charId === charId) load();
        };
        window.addEventListener(TIETIE_CHANGED_EVENT, handler);
        return () => window.removeEventListener(TIETIE_CHANGED_EVENT, handler);
    }, [charId, load]);
    return record;
};
