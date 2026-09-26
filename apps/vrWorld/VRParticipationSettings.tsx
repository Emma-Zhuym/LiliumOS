import React, { useEffect, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { CharacterProfile, VRWorldNovel, VRRoomId } from '../../types';
import { F, R, S, HUE } from '../../utils/clayTokens';
import { VRScheduler } from '../../utils/vrWorld/scheduler';
import { allowsAutomaticVR } from '../../utils/vrWorld/participation';
import { readableNovels } from '../../utils/vrWorld/library';
import { ORDINARY_ACTIVITIES } from '../../utils/vrWorld/activityChoices';
import { VR_DEFAULT_INTERVAL_MIN } from '../../utils/vrWorld/constants';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../../components/character/CharacterGroupFilter';
import ClayDialog from '../../components/os/ClayDialog';

const button = { minHeight: 44, borderRadius: R.button, color: F.textPrimary, background: F.surface, boxShadow: S.raisedSoft };
export default function VRParticipationSettings({ characters, updateCharacter, addToast, novels, onReload, onRequestEnable, onEditChibi }: {
    characters: CharacterProfile[]; updateCharacter: (id: string, updates: Partial<CharacterProfile> | ((current: CharacterProfile) => Partial<CharacterProfile>)) => void;
    addToast?: (message: string, type?: any) => void; novels: VRWorldNovel[]; onReload: () => void;
    onRequestEnable: (char: CharacterProfile) => void; onEditChibi: (char: CharacterProfile) => void;
}) {
    const { characterGroups, registerBackHandler } = useOS();
    const [groupId, setGroupId] = useState(GROUP_FILTER_ALL);
    const [pickId, setPickId] = useState<string | null>(null);
    const [inRooms, setInRooms] = useState(false);
    const pickFor = characters.find(char => char.id === pickId);
    const closePicker = () => { setPickId(null); setInRooms(false); };
    useEffect(() => registerBackHandler(() => { if (!pickId) return false; if (inRooms) setInRooms(false); else closePicker(); return true; }), [registerBackHandler, pickId, inRooms]);
    const patch = (char: CharacterProfile, values: Partial<NonNullable<CharacterProfile['vrState']>>) => updateCharacter(char.id, current => ({ vrState: { intervalMinutes: VR_DEFAULT_INTERVAL_MIN, enabled: false, ...current.vrState, ...values } }));
    const mode = (char: CharacterProfile, activityMode: 'manual' | 'scheduled') => {
        patch(char, { activityMode });
        if (activityMode === 'scheduled' && char.vrState?.enabled) VRScheduler.start(char.id, char.vrState.intervalMinutes || VR_DEFAULT_INTERVAL_MIN);
        else VRScheduler.stop(char.id);
    };
    const go = (room?: VRRoomId) => {
        if (!pickFor) return;
        VRScheduler.triggerNow(pickFor.id, room); addToast?.(`${pickFor.name} 正在前往彼方…`, 'info'); closePicker(); setTimeout(onReload, 4000);
    };
    return <div className="space-y-4" style={{ color: F.textPrimary }}>
        <p className="rounded-2xl p-4 text-sm leading-relaxed" style={{ background: F.surface, color: F.textSecondary }}>新加入的角色默认等待你的邀请。切到定时活动后，会按间隔请求模型；连续三次模型失败会停止并提醒你。</p>
        <CharacterGroupFilterBar characters={characters} groups={characterGroups} value={groupId} onChange={setGroupId} />
        {filterCharactersByGroup(characters, characterGroups, groupId).map(char => { const state = char.vrState, automatic = allowsAutomaticVR(state), excluded = state?.excludedAutoRooms || []; return <section key={char.id} className="space-y-4 p-5" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
            <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{char.name}</h3><p className="mt-1 text-xs" style={{ color: F.textSecondary }}>{!state?.enabled ? '未接入' : automatic ? `每 ${state.intervalMinutes || VR_DEFAULT_INTERVAL_MIN} 分钟活动` : '仅手动邀请'}</p></div><button onClick={() => onEditChibi(char)} className="px-3 text-xs" style={button}>形象</button><button aria-label={`${state?.enabled ? '退出' : '接入'}${char.name}`} onClick={() => { if (state?.enabled) { patch(char, { enabled: false }); VRScheduler.stop(char.id); } else onRequestEnable(char); }} className="px-3 text-xs font-semibold" style={button}>{state?.enabled ? '退出' : '接入'}</button></div>
            {state?.enabled && <>
                <div className="grid grid-cols-2 gap-2 rounded-2xl p-1" style={{ boxShadow: S.sunken }}>{(['manual', 'scheduled'] as const).map(value => <button key={value} aria-pressed={automatic === (value === 'scheduled')} onClick={() => mode(char, value)} className="px-3 text-sm" style={{ ...button, background: automatic === (value === 'scheduled') ? HUE.violet.tint : F.surface, boxShadow: 'none' }}>{value === 'manual' ? '手动邀请' : '定时活动'}</button>)}</div>
                {automatic && <div className="flex flex-wrap gap-2">{[60, 120, 180, 360, 720].map(minutes => <button key={minutes} aria-pressed={state.intervalMinutes === minutes} onClick={() => { patch(char, { intervalMinutes: minutes }); VRScheduler.start(char.id, minutes); }} className="px-3 text-xs" style={{ ...button, background: state.intervalMinutes === minutes ? HUE.violet.tint : F.surface }}>{minutes / 60} 小时</button>)}</div>}
                {VRScheduler.getFailStreak(char.id) > 0 && <p className="text-xs" style={{ color: F.textSecondary }}>连续模型失败 {VRScheduler.getFailStreak(char.id)}/3 次</p>}
                <button onClick={() => { setPickId(char.id); setInRooms(false); }} className="w-full px-4 text-sm font-semibold" style={button}>邀请一次活动</button>
                <details><summary className="min-h-11 cursor-pointer content-center text-sm">自动活动范围 · {excluded.length ? `${excluded.length} 处不前往` : '全部开放'}</summary><p className="mb-3 text-xs leading-relaxed" style={{ color: F.textSecondary }}>勾选不希望角色自动去的地方。手动邀请仍可前往；已经开始的一轮可以完成。</p><div className="grid grid-cols-2 gap-2">{ORDINARY_ACTIVITIES.map(activity => <label key={activity.id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={excluded.includes(activity.id)} onChange={() => updateCharacter(char.id, current => { const old = current.vrState?.excludedAutoRooms || []; return { vrState: { enabled: false, intervalMinutes: VR_DEFAULT_INTERVAL_MIN, ...current.vrState, excludedAutoRooms: old.includes(activity.id) ? old.filter(id => id !== activity.id) : [...old, activity.id] } }; })} /><span>{activity.name}</span></label>)}</div></details>
            </>}
        </section>; })}
        <ClayDialog isOpen={!!pickFor} title={inRooms ? '普通空间' : `邀请 ${pickFor?.name || ''}`} onClose={() => inRooms ? setInRooms(false) : closePicker()} footer={!inRooms && <button onClick={() => go()} className="w-full px-4 text-sm" style={button}>随便逛逛</button>}>
            {!inRooms ? <button onClick={() => setInRooms(true)} className="flex w-full items-center justify-between gap-3 p-4 text-left" style={button}><span><span className="block font-semibold">普通空间</span><span className="mt-1 block text-xs" style={{ color: F.textSecondary }}>读书、听歌、写信、留言……</span></span><CaretRight size={20} /></button> : <div className="space-y-3"><button onClick={() => setInRooms(false)} className="flex items-center gap-2 px-3 text-sm" style={button}><CaretLeft size={20} />返回分类</button>{ORDINARY_ACTIVITIES.map(activity => <button key={activity.id} disabled={activity.id === 'library' && (!pickFor || !readableNovels(novels, pickFor).length)} onClick={() => go(activity.id)} className="block w-full p-4 text-left disabled:opacity-40" style={button}><span className="block text-sm font-semibold">{activity.name}</span><span className="mt-1 block text-xs" style={{ color: F.textSecondary }}>{activity.id === 'library' && pickFor && !readableNovels(novels, pickFor).length ? '阅读范围内还没有书' : activity.description}</span></button>)}</div>}
        </ClayDialog>
    </div>;
}
