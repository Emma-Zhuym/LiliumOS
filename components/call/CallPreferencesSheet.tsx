import React from 'react';
import ClayDialog from '../os/ClayDialog';
import { F, R, S } from '../../utils/clayTokens';
import type { CallPreferences } from '../../utils/callPreferences';

export default function CallPreferencesSheet({ preferences, onChange, onClose, onOpenSystemSettings }: {
    preferences: CallPreferences;
    onChange: (value: CallPreferences) => void;
    onClose: () => void;
    onOpenSystemSettings: () => void;
}) {
    return <ClayDialog isOpen title="通话偏好" onClose={onClose}
        footer={<button type="button" onClick={onOpenSystemSettings} className="w-full text-sm" style={{ minHeight: 48, background: F.surface, color: F.textSecondary, boxShadow: S.raisedSoft, borderRadius: R.button }}>更多语音与 API 设置</button>}>
        <p className="text-xs leading-relaxed mb-5" style={{ color: F.textSecondary }}>适用于语音和视频通话。选择后立即保存。</p>
        <div className="text-sm font-semibold mb-3">谁先开口</div>
        <div role="group" aria-label="谁先开口" className="grid grid-cols-2 gap-1 p-1 mb-5" style={{ borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}>
            {[{ value: true, label: '对方先说' }, { value: false, label: '我先说' }].map(option => (
                <button key={option.label} type="button" aria-pressed={preferences.characterInitiative === option.value} onClick={() => onChange({ ...preferences, characterInitiative: option.value })}
                    className="text-sm" style={{ minHeight: 44, borderRadius: R.button, background: preferences.characterInitiative === option.value ? F.surface : 'transparent', boxShadow: preferences.characterInitiative === option.value ? S.raisedSoft : undefined, color: F.textPrimary }}>{option.label}</button>
            ))}
        </div>
        {([
            { key: 'voiceAutoPlay', label: '自动播放语音', detail: '关闭后只显示文字，点“播放语音”时才生成音频。未配置语音服务时可以直接阅读。' },
            { key: 'idleNudgeEnabled', label: '沉默后主动接话', detail: '安静较久时允许对方主动接话，会请求聊天模型。每段沉默最多两次，你回应后重新计数。' },
        ] as const).map(item => (
            <button key={item.key} type="button" role="switch" aria-label={item.label} aria-checked={preferences[item.key]} onClick={() => onChange({ ...preferences, [item.key]: !preferences[item.key] })}
                className="w-full flex items-center justify-between gap-4 py-4 text-left border-t" style={{ minHeight: 64, borderColor: F.divider }}>
                <span className="min-w-0"><span className="block text-sm font-semibold">{item.label}</span><span className="block text-xs leading-relaxed mt-1" style={{ color: F.textSecondary }}>{item.detail}</span></span>
                <span className="w-10 h-6 flex items-center p-1 shrink-0" style={{ borderRadius: R.pill, background: preferences[item.key] ? F.accent : F.surfaceSunken, boxShadow: S.sunken }}><span className="w-4 h-4" style={{ borderRadius: R.pill, background: F.surface, boxShadow: S.raisedSoft, transform: preferences[item.key] ? 'translateX(16px)' : undefined }} /></span>
            </button>
        ))}
    </ClayDialog>;
}
