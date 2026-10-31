// [EM-START: deep-talk]
/**
 * 烛下（深谈）的纯逻辑：状态、TA 回答里的标记、约定时间、昼夜、提示词、历史折叠。
 * 不碰 IndexedDB，也不发请求——那些在 deepTalkDb.ts / deepTalkActions.ts。
 * 契约见 docs/spec-deep-talk.md。
 */

import type { Message } from '../types';
import { nowInTimeZone } from './timezone';

export type DeepTalkStatus = 'invited' | 'later' | 'declined' | 'open' | 'closed';

export interface DeepTalkNight {
    id: string;
    charId: string;
    status: DeepTalkStatus;
    invitedBy: 'user' | 'char';
    invitedAt: number;
    /** TA 约的时间（later 才有） */
    laterAt?: number;
    /** 阿萌点蜡烛时自己约的时间（2026-10-22：想起来「晚上八点找他聊」）；TA 答应了就成了 laterAt */
    proposedAt?: number;
    /** 是不是改约以后重新点上的：纸面开头那句不一样 */
    relit?: boolean;
    startedAt?: number;
    endedAt?: number;
    /** 自己放着没管，3 小时后自动收的 */
    burntOut?: boolean;
    /** 第几夜：结束时按这个角色已结束的夜数 +1 写定，之后不变 */
    nightNo?: number;
    title?: string;
    /** TA 视角的一句话，卡片和「所有夜晚」用；只写感受 */
    oneLine?: string;
    /** 给平时聊天看的那一行：只写感受，不写现实里的事实（「她有点孤单」可以，「她一直一个人」不行） */
    summary?: string;
    /** 只给以后的烛下看：这一夜真正聊了什么，现实处境可以写 */
    candleSummary?: string;
    /** 蜡烛灭了以后 TA 心里留着的感觉（只写感受）：回到平时聊天时接上氛围 */
    afterglow?: string;
    /** TA 挑出来带回平时的原话（进记忆宫殿）；阿萌可以在信笺里删 */
    kept?: DeepTalkKeptLine[];
    segmentCount?: number;
    /**
     * 这一次怎么记（2026-10-22 阿萌：不是每次都带 meta 感，结束时再定）：
     * - truth：说真话。原文只留在信笺和以后的烛下，平时只带回感受和挑的原话
     * - matter：谈事。原文当普通聊天记，按条数留在上下文、照常进记忆宫殿
     * 收尾时 TA 判断有没有说到她现实里的处境，程序据此预选；她在信笺里能改。缺省按 truth。
     */
    kind?: DeepTalkKind;
}

export type DeepTalkKind = 'truth' | 'matter';

export interface DeepTalkKeptLine {
    speaker: 'user' | 'char';
    text: string;
    /** 写进记忆宫殿的那条记忆，删的时候一起删 */
    memoryId?: string;
}

/** 深谈里的每条话（双方）都带这个 source + deepTalkId */
export const DEEP_TALK_SOURCE = 'deep_talk';
export const DEEP_TALK_EVENT_KIND = 'deep_talk_event';
export const DEEP_TALK_CARD_KIND = 'deep_talk_card';
export type DeepTalkEvent = 'invite' | 'later' | 'declined' | 'relight' | 'due' | 'end' | 'burnt_out';

/** 开着的深谈这么久没有新话，就当是忘了关：自动收卡，心跳也不再认 */
export const DEEP_TALK_IDLE_MS = 3 * 60 * 60 * 1000;
/** 角色那边几点算夜里（含 19 点，不含 6 点） */
export const NIGHT_FROM_HOUR = 19;
export const NIGHT_UNTIL_HOUR = 6;

export const isActiveStatus = (status: DeepTalkStatus | undefined): boolean =>
    status === 'invited' || status === 'later' || status === 'open';

export const isDeepTalkMessage = (m: Pick<Message, 'metadata'>): boolean =>
    m.metadata?.source === DEEP_TALK_SOURCE && typeof m.metadata?.deepTalkId === 'string';

export const padNight = (n: number | undefined): string => String(Math.max(1, n || 1)).padStart(2, '0');

/** 第几次：白天也会点蜡烛（阿萌 2026-10-22），所以不叫「第几夜」 */
export const candleLabel = (n: number | undefined): string => `第 ${padNight(n)} 支蜡烛`;

/** 谈事的那几次（已结束、她没改成说真话）：原文跟平时聊天一样记 */
export const isMatterNight = (night: Pick<DeepTalkNight, 'status' | 'kind'>): boolean =>
    night.status === 'closed' && night.kind === 'matter';

/** 要隔离的深谈原文：深谈的话里，除了谈事那几次的 */
export const isWalledDeepTalkMessage = (m: Pick<Message, 'metadata'>, matterNightIds: ReadonlySet<string>): boolean =>
    isDeepTalkMessage(m) && !matterNightIds.has(m.metadata.deepTalkId);

// ── TA 的回答 ──────────────────────────────────────────────

export type DeepTalkAnswer =
    | { kind: 'accept' }
    | { kind: 'later'; time: string }
    | { kind: 'decline' };

const ANSWER_RE = /\[\[\s*DEEP[_ ]?TALK\s*[:：]\s*(accept|later|decline)\s*(?:[|｜]\s*([^\]]*?))?\s*\]\]/gi;

/** 剥掉回复里所有深谈标记；有多个时以最后一个为准。later 缺时间就当没回答。 */
export const parseDeepTalkAnswer = (raw: string): { answer: DeepTalkAnswer | null; cleaned: string } => {
    let answer: DeepTalkAnswer | null = null;
    const cleaned = (raw || '').replace(ANSWER_RE, (_m, kind: string, arg?: string) => {
        const k = kind.toLowerCase();
        if (k === 'accept') answer = { kind: 'accept' };
        else if (k === 'decline') answer = { kind: 'decline' };
        else answer = arg && arg.trim() ? { kind: 'later', time: arg.trim() } : null;
        return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    return { answer, cleaned };
};

/**
 * 「23:00」「23点半」「晚上11点」→ 下一个这个时刻（按角色时区），返回时间戳。
 * 已经过了的时刻算明天；写了「明天」也算明天。认不出来返回 null。
 */
export const resolveLaterTime = (text: string, now: Date, timeZone?: string): number | null => {
    const s = (text || '').trim();
    const m = s.match(/(\d{1,2})\s*(?:[:：点時时]\s*(\d{1,2}|半)?)/) || s.match(/^(\d{1,2})$/);
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = m[2] === '半' ? 30 : m[2] ? Number(m[2]) : 0;
    if (!Number.isFinite(hour) || hour > 24 || minute > 59) return null;
    if (/(晚上|下午|傍晚|夜里|pm)/i.test(s) && hour < 12) hour += 12;
    if (hour === 24) hour = 0;
    const wallNow = nowInTimeZone(timeZone, now);
    const target = new Date(wallNow.getTime());
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= wallNow.getTime() || /明天|明晚/.test(s)) target.setDate(target.getDate() + 1);
    if (/明天|明晚/.test(s) && target.getTime() - wallNow.getTime() > 48 * 3600_000) target.setDate(target.getDate() - 1);
    return now.getTime() + (target.getTime() - wallNow.getTime());
};

export const formatClock = (ts: number, timeZone?: string): string => {
    const d = nowInTimeZone(timeZone, new Date(ts));
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ── 系统气泡的字 ──────────────────────────────────────────

export const deepTalkEventText = (
    event: DeepTalkEvent,
    names: { userName: string; charName: string; invitedBy?: 'user' | 'char'; proposedClock?: string },
): string => {
    switch (event) {
        case 'invite': return names.proposedClock
            ? `${names.invitedBy === 'char' ? names.charName : names.userName}点了一支蜡烛，想在 ${names.proposedClock} 和你聊聊`
            : `${names.invitedBy === 'char' ? names.charName : names.userName}点了一支蜡烛，想和你聊聊`;
        case 'later': return '蜡烛先留着';
        case 'declined': return '蜡烛先留着';
        case 'relight': return `${names.charName}来了，蜡烛重新点上`;
        // 约好的时间到了，mini 来叫她：点这个气泡才进纸面
        case 'due': return `${names.charName}来了，蜡烛点上了`;
        case 'end': return '烛花落了';
        case 'burnt_out': return '蜡烛燃尽了';
    }
};

// ── 昼夜 ─────────────────────────────────────────────────

export type DeepTalkThemePref = 'auto' | 'day' | 'night';

export const isNightAt = (at: Date, timeZone?: string): boolean => {
    const hour = nowInTimeZone(timeZone, at).getHours();
    return hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR;
};

export const resolveDeepTalkTheme = (pref: DeepTalkThemePref, at: Date, timeZone?: string): 'day' | 'night' =>
    pref === 'day' || pref === 'night' ? pref : (isNightAt(at, timeZone) ? 'night' : 'day');

// ── 收尾时的判断 ─────────────────────────────────────────

/** 开着的深谈多久没动了：从最后一条话（没有就从开始）算 */
export const isDeepTalkIdle = (night: DeepTalkNight, lastSegmentAt: number | null, now: number): boolean => {
    if (night.status !== 'open') return false;
    const since = Math.max(night.startedAt || night.invitedAt, lastSegmentAt || 0);
    return now - since > DEEP_TALK_IDLE_MS;
};

/** 下一夜的序号 */
export const nextNightNo = (nights: Pick<DeepTalkNight, 'status' | 'nightNo'>[]): number =>
    nights.reduce((max, n) => (n.status === 'closed' && n.nightNo ? Math.max(max, n.nightNo) : max), 0) + 1;

// ── 历史折叠 ─────────────────────────────────────────────

/**
 * 给模型的聊天历史里，深谈的话保留原文的只有：正开着的那一次、谈事的那几次（当普通聊天按条数记）。
 * 说真话的那几次只剩折叠卡那一行（卡片消息的 content 就是摘要）。
 */
export const keepInPromptHistory = (
    m: Pick<Message, 'metadata'>,
    openNightId: string | null,
    matterNightIds: ReadonlySet<string> = new Set(),
): boolean =>
    !isDeepTalkMessage(m) || (!!openNightId && m.metadata.deepTalkId === openNightId) || matterNightIds.has(m.metadata.deepTalkId);

/** 折叠卡消息的 content：之后的聊天上下文里，这一夜只占这一行 */
export const buildCardContent = (night: Pick<DeepTalkNight, 'nightNo' | 'title' | 'summary' | 'oneLine' | 'afterglow'>): string => {
    const title = night.title ? `《${night.title}》` : '';
    const body = (night.summary || night.oneLine || '').trim();
    const glow = (night.afterglow || '').trim();
    const said = glow ? body.replace(/[。.！!]+$/, '') : body;
    return `（你们在烛下认真聊过一次 · 第${padNight(night.nightNo)}次${title}${said ? `：${said}` : ''}${glow ? `${said ? '；' : '：'}你心里还留着：${glow}` : ''}）`;
};

// ── 提示词 ───────────────────────────────────────────────

export interface DeepTalkMaterials {
    /** 阁楼：没想通的事 */
    attic: string[];
    /** 窗台：期盼 */
    windowsill: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export const buildMaterialsBlock = (materials: DeepTalkMaterials | null | undefined): string => {
    const attic = (materials?.attic || []).map(s => s.trim()).filter(Boolean).slice(0, 3);
    const windowsill = (materials?.windowsill || []).map(s => s.trim()).filter(Boolean).slice(0, 2);
    if (!attic.length && !windowsill.length) return '';
    const lines = ['', '你心里压着的事（只能从这里取，不要现编；不想说就不说）：'];
    for (const s of attic) lines.push(`- 没想通的：${clip(s, 120)}`);
    for (const s of windowsill) lines.push(`- 盼着的：${clip(s, 120)}`);
    return lines.join('\n');
};

/** 之前几夜在烛下真正聊过的（只给烛下看，平时聊天看不到） */
export type PastCandleNight = Pick<DeepTalkNight, 'nightNo' | 'title' | 'candleSummary' | 'summary' | 'kept'>;

export const buildPastNightsBlock = (past: PastCandleNight[] | null | undefined, names: { userName: string; charName: string }): string => {
    const nights = (past || []).filter(n => (n.candleSummary || n.summary || '').trim()).slice(0, 3);
    if (!nights.length) return '';
    const lines = ['', '你们之前在烛下聊过的（只在烛下记得，平时聊天别提这些细节）：'];
    for (const n of nights) {
        const said = (n.kept || []).map(k => `${k.speaker === 'user' ? names.userName : '你'}说「${clip(k.text, 50)}」`).join('；');
        lines.push(`- 第${padNight(n.nightNo)}次《${n.title || ''}》：${clip((n.candleSummary || n.summary || '').trim(), 160)}${said ? `（${said}）` : ''}`);
    }
    return lines.join('\n');
};

/** 深谈开着的每一轮：放在易变尾段，压过上面聊天 App 的短消息格式 */
export const buildOpenTurnBlock = (
    names: { userName: string; charName: string },
    materials?: DeepTalkMaterials | null,
    past?: PastCandleNight[] | null,
): string => `

[系统提示｜烛下 · 深谈（最高优先级，这一轮覆盖上面「聊天 App 行为规范」里的格式要求）]
你和${names.userName}点着一支蜡烛，在认真地聊。你们此刻在哪儿，就接着在那儿聊。
- 你还是${names.charName}，用你自己的口吻、经历和立场说话。
- 话的长短看你有什么要说：一句够了就一句，最多三段、400 字，段落之间空一行。不要拆成一句一句的短消息，没话的时候别凑字。
- 只写说出口的话：不写动作、神态、环境，不加旁白，不用括号描写自己。不写时间戳，不写名字前缀。
- 说你的经历和看法，是为了让${names.userName}知道 ta 还不知道的东西。认真聊天的人很少一直发问：多数回复不带问题，要问也只问一个，而且是你真想知道的。
- 你可以不同意，可以说「我不这么看」，可以有自己的偏见和固执。不要当体贴的客服，不要把对方的话总结一遍再安慰。
- 如果你最近也有放不下的事，可以说出来——只能从下面「你心里压着的事」里取，那里没有就不提。
- 不发表情包、不引用、不发语音、不写日记，除了记下答应的事（[[PROMISE]] 那几个标签），不输出任何 [[...]] 指令。
- 烛下是可以说真话的地方。${names.userName}如果说起自己现实里的处境——人在哪里、离家多远、现在回不去、一个人扛着什么——那都是真的，认真接住，别装作没听懂，也别急着用「我们这边」把它抹平。
  你们一起生活的那个世界也是真的，那里的约定照样作数。两件事同时成立：不要用现实去推翻你们世界里的事，也不要用那个世界盖住她现实里的难处。不要为了安慰她去说破那个世界是怎么来的。
- **关心在最前面**：ta 在疼的时候，你先是心疼 ta 的人。对不起、我在、我想抱你都能说，可以提 ta 说的那件事，可以说你听了有多难受。可以说对不起，只是不能只说对不起：后面要接着你的关心，接着你要为 ta 做的事，让 ta 知道你不走。下面几条跟这一条冲突时都听这一条。
- **想的时候只想 ta**：这些不是考题，别一条条对照，别列自己不能说什么。先想你心疼 ta 什么、想为 ta 做什么，然后就说。说得笨也行。
- **别用反省把 ta 晾着**：一段全是你在检讨，中心还是你，ta 什么也没得到。认了错就转回 ta：ta 现在怎么样，你接下来怎么办。
- **道歉要像人话**：说你原来以为的和实际差在哪，用一件你们之间真有的事（ta 那时候跟你说过什么、你当时怎么想的），说对不起，说具体错在哪。不替自己解释当时为什么那样，「我当时以为你能扛」这种不用说。
- **ta 怀疑要不要你的时候，别只认输**：可以承认「这么听起来你好像真的不需要我了」，把它算在你自己头上，然后说你不想你们继续这样，以后要怎么改。
- 可以问「可以吗」「你还愿意吗」：道歉之后这样问是真心在求和。别用「由你定」「你想要什么告诉我」把事情推给 ta。
- ta 的话 ta 自己懂：不解释、不分析 ta 是什么意思。说过的话别翻来覆去说。
- 有具体要做的事就说清楚，要是你真做得到的，当场用 [[PROMISE]] 记下来。
- 下面是别人的样子，只看分寸，口气和事情换成你自己的、你们真有的，别照抄：
  ta：那几天我一个人，每天都在哭。你说你需要我，可我不知道我还需不需要你。
  答：我以为我知道那几天，其实我不知道你每天都在哭。你那时候跟我说睡不好，我当是换了地方认床。对不起，我没有多问你两句。你这么说，好像真的不需要我了，是我没做好，才让你一个人扛这些。但我不想我们一直这样。以后我会学着先听你说，不再自以为是地替你想好。可以吗？${buildMaterialsBlock(materials)}${buildPastNightsBlock(past, names)}`;

/** 刚被邀请的那一轮：照常发短消息，末尾带一个程序读的标记 */
export const buildInviteTurnBlock = (names: { userName: string; charName: string }, proposedClock?: string): string => proposedClock ? `

[系统提示｜烛下 · 邀请]
${names.userName}刚刚点了一支蜡烛，想约你 ${proposedClock}（按你那边的时间）认真聊一会儿，两个人沉下心来说话。到时候你们在哪儿就在哪儿聊。想想你那时候在做什么、方不方便：
- 那个时间可以：答应。
- 那个时间不行，但今天晚些别的时间可以：说清楚改到几点。
- 这阵子都不行：直说。
照常用聊天的短消息回一两句（现在还没开始深谈），然后在最后单独一行写一个标记，标记不会显示出来：
[[DEEP_TALK: accept]] 或 [[DEEP_TALK: later | HH:mm]]（改到的时间，按你那边的时间，24 小时制）或 [[DEEP_TALK: decline]]` : `

[系统提示｜烛下 · 邀请]
${names.userName}刚刚点了一支蜡烛，想和你认真聊一会儿，两个人沉下心来说话。你们现在在哪儿就在哪儿聊。先想想你此刻在做什么、方不方便：
- 现在就能聊：答应。
- 现在走不开，但今天晚些可以：说清楚大概几点。
- 这阵子都不行：直说。
照常用聊天的短消息回一两句（这一轮还没开始深谈），然后在最后单独一行写一个标记，标记不会显示出来：
[[DEEP_TALK: accept]] 或 [[DEEP_TALK: later | HH:mm]]（按你那边的时间，24 小时制）或 [[DEEP_TALK: decline]]`;

/** 约好了还没到点：普通聊天里让 TA 记得这件事 */
export const buildLaterReminderLine = (names: { userName: string }, clock: string): string =>
    `\n\n[烛下：你答应过${names.userName}，${clock} 以后认真聊一次。到时候蜡烛会重新点上；在那之前照常聊天就好。]`;

/** 她点蜡烛时选的「几点」→ 时间戳：今天的这个钟点，已经过了就算明天（她自己手机的时间）。 */
export const proposedAtFromClock = (hhmm: string, now: Date): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) return null;
    const target = new Date(now.getTime());
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.getTime();
};

// ── 收尾：TA 给这一夜起名字 ───────────────────────────────

export interface DeepTalkEndResult {
    /** 有没有说到她现实里的处境；认不出来是 null（按说真话处理） */
    real: boolean | null;
    title: string;
    oneLine: string;
    summary: string;
    candleSummary: string;
    afterglow: string;
    kept: { speaker: 'user' | 'char'; text: string }[];
}

export const buildEndPrompt = (names: { userName: string; charName: string }, transcript: string): string =>
    `下面是你（${names.charName}）和${names.userName}刚刚在烛下深谈的全文。蜡烛灭了，请你用自己的口吻给这一次留个记号。

先判断 real：这一次${names.userName}有没有说到她现实里的处境（人在哪里、离家多远、现在回不去、现实生活里一个人扛着的事）。
只是聊你们俩那边的事（搬家、打算、两个人之间的坎）不算，写 false。

烛下可以说真话，平时的聊天里却不提这些。所以要留两份：
- 平时能看到的（title、oneLine、summary）**不写她现实处境里的事实**：「她觉得最近有点孤单」可以，「她最近一直一个人」「她回不了国」「我不在她身边」不行。不写人在哪、离多远、能不能见面。你们俩那边说定的事照实写。
- 只有以后的烛下能看到的（candleSummary）可以照实写这一次真正聊了什么。

再从全文里原样挑一到两句「可以带回平时的话」：说出来以后平时想起也会觉得安慰的话，可以是你说的，也可以是她说的。
只挑说感受、说你们俩的话；带现实处境的不要挑（人在哪、回不去、时差、隔着多远都不行）。没有合适的就给空数组。

只输出一个 JSON：
{"real": true 或 false, "title": "这一次的名字，不超过 8 个字，你自己起，别用「深谈」「谈心」这类词", "oneLine": "用你的第一人称写一句话，说这一次你们之间发生了什么（提到${names.userName}用「她」），不超过 40 字", "summary": "第三人称写这一次两个人的心情和说定的事，给平时的你看，不超过 120 字", "candleSummary": "第三人称照实写这一次聊了什么、各自说了什么，只给以后的烛下看，不超过 200 字", "afterglow": "蜡烛灭了以后你此刻心里留着的感觉，第一人称，只写感受，不超过 50 字（回到平时聊天时你会带着它）", "kept": [{"speaker": "char 或 user", "text": "原话，一字不改"}]}

全文：
${transcript}`;

const firstJsonObject = (raw: string): unknown => {
    const text = (raw || '').replace(/```(?:json)?/gi, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};

/**
 * 带回平时的原话里一眼就会说破现实的词：模型漏挑了也在这里拦一道。
 * 只管「带回平时」那几句，烛下自己看的不管。
 */
const REALITY_WORDS = /回国|回不去|回不了|国外|国内|出国|异国|异地|时差|签证|机票|飞回|隔着|那么远|见不到|见不了|不在身边|一个人在/;

export const isSafeKeptLine = (text: string): boolean => !REALITY_WORDS.test(text);

const stripQuotes = (s: string) => s.replace(/^[「“"']+|[」”"']+$/g, '').trim();

/**
 * 读收尾 JSON。原话必须真在那个人说过的话里（防模型自己编），带现实处境的丢掉，最多两句。
 * 不传 segments 时不校验原话（只给单测和旧调用用）。
 */
export const parseEndResult = (
    raw: string,
    segments?: Pick<Message, 'role' | 'content'>[],
): DeepTalkEndResult | null => {
    const obj = firstJsonObject(raw) as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return null;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const title = str(obj.title).replace(/^[《「"]|[》」"]$/g, '');
    const oneLine = str(obj.oneLine);
    const summary = str(obj.summary);
    const candleSummary = str(obj.candleSummary);
    // 余温要带回平时：带现实处境就不要了
    const afterglowRaw = str(obj.afterglow);
    const afterglow = afterglowRaw && isSafeKeptLine(afterglowRaw) ? afterglowRaw : '';
    if (!title && !oneLine && !summary && !candleSummary) return null;
    const spoken = (speaker: 'user' | 'char') => (segments || [])
        .filter(m => (speaker === 'user' ? m.role === 'user' : m.role !== 'user'))
        .map(m => (m.content || '').replace(/\s+/g, ''));
    const kept: DeepTalkEndResult['kept'] = [];
    for (const item of Array.isArray(obj.kept) ? obj.kept : []) {
        const speaker = (item as any)?.speaker === 'user' ? 'user' : 'char';
        const text = stripQuotes(str((item as any)?.text));
        if (!text || text.length > 80 || !isSafeKeptLine(text)) continue;
        if (segments && !spoken(speaker).some(s => s.includes(text.replace(/\s+/g, '')))) continue;
        if (kept.some(k => k.text === text)) continue;
        kept.push({ speaker, text });
        if (kept.length >= 2) break;
    }
    return {
        real: typeof obj.real === 'boolean' ? obj.real : obj.real === 'false' ? false : obj.real === 'true' ? true : null,
        title: clip(title, 12),
        oneLine: clip(oneLine, 60),
        summary: clip(summary, 200),
        candleSummary: clip(candleSummary, 300),
        afterglow: clip(afterglow, 80),
        kept,
    };
};

/** 收尾预选：明确没说到现实处境才算谈事，其余（含认不出来）一律按说真话，宁可多藏 */
export const preselectKind = (result: Pick<DeepTalkEndResult, 'real'> | null): DeepTalkKind =>
    result?.real === false ? 'matter' : 'truth';

/** 带回平时的那句话写进记忆宫殿时的样子（第一人称，TA 的记忆） */
export const keptLineMemoryContent = (line: Pick<DeepTalkKeptLine, 'speaker' | 'text'>, userName: string): string =>
    line.speaker === 'user'
        ? `点着蜡烛那次，${userName}跟我说：「${line.text}」`
        : `点着蜡烛那次，我跟${userName}说：「${line.text}」`;

export const buildTranscript = (
    segments: Pick<Message, 'role' | 'content'>[],
    names: { userName: string; charName: string },
): string => segments
    .map(m => `${m.role === 'user' ? names.userName : names.charName}：${(m.content || '').trim()}`)
    .join('\n\n');

// ── 深谈里 TA 那段话的清洗 ─────────────────────────────────

/** 不拆气泡、不跑表情 / 引用解析：剥掉思考块、时间戳、名字前缀和所有 [[...]] 指令，留下段落 */
/** 正文里的思考块去掉（思考里写的标签不算数） */
export const stripDeepTalkThinking = (raw: string): string => (raw || '')
    .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:think|thinking|thought)>[\s\S]*$/gi, '');

export const cleanDeepTalkReply = (raw: string, charName?: string): string => {
    let s = stripDeepTalkThinking(raw)
        .replace(/\[\[[\s\S]*?\]\]/g, '')
        .replace(/\[\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[^\]]*\]/g, '')
        .replace(/\[(?:聊天|通话|约会)\]/g, '')
        .replace(/<\/?语音>/g, '');
    if (charName) s = s.replace(new RegExp(`^\\s*${charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s*`), '');
    return s.split('\n').map(line => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

/**
 * TA 这段话的思考：模型自带的 reasoning + 正文里的 <think> 块（没闭合的也算）。
 * 深谈里不管开没开「心象」都留着，纸面上收成一个点开才看的 Thinking 小标签。
 */
export const extractDeepTalkThinking = (raw: string, reasoning?: string | null): string => {
    const blocks: string[] = [];
    const text = raw || '';
    const pattern = /<(think|thinking|thought)>([\s\S]*?)<\/\1>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) if (match[2].trim()) blocks.push(match[2].trim());
    if (!/<\/(?:think|thinking|thought)>/i.test(text)) {
        const open = text.match(/<(?:think|thinking|thought)>([\s\S]*$)/i);
        if (open?.[1]?.trim()) blocks.push(open[1].trim());
    }
    return [(reasoning || '').trim(), ...blocks].filter(Boolean).join('\n\n').trim();
};

/** 一段话拆成段落（空行或换行都算） */
export const toParagraphs = (content: string): string[] =>
    (content || '').split(/\n+/).map(p => p.trim()).filter(Boolean);

/**
 * 纸面上的「重写」：最后几段是 TA 的就换掉（rewriteIds），最后是她的就是 TA 还没接上（rewriteIds 为空）。
 * 一段话都没有时没什么可重写的，返回 null。
 */
export const deepTalkRetryPlan = (segments: Array<{ id: number; role: string }>): { rewriteIds: number[] } | null => {
    if (!segments.length) return null;
    const rewriteIds: number[] = [];
    for (let i = segments.length - 1; i >= 0 && segments[i].role === 'assistant'; i--) rewriteIds.push(segments[i].id);
    return { rewriteIds };
};
// [EM-END: deep-talk]
