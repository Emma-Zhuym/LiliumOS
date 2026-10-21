// [EM-START: emoji-descriptions]
import React, { useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import {
    listEmojiVisionChoices, pickEmojiVisionChoice, readEmojiVisionChoiceId, saveEmojiVisionChoiceId,
    type EmojiVisionChoice,
} from '../../utils/emEmojiDescriptions';
import { F, R } from '../../utils/clayTokens';

/** 读图用哪个 API：识图 API / 主 API / 预设。选过的记在本机。 */
export const useEmojiVisionChoice = () => {
    const { apiConfig, apiPresets } = useOS();
    const choices = useMemo(() => listEmojiVisionChoices(apiConfig, apiPresets), [apiConfig, apiPresets]);
    const [savedId, setSavedId] = useState(readEmojiVisionChoiceId);
    const choice = pickEmojiVisionChoice(choices, savedId);
    const select = (id: string) => { saveEmojiVisionChoiceId(id); setSavedId(id); };
    return { choices, choice, select };
};

export const inputStyle: React.CSSProperties = {
    background: F.surfaceSunken, borderRadius: R.input, color: F.textPrimary, border: '1px solid transparent',
};

/** 描述输入框 + 「让 AI 看一眼」 + 选 API。 */
export const EmojiDescriptionField: React.FC<{
    value: string;
    onChange: (value: string) => void;
    busy: boolean;
    onDescribe: (choice: EmojiVisionChoice) => void;
    choices: EmojiVisionChoice[];
    choice: EmojiVisionChoice | null;
    onSelectChoice: (id: string) => void;
}> = ({ value, onChange, busy, onDescribe, choices, choice, onSelectChoice }) => <div className="space-y-2">
    <div className="text-xs font-semibold" style={{ color: F.textSecondary }}>图上画了什么（你发这个表情时角色会看到）</div>
    <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="比如：一只小狗叼着空食盆，眼巴巴往上看"
        rows={3}
        maxLength={120}
        className="w-full px-3 py-2 text-sm resize-none focus:outline-none"
        style={inputStyle}
    />
    {choices.length === 0
        ? <p className="text-xs leading-5" style={{ color: F.textTertiary }}>想让 AI 帮忙写，先在设置里填好识图 API 或者一个 API 预设（模型要能看图）。</p>
        : <div className="flex items-center gap-2">
            <select
                value={choice?.id ?? ''}
                onChange={e => onSelectChoice(e.target.value)}
                className="min-w-0 flex-1 h-9 px-2 text-xs focus:outline-none"
                style={inputStyle}
                aria-label="读图用哪个 API"
            >
                {choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <button
                type="button"
                disabled={busy || !choice}
                onClick={() => choice && onDescribe(choice)}
                className="shrink-0 h-9 px-3 text-xs font-semibold clay-press disabled:opacity-50"
                style={{ background: F.textPrimary, color: F.surface, borderRadius: R.button }}
            >
                {busy ? '在看…' : '让 AI 看一眼'}
            </button>
        </div>}
</div>;
// [EM-END: emoji-descriptions]
