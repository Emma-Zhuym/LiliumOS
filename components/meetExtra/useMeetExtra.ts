// [EM-START: meet-extra]
import { useEffect, useState } from 'react';
import type { MeetExtra } from '../../utils/meetExtra';
import { MEET_EXTRA_CHANGED_EVENT, MeetExtraDB } from '../../utils/meetExtraDb';
import { MEET_EXTRA_LIVE_EVENT, isMeetExtraWriting, meetExtraLiveText } from '../../utils/meetExtraActions';

/** 书架：全部番外，新的在前；有改动就重读 */
export const useMeetExtras = (): MeetExtra[] | null => {
    const [rows, setRows] = useState<MeetExtra[] | null>(null);
    useEffect(() => {
        let alive = true;
        const load = () => { MeetExtraDB.list().then(r => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); }); };
        load();
        window.addEventListener(MEET_EXTRA_CHANGED_EVENT, load);
        window.addEventListener(MEET_EXTRA_LIVE_EVENT, load);
        return () => { alive = false; window.removeEventListener(MEET_EXTRA_CHANGED_EVENT, load); window.removeEventListener(MEET_EXTRA_LIVE_EVENT, load); };
    }, []);
    return rows;
};

/** 一本：库里那份 + 正在写时流到哪了 */
export const useMeetExtra = (id: string | null): { row: MeetExtra | null | undefined; liveBody?: string; running: boolean } => {
    const [row, setRow] = useState<MeetExtra | null | undefined>(undefined);
    const [liveBody, setLiveBody] = useState<string | undefined>(() => (id ? meetExtraLiveText(id) : undefined));
    const [running, setRunning] = useState(() => (id ? isMeetExtraWriting(id) : false));
    useEffect(() => {
        if (!id) { setRow(null); return; }
        let alive = true;
        const load = () => { MeetExtraDB.get(id).then(r => { if (alive) setRow(r); }).catch(() => { if (alive) setRow(null); }); };
        const onChanged = (e: Event) => { if ((e as CustomEvent).detail?.id === id) load(); };
        const onLive = (e: Event) => {
            if ((e as CustomEvent).detail?.id !== id) return;
            setLiveBody(meetExtraLiveText(id));
            const now = isMeetExtraWriting(id);
            setRunning(now);
            if (!now) load();
        };
        load();
        setRunning(isMeetExtraWriting(id));
        window.addEventListener(MEET_EXTRA_CHANGED_EVENT, onChanged);
        window.addEventListener(MEET_EXTRA_LIVE_EVENT, onLive);
        return () => { alive = false; window.removeEventListener(MEET_EXTRA_CHANGED_EVENT, onChanged); window.removeEventListener(MEET_EXTRA_LIVE_EVENT, onLive); };
    }, [id]);
    return { row, liveBody: running ? liveBody : undefined, running };
};
// [EM-END: meet-extra]
