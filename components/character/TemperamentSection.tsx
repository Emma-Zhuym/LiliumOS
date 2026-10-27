// [EM-START: machine-room-split]
/**
 * 神经链接 · 设定页里的「脾气」：这个角色各种心思平时多强、多容易被触动、别扭消得多快、压力大时往哪去。
 * mini 的心思系统按它算；读人设生成一份，每一项都能改（改过就标「你改过」）。
 *
 * 2026-10-27 从机房的角色详情搬来（阿萌：一次调好就不碰，不想天天看到能调）。
 * 读写走 hooks/useTemperament.ts；这页是 formData 自动存，所以改动经 onChange 交回页面。
 * 神经链接这一页的主色是 indigo（桌面图标的颜色），取值都从 clayTokens。
 */

import React from 'react';

import type { CharacterProfile, DriveKey, DriveLevel, DriveTemperament } from '../../types';
import { F, HUE, R } from '../../utils/clayTokens';
import { DRIVE_KEYS, DRIVE_NAMES, LEVEL_NAMES, OUTLET_NAMES, RECOVERY_NAMES, editTemperament } from '../../utils/emTemperament';
import { useTemperament } from '../../hooks/useTemperament';

const P = HUE.indigo;
const LEVELS: DriveLevel[] = ['low', 'mid', 'high'];

const selectStyle: React.CSSProperties = {
    background: F.surfaceSunken, border: '1px solid transparent', borderRadius: R.input, padding: '4px 8px',
    fontSize: 12, color: F.textPrimary, outline: 'none', maxWidth: '100%',
};

const TemperamentSection: React.FC<{ char: CharacterProfile; onChange: (next: DriveTemperament) => void }> = ({ char, onChange }) => {
    const { temperament: t, busy, save, read } = useTemperament(char, onChange);
    const setLevel = (field: 'baseline' | 'sensitivity', key: DriveKey, level: DriveLevel) =>
        t && void save(editTemperament(t, { [field]: { ...t[field], [key]: level } }));
    const select = (value: string, change: (value: string) => void, options: [string, string][], label: string) => (
        <select aria-label={label} value={value} disabled={busy} onChange={event => change(event.target.value)} style={selectStyle}>
            {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
    );

    return (
        <div style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, padding: '14px 16px' }}>
            <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>脾气</span>
                {t && (
                    <span className="shrink-0" style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: R.pill, background: t.source === 'confirmed' ? P.tint : F.surfaceSunken, color: t.source === 'confirmed' ? P.ink : F.textSecondary }}>
                        {t.source === 'confirmed' ? '你改过' : '自动读的'}
                    </span>
                )}
                <span className="flex-1" />
                <button type="button" onClick={() => void read()} disabled={busy}
                    className="shrink-0 clay-press disabled:opacity-50"
                    style={{ padding: '8px 14px', borderRadius: R.pill, background: P.tint, color: P.ink, fontSize: 13, fontWeight: 600, border: 'none' }}>
                    {busy ? '读着呢…' : t ? '重新读一遍' : '读一下'}
                </button>
            </div>
            <p style={{ fontSize: 12, color: F.textTertiary, marginTop: 6, lineHeight: 1.6 }}>
                {t?.reasoning || '读一下人设，定这个角色各种心思平时多强、多容易被触动。读完每一项都能改。Mac mini 的心思系统按这份算。'}
            </p>
            {t && (
                <>
                    <div className="grid items-center" style={{ gridTemplateColumns: '3.5rem 1fr 1fr', gap: '6px 8px', marginTop: 10, fontSize: 13, color: F.textSecondary }}>
                        <span />
                        <span style={{ fontSize: 12, color: F.textTertiary }}>平时</span>
                        <span style={{ fontSize: 12, color: F.textTertiary }}>多容易触动</span>
                        {DRIVE_KEYS.filter(key => !t.disabled.includes(key)).map(key => (
                            <React.Fragment key={key}>
                                <span>{DRIVE_NAMES[key]}</span>
                                {(['baseline', 'sensitivity'] as const).map(field => (
                                    <React.Fragment key={field}>
                                        {select(t[field][key] ?? 'mid', value => setLevel(field, key, value as DriveLevel), LEVELS.map(level => [level, LEVEL_NAMES[level]]), `${DRIVE_NAMES[key]}${field === 'baseline' ? '平时' : '多容易触动'}`)}
                                    </React.Fragment>
                                ))}
                            </React.Fragment>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center" style={{ gap: '8px 12px', marginTop: 10, fontSize: 13, color: F.textSecondary }}>
                        <span className="flex items-center" style={{ gap: 6 }}>别扭、压力消得
                            {select(t.recovery, value => void save(editTemperament(t, { recovery: value as DriveTemperament['recovery'] })), Object.entries(RECOVERY_NAMES), '别扭压力消得快慢')}
                        </span>
                        <span className="flex items-center" style={{ gap: 6 }}>压力大时
                            {select(t.stressOutlet, value => void save(editTemperament(t, { stressOutlet: value as DriveTemperament['stressOutlet'] })), Object.entries(OUTLET_NAMES), '压力出口')}
                        </span>
                    </div>
                    {t.disabled.length > 0 && <p style={{ fontSize: 12, color: F.textTertiary, marginTop: 8 }}>不适用：{t.disabled.map(key => DRIVE_NAMES[key]).join('、')}</p>}
                </>
            )}
        </div>
    );
};

export default TemperamentSection;
// [EM-END: machine-room-split]
