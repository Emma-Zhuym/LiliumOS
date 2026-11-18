// [EM-START: meet-redesign]
/**
 * 见面「怎么写」的设置怎么读（2026-11-17 阿萌定，契约见 docs/spec-meet-redesign.md）。
 *
 * 以前有两套写作风格同时生效：上游的 dateStyleConfig.style（5 种）和 EM 的 dateWritingStyle（16 种）。
 * 现在只认 EM 那 16 种。旧数据不改库，读的时候折算：
 *   - dateWritingStyle 是预设 key → 用它
 *   - 否则看上游 style，按意思对到 EM 的一种（缺省的电影感不迁，算「默认」）
 *   - dateWritingStyle 是一段自定义文字 → 并进「补充要求」
 * 设置页一改风格就写 dateWritingStyle 并清掉上游 style，之后就不再折算。
 */
import type { CharacterProfile, DateStyleConfig } from '../types';
import { DATE_WRITING_STYLE_PRESETS, resolveDateWritingStylePreset, type DateWritingStylePreset } from './dateWritingStyle';

/** 上游 5 种 → EM 16 种。lyrical 两边同名但不是一个意思，别按 key 直接对 */
export const UPSTREAM_STYLE_TO_EM: Record<string, string> = {
    cinematic: 'cinematic',
    plain: 'minimal',
    lyrical: 'immersive',
    playful: 'comedy',
    intense: 'sweet',
};

type StyleSource = Pick<CharacterProfile, 'dateWritingStyle' | 'dateStyleConfig'>;

const customWritingStyle = (char: StyleSource): string => {
    const raw = (char.dateWritingStyle || '').trim();
    return raw && !resolveDateWritingStylePreset(raw) ? raw : '';
};

/** 现在用的是哪一种（EM 预设 key）；undefined = 默认 */
export const meetStyleKey = (char: StyleSource): string | undefined => {
    const raw = (char.dateWritingStyle || '').trim();
    if (raw) {
        const preset = resolveDateWritingStylePreset(raw);
        if (preset) return preset.key;
    }
    const upstream = char.dateStyleConfig?.style;
    return upstream ? UPSTREAM_STYLE_TO_EM[upstream] : undefined;
};

export const meetStylePreset = (char: StyleSource): DateWritingStylePreset | null => {
    const key = meetStyleKey(char);
    return key ? DATE_WRITING_STYLE_PRESETS.find(p => p.key === key) || null : null;
};

/** 补充要求：设置里那一段 + 以前写在「自定义文风」框里的那段 */
export const meetExtraText = (char: StyleSource): string =>
    [(char.dateStyleConfig?.extra || '').trim(), customWritingStyle(char)].filter(Boolean).join('\n');

/** 拼提示词用的 dateStyleConfig：extra 换成合并后的那段，style 不再给见面用 */
export const meetStyleConfig = (char: StyleSource): DateStyleConfig => {
    const extra = meetExtraText(char);
    return { ...(char.dateStyleConfig || {}), style: undefined, extra: extra || undefined };
};

/** 设置页选风格：写 dateWritingStyle、清上游 style；以前的自定义文风挪进 extra，免得选了预设就丢 */
export const meetStylePatch = (char: StyleSource, key: string | undefined): Partial<CharacterProfile> => {
    const extra = meetExtraText(char);
    return {
        dateWritingStyle: key,
        dateStyleConfig: { ...(char.dateStyleConfig || {}), style: undefined, extra: extra || undefined },
    };
};

/** 设置页改补充要求：写进 extra，自定义文风那段一起清掉（已经合在输入框里了） */
export const meetExtraPatch = (char: StyleSource, extra: string): Partial<CharacterProfile> => {
    const patch: Partial<CharacterProfile> = {
        dateStyleConfig: { ...(char.dateStyleConfig || {}), extra: extra.trim() || undefined },
    };
    if (customWritingStyle(char)) patch.dateWritingStyle = meetStyleKey(char);
    return patch;
};

/**
 * 长文模式里的文风：只要「气质」「旋钮」「写法」，不带「例：」——示例是一行一念写的，会把 TA 往回拽。
 * 写法里讲「一行」「每行」的，换成按句说。
 */
export const longformStyleText = (preset: DateWritingStylePreset | null): string => {
    if (!preset) return '沉浸式镜头感，感官细节丰富，有呼吸和停顿。';
    const keep = preset.prompt.split('\n')
        .map(line => line.trim())
        .filter(line => /^(气质|旋钮设定|写法)[:：]/.test(line))
        .map(line => line
            .replace(/一行最多一个动作或一句话/g, '句子短，一句只放一个动作或一句话')
            .replace(/每隔几行/g, '每隔几句')
            .replace(/每行/g, '每一句'));
    return `「${preset.label}」${keep.join('；')}`;
};

/** 感知开场用的那一句 */
export const peekStyleText = (preset: DateWritingStylePreset | null): string =>
    preset ? `文风「${preset.label}」：${preset.desc}` : '电影感，沉浸式，细节丰富';

export type MeetLongformLength = 'short' | 'medium' | 'long';

export const MEET_LONGFORM_LENGTHS: Record<MeetLongformLength, { label: string; words: string; paragraphs: string }> = {
    short: { label: '短', words: '120–250 字', paragraphs: '一到两段' },
    medium: { label: '中', words: '200–400 字', paragraphs: '两到四段' },
    long: { label: '长', words: '400–700 字', paragraphs: '三到五段' },
};

export const meetLongformLength = (char: Pick<CharacterProfile, 'dateLongformLength'> | null | undefined): MeetLongformLength => {
    const v = char?.dateLongformLength;
    return v === 'short' || v === 'long' ? v : 'medium';
};
// [EM-END: meet-redesign]
