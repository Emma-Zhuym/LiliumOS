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

export interface MeetExtra {
    id: string;
    charId: string;
    title: string;
    synopsis: string;
    memory: MeetExtraMemory;
    length: MeetExtraLength;
    pov: MeetExtraPov;
    extra?: string;
    body: string;
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

### 写法
- 梗概是剧情走向，不照抄、不复述梗概的原句。可以补细节、换节奏，结局的方向守住梗概。
- 一次写完整篇：有开头、展开和结尾，不分章节，不写「未完待续」「全文完」，不写作者的话或写在前面的说明。
- 篇幅大约 ${size.min}–${size.max} 字，按段落写，对话和动作、心里的念头揉在一起。
- ${povLine(p.pov, p.charName, you)}
- ${you}说的话、做的事、心里想的可以写，要合她的人设。
- 写具体的：地方、东西、动作、说出口的那句话；情绪靠这些带出来，不贴标签。
- 不写霸总动作（捏下巴、逼墙角）、不用「心跳漏了一拍」「脸颊绯红」这类套话、不堆比喻。
${p.extra?.trim() ? `\n### ${you}补的要求\n${p.extra.trim()}\n` : ''}
### 格式
第一行写 \`# 标题\`（标题自己起，十个字以内），空一行开始正文。`;
};

/** 写到一半断了，接着写的那一句 */
export const MEET_EXTRA_CONTINUE_NOTE = '从上面断开的地方接着写，直到写完整篇。不要重复已经写过的内容，不要重写标题，不要写说明。';

export const buildMeetExtraContinueNote = (hint?: string): string =>
    hint?.trim() ? `${MEET_EXTRA_CONTINUE_NOTE}\n接下来：${hint.trim()}` : MEET_EXTRA_CONTINUE_NOTE;

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
