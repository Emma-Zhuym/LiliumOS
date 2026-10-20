// [EM-START: char-drives-engine]
/**
 * 心跳面板里每个角色的「脾气」：副 API 读人设生成，阿萌可以逐项改。改完存在角色身上（随备份走），
 * 并马上补传一份近况快照，mini 下一跳就按新的来。规格见 docs/spec-character-drives.md 5.6。
 * 样式沿用这个面板已有的那几种写法，不另取值。
 */

import React, { useState } from 'react';

import type { CharacterProfile, DriveKey, DriveLevel, DriveTemperament } from '../../types';
import { useTemperament } from '../../hooks/useTemperament';
import {
    DRIVE_KEYS, DRIVE_NAMES, LEVEL_NAMES, OUTLET_NAMES, RECOVERY_NAMES, editTemperament,
} from '../../utils/emTemperament';

const SELECT = 'rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 outline-none';
const BTN = 'px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 active:scale-95 transition-all disabled:opacity-50';
const LEVELS: DriveLevel[] = ['low', 'mid', 'high'];

export default function TemperamentEditor({ char }: { char: CharacterProfile }) {
    const [open, setOpen] = useState(false);
    const { temperament: t, busy, save, read } = useTemperament(char); // [EM: machine-room] 跟机房 App 共用

    const setLevel = (field: 'baseline' | 'sensitivity', key: DriveKey, level: DriveLevel) =>
        t && void save(editTemperament(t, { [field]: { ...t[field], [key]: level } }));

    return <div className="mt-1.5">
        <button type="button" onClick={() => setOpen(v => !v)} className="text-[10px] text-slate-400 underline">
            {t ? `脾气（${t.source === 'confirmed' ? '你改过' : '自动读的'}）` : '脾气：还没读过'}
        </button>
        {open && <div className="mt-1.5 space-y-1.5 rounded-xl border border-slate-200 bg-white p-2">
            {!t && <p className="text-[10px] text-slate-400">读一下人设，定这个角色各种心思平时多强、多容易被触动。读完可以改。</p>}
            {t && <>
                {t.reasoning && <p className="text-[10px] text-slate-400">{t.reasoning}</p>}
                <div className="grid grid-cols-[3rem_1fr_1fr] gap-x-1.5 gap-y-1 items-center text-[10px] text-slate-500">
                    <span />
                    <span className="text-slate-400">平时</span>
                    <span className="text-slate-400">多容易触动</span>
                    {DRIVE_KEYS.filter(key => !t.disabled.includes(key)).map(key => (
                        <React.Fragment key={key}>
                            <span>{DRIVE_NAMES[key]}</span>
                            {(['baseline', 'sensitivity'] as const).map(field => (
                                <select key={field} className={SELECT} value={t[field][key] ?? 'mid'} disabled={busy}
                                    onChange={event => setLevel(field, key, event.target.value as DriveLevel)}>
                                    {LEVELS.map(level => <option key={level} value={level}>{LEVEL_NAMES[level]}</option>)}
                                </select>
                            ))}
                        </React.Fragment>
                    ))}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                    <label>别扭、压力消得
                        <select className={`${SELECT} ml-1`} value={t.recovery} disabled={busy}
                            onChange={event => void save(editTemperament(t, { recovery: event.target.value as DriveTemperament['recovery'] }))}>
                            {Object.entries(RECOVERY_NAMES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                        </select>
                    </label>
                    <label>压力大时
                        <select className={`${SELECT} ml-1`} value={t.stressOutlet} disabled={busy}
                            onChange={event => void save(editTemperament(t, { stressOutlet: event.target.value as DriveTemperament['stressOutlet'] }))}>
                            {Object.entries(OUTLET_NAMES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                        </select>
                    </label>
                </div>
                {t.disabled.length > 0 && <p className="text-[10px] text-slate-400">不适用：{t.disabled.map(key => DRIVE_NAMES[key]).join('、')}</p>}
            </>}
            <button type="button" disabled={busy} onClick={() => void read()} className={BTN}>{busy ? '读着呢…' : t ? '重新读一遍' : '读一下'}</button>
        </div>}
    </div>;
}
// [EM-END: char-drives-engine]
