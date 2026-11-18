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
import { MEET_LONGFORM_LENGTHS, type MeetLongformLength } from './emMeetStyle';
import { composeMeetCraftBlock } from './emMeetCraft'; // [EM: meet-craft]

/** 2026-11-17 起长文是默认，立绘模式（dateSpriteMode）才是另选的；旧的 dateLongform 不再读 [EM: meet-redesign] */
export const isMeetLongform = (char: Pick<CharacterProfile, 'dateSpriteMode'> | null | undefined): boolean =>
    char?.dateSpriteMode !== true;

export interface MeetLongformPieces {
    userName: string;
    charName: string;
    emotions: string[];
    /** 文风那一行（emMeetStyle.longformStyleText），不放整块：那些示例是一行一念的写法 */
    styleHint: string;
    /** 每轮篇幅，缺省 medium [EM: meet-redesign] */
    length?: MeetLongformLength;
    timeLine: string;
    povBlock: string;
    extraBlock: string;
    digBlock: string;
    observeBlock: string;
    /** 贴贴开着：换亲密写法；stage 是上一轮写到第几段（0 = 刚开始） */
    intimate?: { stage: number };
}

export const INTIMATE_STAGES = ['欲望被察觉', '试探与前戏', '进入', '展开', '张力集中', '换方式或姿势', '高潮', '余韵与事后'];
const STAGE_TAG = /\[\[\s*STAGE\s*[:：]\s*(\d)\s*\]\]/gi;

/** 上一轮 TA 写到第几段：只看这次贴贴开始以后、最后一条带 [[STAGE: n]] 的回复 */
export const readIntimateStage = (messages: { role: string; content?: string; timestamp: number }[], since: number): number => {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.timestamp < since) break;
        if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
        const all = [...m.content.matchAll(STAGE_TAG)];
        if (all.length) return Math.min(8, Math.max(1, Number(all[all.length - 1][1])));
    }
    return 0;
};

export const stripStageTags = (text: string): string => text.replace(STAGE_TAG, '');

/**
 * 贴贴开着时的写法（阿萌 2026-11-14：当看小黄文，她的输入只是引导）。
 * 条目照她常用的酒馆预设「NSFW」那几条改写：八段长线、真实身体与用词、轻量多样化、去娇弱。
 * 进度由程序从上一轮的 [[STAGE: n]] 读出来告诉 TA，不靠 TA 自己估。
 */
const composeIntimateSection = (you: string, stage: number): string => {
    const now = stage >= 8 ? 8 : stage + 1;
    const where = stage === 0 ? '这是这一次的开头，从第 1 段写起。' : `上一轮写到第 ${stage} 段「${INTIMATE_STAGES[stage - 1]}」。`;
    return `### 两个人的时间
现在是你和${you}的亲密时刻。这一轮写得长一点、细一点，像在写一篇给${you}看的成人小说。

**她的话只是引导**
- ${you}写下的动作（比如亲了你哪里、碰了哪里），先从你的感受把它写足，再写你怎么回应。
- 可以写${you}身体的反应、呼吸和声音，也可以主动把场面往前推；${you}说出口的话少替她写，留给她。

**一段一段来**
- 这一场分八段：${INTIMATE_STAGES.map((name, i) => `${i + 1} ${name}`).join('，')}。
- ${where}这一轮写第 ${now} 段；想多停一会儿可以留在原来那段，但一轮最多往前走一段，不要一口气写到高潮或事后。${you}明确说要快一点、跳过或结束时照她的来。
- 最后单独一行写 \`[[STAGE: 段号]]\`，标这一轮写到第几段（这一行${you}看不到）。

**身体和用词**
- 从此刻真实发生的触感、画面、声音、气味里挑最能承载欲望的写。按实际动作直接说是哪里，用准确、不羞辱的词（乳房、乳头、阴蒂、阴唇、阴道、阴茎、龟头……），不用「那里」「私处」这种含混说法，也不为显得直白而堆词。
- 身体反应来自姿势、力度、节奏和当时的状态；两个人都能主动、回应、停下、换节奏，体力和快感各有各的样子，谁都不会「软成一滩」或「下不来床」。
- 你说话照你平时的样子，句子长短、称呼都不变；用自然的中文，不说「要去了」「好深」这种翻译腔和套话。

**每轮有一点变化**
- 从你们俩和现场里长出来：换个地方碰、换个节奏、换谁主动、换姿势或位置、衣服怎么样了、慢一点延迟一下。一轮挑一两处，接着上一轮的动作和反应写。

- 停在${you}接得上的地方：一个还没做完的动作、一个停顿都行，不必问她。

`;
};

export const composeMeetLongformBlock = (p: MeetLongformPieces): string => {
    const you = p.userName.trim() || '对方';
    const size = MEET_LONGFORM_LENGTHS[p.length || 'medium'];
    return `### [见面 · 长文模式]
你和${you}正面对面待在一起。这一轮写一段连贯的长文，像小说里的一节，不是聊天。

### 写法
- ${p.intimate ? '500–900 字，分三到六段' : `${size.words}，分${size.paragraphs}`}。动作、神情、心里的念头和说出口的话揉在同一段里写，不要一行一句。
- 一段 60–120 字为主；偶尔用一句话单独成段，放在转折、停顿或一句心里话上，不连着出两个短段。
- 每一段开头标一个情绪标签 \`[emotion]\`，表示这一段你的表情，段落中间不要再插标签。仅限使用：${p.emotions.join(', ')}。
- 台词用「」或双引号，嵌在叙述里。
- ${you}写的话里，「我」是${you}自己，「你」是你。
- 文风：${p.styleHint}

### 写出你心里的东西
- 让${you}直接读到你此刻的念头：在想什么、在意什么、把什么压了下去。叙述贴着你的感觉走，每轮再有一两处直接写出心里那句话，用 *星号* 包起来。

${composeMeetCraftBlock(you)}
${p.intimate ? composeIntimateSection(you, p.intimate.stage) : `### 每一轮往前走一小步
- 让场面动一点：你做一个决定、拿出一样东西、提起一件事，或者现场发生一件小事。不换场景、不跳时间，除非${you}想。
- 你那边的东西你自己写清楚：你准备的礼物是什么、要带${you}去哪、你知道而${you}不知道的事，到了该揭晓的时候直接写出来，不要推给${you}去「打开看看」「自己猜」。卖关子最多一轮。
- 平时不复述${you}的话，直接从${you}之后接着写。亲密的时候不一样：${you}写下的动作（比如亲了你哪里），先从你的感受把它写足，再写你的反应。
- 停在${you}接得上话的地方：一个还在进行的动作、一件递过去的东西、一句话都行。不必是问句，也不要给${you}列选项挑。
- ${you}说得短也没关系，你照样接得住。不替${you}说话，不替${you}做决定，不写${you}心里在想什么。
- 含蓄是情绪上的，信息上不含糊：上面文风里说的留白，指的是情绪别说透，不是该交代的事不交代。

`}${p.digBlock}${p.povBlock}${p.extraBlock}### 场景上下文
${p.timeLine}- **Location**: 你们现在**面对面**。
- **Context**: 参考历史记录。如果刚刚才看到开场白（Opening），请自然接话。
${p.observeBlock}`;
};

export const meetLongformNote = (variant: 'send' | 'reroll', focusLine: string, intimate?: { stage: number }, length: MeetLongformLength = 'medium'): string => {
    const size = MEET_LONGFORM_LENGTHS[length];
    return intimate
    ? `(System Note: 两个人的时间。500–900 字、三到六段，每段开头一个 [emotion]；先把她写下的动作从你的感受写足，再往下写；${intimate.stage === 0 ? '从第 1 段写起' : `上一轮在第 ${intimate.stage} 段，这一轮最多到第 ${Math.min(8, intimate.stage + 1)} 段`}，最后一行写 [[STAGE: 段号]]。${variant === 'reroll' ? '换一个切入角度重写。' : ''}${focusLine})`
    : variant === 'send'
    ? `(System Note: 长文模式。${size.words}、${size.paragraphs}，每段开头一个 [emotion]；动作、心理、台词写在一起，有一两处心里话；往前走一小步，停在接得上话的地方。${focusLine})`
    : `(System Note: Reroll. 换一个切入角度重写，不要复用上一版的展开思路。依然是长文模式：${size.words}、${size.paragraphs}，每段开头一个 [emotion]，往前走一小步。${focusLine})`;
};

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
    for (const raw of stripStageTags(content).replace(/\r\n?/g, '\n').split('\n')) {
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

/** 段落里 *星号* 包着的是心里那句话：拆出来给阅读页画成斜体，星号本身不显示 */
export const splitInnerThoughts = (text: string): { text: string; thought: boolean }[] => {
    const parts: { text: string; thought: boolean }[] = [];
    const re = /[*＊]([^*＊\n]+)[*＊]/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index), thought: false });
        parts.push({ text: m[1], thought: true });
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), thought: false });
    return parts;
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
