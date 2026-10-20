// [EM-START: char-drives-engine]
/**
 * 查手机首页的状态小组件：TA 此刻身上最强的一两种心思，写成一句话（docs/spec-character-drives.md 第 6 节）。
 *
 * 阿萌定：要能看到，但不完全展示、不放聊天页能直达的地方——所以只在查手机，只给一两句、不给数字。
 * mini 不在线时显示上次拉到的（缓存），都在平常水平时不占位置。样式跟草稿箱同一套（CheckPhone 的 CF）。
 */

import React, { useEffect, useState } from 'react';
import { Pulse } from '@phosphor-icons/react';

import { AgentBackend, isAgentPaired } from '../../utils/emAgentBackend';
import type { DraftsWidgetPalette } from './DraftsWidget';
import { statusPhrase } from '../../utils/emDriveStatus';

type Level = 'mid' | 'high';

const cacheKey = (charId: string) => `em_drive_status_v1:${charId}`;
const readCache = (charId: string): { drive: string; level: Level }[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(cacheKey(charId)) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const StatusWidget: React.FC<{ charId: string; palette: DraftsWidgetPalette }> = ({ charId, palette }) => {
    const [drives, setDrives] = useState(() => readCache(charId));

    useEffect(() => {
        let alive = true;
        setDrives(readCache(charId));
        if (!isAgentPaired()) return;
        AgentBackend.drives(charId)
            .then(next => {
                if (!alive) return;
                setDrives(next);
                try { localStorage.setItem(cacheKey(charId), JSON.stringify(next)); } catch { /* 存不下就算了 */ }
            })
            .catch(() => { /* mini 不在线：显示上次的 */ });
        return () => { alive = false; };
    }, [charId]);

    const phrase = statusPhrase(drives);
    if (!phrase) return null;

    return (
        <div className="rounded-[20px] px-4 py-3 mb-4 flex items-center justify-between gap-3" style={{ background: palette.cardBg, border: `1px solid ${palette.border}` }}>
            <span className="text-[11px] font-semibold tracking-wide uppercase shrink-0" style={{ fontFamily: palette.mono, color: palette.text }}>Status</span>
            <span className="flex items-center gap-1.5 text-[12px] min-w-0 truncate" style={{ fontFamily: palette.font, color: palette.text }}>
                <Pulse size={13} weight="light" style={{ color: palette.sub }} />
                {phrase}
            </span>
        </div>
    );
};

export default StatusWidget;
// [EM-END: char-drives-engine]
