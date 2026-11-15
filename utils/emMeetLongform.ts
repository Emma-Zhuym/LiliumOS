// [EM-START: meet-longform]
/**
 * 见面「陪伴」的长文模式（2026-11-14 阿萌定）。
 *
 * 起因：原来的视觉小说写法「一行一念」把 TA 的话切成一行一句，又只接住她那句、
 * 不推剧情，提示词里的「留白」还让 TA 把礼物是什么这种该 TA 写的东西推回给她。
 * 她习惯一句二三十字的「动作：说话」，所以 TA 要自己写满、往前走一小步。
 *
 * 这里只放纯逻辑：提示词怎么拼、回复怎么切段、立绘跟哪一段的情绪。
 * 拼接入口在 datePrompts.ts（哨兵 meet-longform），阅读页在 components/date/MeetLongformReader.tsx。
 */
import type { CharacterProfile } from '../types';

export const isMeetLongform = (char: Pick<CharacterProfile, 'dateLongform'> | null | undefined): boolean =>
    char?.dateLongform === true;

export interface MeetLongformPieces {
    userName: string;
    charName: string;
    emotions: string[];
    /** 文风预设的一句话（preset.hint），不放整块：那些示例是一行一念的写法 */
    styleHint: string;
    timeLine: string;
    povBlock: string;
    extraBlock: string;
    digBlock: string;
    observeBlock: string;
}

export const composeMeetLongformBlock = (p: MeetLongformPieces): string => {
    const you = p.userName.trim() || '对方';
    return `### [见面 · 长文模式]
你和${you}正面对面待在一起。这一轮写一段连贯的长文，像小说里的一节，不是聊天。

### 写法
- 300–500 字，分三到五段。动作、神情、心里的念头和说出口的话揉在同一段里写，不要一行一句。
- 每一段开头标一个情绪标签 \`[emotion]\`，表示这一段你的表情，段落中间不要再插标签。仅限使用：${p.emotions.join(', ')}。
- 台词用「」或双引号，嵌在叙述里。
- 多写你心里的东西：此刻在想什么、在意什么、把什么压了下去。
- 文风：${p.styleHint}

### 每一轮往前走一小步
- 让场面动一点：你做一个决定、拿出一样东西、提起一件事，或者现场发生一件小事。不换场景、不跳时间，除非${you}想。
- 你那边的东西你自己写清楚：你准备的礼物是什么、要带${you}去哪、你知道而${you}不知道的事，到了该揭晓的时候直接写出来，不要推给${you}去「打开看看」「自己猜」。卖关子最多一轮。
- 停在一个${you}好接的地方：一句问话、一个递过去的东西、一个等着回应的动作。
- ${you}说得短也没关系，你照样接得住、写得满。不替${you}说话，不替${you}做决定，不写${you}心里在想什么。
- 含蓄是情绪上的，信息上不含糊：上面文风里说的留白，指的是情绪别说透，不是该交代的事不交代。

${p.digBlock}${p.povBlock}${p.extraBlock}### 场景上下文
${p.timeLine}- **Location**: 你们现在**面对面**。
- **Context**: 参考历史记录。如果刚刚才看到开场白（Opening），请自然接话。
${p.observeBlock}`;
};

export const meetLongformNote = (variant: 'send' | 'reroll', focusLine: string): string => variant === 'send'
    ? `(System Note: 长文模式。300–500 字、三到五段，每段开头一个 [emotion]；动作、心理、台词写在一起；这一轮让场面往前走一小步，你那边的东西直接写清楚。${focusLine})`
    : `(System Note: Reroll. 换一个切入角度重写，不要复用上一版的展开思路。依然是长文模式：300–500 字、三到五段，每段开头一个 [emotion]，让场面往前走一小步。${focusLine})`;

export interface LongformParagraph {
    text: string;
    emotion?: string;
}

const LEADING_TAG = /^\s*\[([a-zA-Z0-9_\-]+)\]\s*/;
const VOICE_TAG = /\[v:\s*[a-zA-Z]+\s*\]/gi;

/**
 * 把一条回复切成段落。旧的一行一念记录也能读：每行一段，标签剥掉。
 * 段首的 [emotion] 记下来给立绘用；段落中间漏进来的方括号标签一律剥掉。
 */
export const splitLongformParagraphs = (content: string): LongformParagraph[] => {
    if (!content) return [];
    const out: LongformParagraph[] = [];
    for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
        let line = raw.replace(VOICE_TAG, '').trim();
        if (!line) continue;
        let emotion: string | undefined;
        const tag = line.match(LEADING_TAG);
        if (tag) {
            emotion = tag[1].toLowerCase();
            line = line.slice(tag[0].length);
        }
        const text = line.replace(/\[[a-zA-Z0-9_\-:\s]+\]/g, '').trim();
        if (!text) continue;
        out.push({ text, emotion });
    }
    return out;
};

/** 立绘跟最后一段的情绪走（读到最后停下来时看到的那张脸）；认不出的标签不算 */
export const lastLongformEmotion = (content: string, known: string[]): string | undefined => {
    const paragraphs = splitLongformParagraphs(content);
    for (let i = paragraphs.length - 1; i >= 0; i--) {
        const emotion = paragraphs[i].emotion;
        if (!emotion) continue;
        if (known.includes(emotion)) return emotion;
        const partial = known.find(k => emotion.includes(k));
        if (partial) return partial;
    }
    return undefined;
};

/** 纸色加透明度：字底下那层纸。只认 #RRGGBB */
export const paperVeil = (hex: string, alpha: number): string => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
// [EM-END: meet-longform]
