// [EM-START: meet-extra]
/**
 * 见面 · 番外（2026-11-17 阿萌定，契约 docs/spec-meet-extra.md）。
 *
 * 贴一段刷到的剧情梗概，TA 一次写出一篇几千字的完整短篇，主角永远是 TA 和她。
 * 这里只放纯逻辑：提示词、标题、要不要接着写、聊天里那张卡给 TA 看什么。
 * 落库和请求在 meetExtraActions.ts，库在 meetExtraDb.ts。
 */

export type MeetExtraMemory = 'persona' | 'together';
export type MeetExtraLength = 'short' | 'medium' | 'long';
/** third：两个人都叫名字；first：TA 说「我」、她是「你」；second：她是「你」、TA 叫名字 */
export type MeetExtraPov = 'third' | 'first' | 'second';
/**
 * 文风 / 基调：从阿萌自己的素材库里来（utils/presetLibrary.ts，原文只在本机和私有备份里，作者只许自用）。
 * 这里只收已经换好宏的文字。
 */
export interface MeetExtraStyleText { name: string; text: string }

export interface MeetExtra {
    id: string;
    charId: string;
    title: string;
    synopsis: string;
    memory: MeetExtraMemory;
    length: MeetExtraLength;
    pov: MeetExtraPov;
    extra?: string;
    /** 素材库里的文风 / 基调条目 id（写的时候去找；删了就不带）和当时的名字（显示用） */
    styleId?: string;
    style?: string;
    toneId?: string;
    tone?: string;
    body: string;
    /** 动笔前想的（<thinking> 里那段），阅读页可以点开看，不进聊天 */
    thinking?: string;
    /** 300–500 字，分享时才生成 */
    summary?: string;
    status: 'writing' | 'done' | 'failed';
    error?: string;
    /** 写完了但比篇幅下限短（接了两次还不够） */
    short?: boolean;
    sharedAt?: number;
    createdAt: number;
    updatedAt: number;
}

export const MEET_EXTRA_MEMORY: Record<MeetExtraMemory, { label: string; hint: string }> = {
    persona: { label: '只带人设', hint: '彻底的 AU：TA 的性格和说话方式，你的人设；不带你们聊过的事' },
    together: { label: '带上我们现在的样子', hint: '再加上长期记忆、跟梗概有关的回忆、最近一天半的聊天' },
};

export const MEET_EXTRA_LENGTHS: Record<MeetExtraLength, { label: string; min: number; max: number; maxTokens: number }> = {
    short: { label: '短篇', min: 1500, max: 2500, maxTokens: 4000 },
    medium: { label: '中篇', min: 3500, max: 5000, maxTokens: 8000 },
    long: { label: '长篇', min: 6000, max: 8000, maxTokens: 12000 },
};

export const MEET_EXTRA_POV: Record<MeetExtraPov, string> = {
    third: '第三人称',
    first: '我和你（TA 说「我」）',
    second: '你（TA 用名字）',
};

/** 一次最多自动接着写几次 */
export const MEET_EXTRA_MAX_CONTINUES = 2;

export const meetExtraId = (now = Date.now()) => `extra_${now}_${Math.random().toString(36).slice(2, 7)}`;

const povLine = (pov: MeetExtraPov, charName: string, userName: string): string => {
    if (pov === 'first') return `用你（${charName}）的第一人称写：你自己是「我」，${userName}是「你」。`;
    if (pov === 'second') return `用第二人称写${userName}：${userName}是「你」，${charName}用名字或「他 / 她」。`;
    return `用第三人称写，两个人都用名字（${charName}、${userName}）或「他 / 她」。`;
};

/** 任务那一条 user 消息。角色设定、她的人设、（together 档的）记忆都在 system 里 */
export const buildMeetExtraTask = (p: {
    charName: string;
    userName: string;
    synopsis: string;
    memory: MeetExtraMemory;
    length: MeetExtraLength;
    pov: MeetExtraPov;
    extra?: string;
    style?: MeetExtraStyleText;
    tone?: MeetExtraStyleText;
}): string => {
    const you = p.userName.trim() || '她';
    const size = MEET_EXTRA_LENGTHS[p.length];
    const memoryLine = p.memory === 'together'
        ? `这是一篇番外，但用得上你们俩现在的样子：上面的记忆和最近的聊天是你们真实的相处，称呼、默契、只有你们懂的梗都可以带进故事里，放在梗概的设定里变个样子出现。`
        : `这是一篇 AU 番外，世界和身份照梗概来；你们俩可能互不认识，也不必记得现实里聊过的事。只有性格、说话的方式、在意的东西还是你们自己。`;
    return `## 写一篇番外
主角是你（${p.charName}）和${you}，就你们两个人。${memoryLine}

### 梗概
${p.synopsis.trim()}

### 动笔之前先想
先在 <thinking></thinking> 里想清楚，几百字就够，想的东西这里写，正文里不出现：
1. 这个梗概最打动人的是哪一点，整篇要让人读完记住什么。
2. 这个设定里的你和${you}：身份、处境变了什么，哪些没变（性格、说话的方式、在意的东西）。
${p.memory === 'together' ? `3. 回头看看现实里的你们：最近聊了什么、为什么事笑过或别扭过、你们怎么称呼彼此、有什么只有你们懂的梗和习惯；挑一两样，换个样子放进这个故事。
` : ''}${p.memory === 'together' ? '4' : '3'}. 关系在这篇里从哪到哪：开头隔着多远，结尾到了哪里，中间靠哪两三件具体的事挪过去。
${p.memory === 'together' ? '5' : '4'}. 中间这段换几种发生法试试，哪种最像这两个人会做的事、最不像别人写过的，就用哪种。
${p.memory === 'together' ? '6' : '5'}. 文风怎么落到句子上：语感、节奏、挑什么样的细节。从哪个动作、哪句话或哪样东西直接开场，停在哪里。

### 写法
- 梗概是剧情走向，不照抄、不复述梗概的原句。可以补细节、换节奏，结局的方向守住梗概。
- 一次写完整篇：有开头、展开和结尾，不分章节，不写「未完待续」「全文完」，不写作者的话或写在前面的说明。
- 篇幅大约 ${size.min}–${size.max} 字，按段落写，对话和动作、心里的念头揉在一起。
- ${povLine(p.pov, p.charName, you)}
- ${you}说的话、做的事、心里想的可以写，要合她的人设。
- 平时直接写，一句交代清楚就往下走；只在人物心里的变化大到改了接下来做什么、说什么的地方停下来写细，一处写细，写完就回来。
- 设定靠人物的言行和事情的前因后果露出来，不在正文里讲解。
- 世界前后对得上：时间、地点、谁在场说清楚；东西不凭空出现、消失；旁人有自己的事，会进来、会打断。
- 从一个具体的场面直接开头；结尾停在具体的动作、画面或一句话上，不总结，不升华。
- 写具体的：地方、东西、动作、说出口的那句话；情绪靠这些带出来，不贴标签。
${p.tone?.text.trim() ? `\n### 你们相处的基调：${p.tone.name}\n${p.tone.text.trim()}\n` : ''}${p.style?.text.trim() ? `\n### 文风：${p.style.name}\n${p.style.text.trim()}\n` : ''}${p.extra?.trim() ? `\n### ${you}补的要求\n${p.extra.trim()}\n` : ''}
### 格式
想完以后，第一行写 \`# 标题\`（标题自己起，十个字以内），空一行开始正文。`;
};

/** 写到一半断了，接着写的那一句 */
export const MEET_EXTRA_CONTINUE_NOTE = '从上面断开的地方接着写，直到写完整篇。不要重复已经写过的内容，不要重写标题，不要写说明。';

export const buildMeetExtraContinueNote = (hint?: string): string =>
    hint?.trim() ? `${MEET_EXTRA_CONTINUE_NOTE}\n接下来：${hint.trim()}` : MEET_EXTRA_CONTINUE_NOTE;

/**
 * 把输出里的 <thinking>…</thinking>（也认 <think>）拆出来。流到一半思考还没合上时，rest 为空、open 为真。
 */
export const splitExtraThinking = (raw: string): { thinking: string; rest: string; open: boolean } => {
    const text = raw.replace(/^\s+/, '');
    const m = /^<(thinking|think)>([\s\S]*?)(<\/\1>|$)/i.exec(text);
    if (!m) return { thinking: '', rest: raw, open: false };
    const closed = !!m[3];
    return { thinking: m[2].trim(), rest: closed ? text.slice(m[0].length) : '', open: !closed };
};

/** 正文字数：不算空白 */
export const countExtraChars = (text: string): number => text.replace(/\s+/g, '').length;

const fallbackTitle = (synopsis: string): string => {
    const first = synopsis.replace(/\s+/g, ' ').trim().split(/[。！？!?\n]/)[0] || '番外';
    return first.length > 12 ? `${first.slice(0, 12)}…` : first;
};

/** 把模型的输出拆成标题和正文；没写 `# 标题` 就用梗概开头 */
export const splitExtraTitle = (raw: string, synopsis: string): { title: string; body: string } => {
    const text = raw.replace(/\r\n?/g, '\n').replace(/^\s+/, '');
    const m = /^#{1,3}\s*(.+?)\s*(?:\n|$)/.exec(text) || /^《(.{1,20})》\s*\n/.exec(text);
    if (m) {
        const title = m[1].replace(/^《|》$/g, '').trim();
        return { title: title || fallbackTitle(synopsis), body: text.slice(m[0].length).replace(/^\s+/, '') };
    }
    return { title: fallbackTitle(synopsis), body: text };
};

/** 断在句子中间的样子：末尾不是句号、问号、叹号、引号、省略号 */
const endsMidSentence = (text: string): boolean => !/[。！？!?…」』"”）)~～\-—]\s*$/.test(text.trim());

/**
 * 要不要自动接着写：被长度截断，或者明显短了一截还停在半句话上。
 * attempts = 已经接过几次。
 */
export const needsExtraContinue = (body: string, finishReason: string | undefined, length: MeetExtraLength, attempts: number): boolean => {
    if (attempts >= MEET_EXTRA_MAX_CONTINUES) return false;
    if (finishReason === 'length') return true;
    const size = MEET_EXTRA_LENGTHS[length];
    return countExtraChars(body) < size.min * 0.8 && endsMidSentence(body);
};

/** 接上的那段去掉模型偶尔重写的标题 */
export const stripContinuationTitle = (text: string): string => text.replace(/^\s*#{1,3}\s*.+\n+/, '');

/** 两段接起来：中间断在句子里就直接接，断在段落末尾就空一行 */
export const joinExtraParts = (before: string, after: string): string => {
    const a = before.replace(/\s+$/, '');
    const b = stripContinuationTitle(after).replace(/^\s+/, '');
    if (!a) return b;
    if (!b) return a;
    return endsMidSentence(a) ? `${a}${b}` : `${a}\n\n${b}`;
};

export const buildMeetExtraSummaryPrompt = (extra: Pick<MeetExtra, 'title' | 'body'>, charName: string, userName: string): string =>
    `下面是一篇以${charName}和${userName || '她'}为主角的番外《${extra.title}》。用 300–500 字写一段总结：讲清楚设定、发生了什么、结局，留下两三个具体的细节（一句关键的话、一样东西、一个场面），之后聊起来能对得上。第三人称，不评价，不加标题。\n\n${extra.body}`;

// ── 没有梗概时抽一个（池子是自己写的，抽三样拼成一段） ──

const AU_WORLDS = [
    '民国，一家快要停刊的小报社', '九十年代南方小城，录像厅和台球室', '海边小镇，夏天只营业三个月的冷饮店', '架空古代，边城驿站',
    '近未来，记忆可以寄存的城市', '大学，同一间实验室的两个组', '冬天的山区，暴雪封路的民宿', '老街区，一家修钟表的铺子',
    '剧组，拍了一半没钱的小成本电影', '远洋货轮，一趟四十天的航程', '凌晨营业的便利店', '外交场合，两国谈判的翻译间',
];
const AU_STARTS = [
    '你们互不认识，第一次见面就闹了误会', '你们是对手，谁也不肯先让一步', '你们是多年没联系的旧识，重逢时谁都没先认出谁',
    '她欠你一个人情，你一直没要她还', '你们被临时凑成搭档，只合作这一回', '你们住在隔壁，只隔一堵很薄的墙', '你们通过信件认识，一直没见过面',
    '你是她的上司 / 老师 / 房东，却总被她管着', '你们订过婚，又退了', '你们在同一天、因为同一件事各自倒了霉',
];
const AU_HOOKS = [
    '一张没写名字的电影票', '一场停电', '一只走丢的猫', '一封寄错地址的信', '一把被借走没还的伞', '一笔说不清的账',
    '一首两个人都会哼、却想不起名字的歌', '一个必须在天亮前做完的决定', '一张拍糊了的合照', '一次谁都没打算赴的约',
];

const pick = <T,>(list: T[], rand: () => number) => list[Math.floor(rand() * list.length) % list.length];

/** 抽一个 AU 梗概：一个世界 + 一个关系起点 + 一个引子 */
export const rollMeetExtraSynopsis = (rand: () => number = Math.random): string =>
    `AU：${pick(AU_WORLDS, rand)}。${pick(AU_STARTS, rand)}。故事从${pick(AU_HOOKS, rand)}开始。`;

// ── 聊天里那张卡 ──

export const MEET_EXTRA_CARD_KIND = 'meet_extra_card';
/** 分享后她说话这么多轮以内带全文，之后只带总结（阿萌：三四五轮） */
export const MEET_EXTRA_FULL_ROUNDS = 4;

export interface MeetExtraCardMeta {
    id: string;
    title: string;
    synopsis: string;
    body: string;
    summary?: string;
}

/** 卡片消息的 content：记忆管线、心跳近况、预览读到的就是这一行，不带全文 */
export const meetExtraCardContent = (title: string, summary?: string): string =>
    `[分享了一篇番外《${title}》（虚构的故事）]${summary ? ` ${summary}` : ''}`;

const brief = (text: string, max: number) => {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** 私聊历史里给 TA 看的那一段 */
export const meetExtraHistoryText = (card: MeetExtraCardMeta, roundsAfter: number, fromUser: boolean): string => {
    const who = fromUser ? '对方把一篇番外分享给了你' : '你分享了一篇番外';
    const frame = `（${who}：主角是你们俩，是虚构的故事，不是真实发生过的事。）`;
    if (roundsAfter < MEET_EXTRA_FULL_ROUNDS) {
        return `${frame}\n《${card.title}》\n梗概：${brief(card.synopsis, 200)}\n全文：\n${card.body}`;
    }
    const gist = card.summary?.trim() || `${brief(card.body, 400)}`;
    return `${frame}\n《${card.title}》${card.summary ? '' : '（开头）'}：${gist}`;
};
// [EM-END: meet-extra]
