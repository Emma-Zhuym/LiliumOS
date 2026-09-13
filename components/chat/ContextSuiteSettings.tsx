import React from 'react';
import { useOS } from '../../context/OSContext';
import { F, R, S } from '../../utils/clayTokens';

export default function ContextSuiteSettings() {
    const { memoryPalaceConfig, updateMemoryPalaceConfig } = useOS();
    const flags = memoryPalaceConfig.featureFlags;
    const enabled = flags.recallRouter || flags.interactionAdaptation || flags.deepEngagement;
    return <div className="flex items-center gap-4 p-4" style={{ background: F.surface, borderRadius: R.smallCard, boxShadow: S.raisedSoft }}>
        <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold" style={{ color: F.textPrimary }}>智能语境</div>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: F.textSecondary }}>承接话题、识别专名并跟随交流节奏。对所有私聊生效，本地分析不增加模型调用；角色的交流偏好可在记忆宫殿调整。</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="智能语境" onClick={() => updateMemoryPalaceConfig({ featureFlags: { ...flags, recallRouter: !enabled, interactionAdaptation: !enabled, deepEngagement: !enabled } })}
            className="shrink-0 px-4 text-sm font-semibold" style={{ minHeight: 44, borderRadius: R.pill, color: F.textPrimary, background: F.surface, boxShadow: enabled ? S.sunken : S.raisedSoft }}>{enabled ? '已开启' : '开启'}</button>
    </div>;
}
