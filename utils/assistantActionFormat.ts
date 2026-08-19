/**
 * 修复模型把「机器指令」写成单层方括号 / 历史展示摘要的常见掉格式。
 *
 * 这里故意只认完整、带方括号的高置信度 token：普通正文里的“我给你转 520”之类
 * 不能变成副作用。输出统一回既有 canonical 语法，后续仍由各业务解析器做开关、
 * 金额、方向、去重等校验。
 */

const cleanArg = (value: string): string => value.trim().replace(/[|｜]/g, '／');

const normalizeExerciseSummary = (raw: string): string => {
    const value = raw.trim();
    // 展示摘要把 activity + duration 拼在一起。只在末尾明显像时长时才拆，
    // 否则宁可把整段当活动名，也不凭空猜一个错误时长。
    const match = value.match(/^(.+?)\s+((?:\d+(?:\.\d+)?|半|一|两|三|四|五|六|七|八|九|十)\s*(?:分钟|小时|时|分))$/);
    if (!match) return `[[LIFE:EXERCISE|${cleanArg(value)}]]`;
    return `[[LIFE:EXERCISE|${cleanArg(match[1])}|${cleanArg(match[2])}]]`;
};

/** 幂等：已经是 [[...]] 的规范标签不会再次包裹。 */
export const normalizeAssistantActionFormatting = (raw: string): string => {
    let content = raw || '';

    // 表情：既修单括号机器语法，也修 UI / 通知里的人类可读摘要。
    content = content.replace(
        /(^|[^\[])\[\s*SEND_EMOJI\s*[:：]\s*([^\]\r\n]+?)\s*\](?!\])/gim,
        (_all, prefix: string, name: string) => `${prefix}[[SEND_EMOJI: ${name.trim()}]]`,
    );
    content = content.replace(
        /(^|[^\[])\[\s*(?:表情|表情包)\s*[:：]\s*([^\]\r\n]+?)\s*\](?!\])/gm,
        (_all, prefix: string, name: string) => `${prefix}[[SEND_EMOJI: ${name.trim()}]]`,
    );

    // 照片：兼容模型漏一层括号，以及 ai-virtual-phone 常用的中文照片标签。
    content = content.replace(
        /(^|[^\[])\[\s*SEND_PHOTO\s*[:：]\s*([^\]\r\n]+?)\s*\](?!\])/gim,
        (_all, prefix: string, prompt: string) => `${prefix}[[SEND_PHOTO: ${prompt.trim()}]]`,
    );
    content = content.replace(
        /\[\[\s*照片\s*[:：]\s*(?:使用参考图\s*[:：]\s*)?([\s\S]*?)\s*\]\]/gim,
        (_all, prompt: string) => `[[SEND_PHOTO: ${prompt.trim()}]]`,
    );
    content = content.replace(
        /(^|[^\[])\[\s*照片\s*[:：]\s*(?:使用参考图\s*[:：]\s*)?([^\]\r\n]+?)\s*\](?!\])/gim,
        (_all, prefix: string, prompt: string) => `${prefix}[[SEND_PHOTO: ${prompt.trim()}]]`,
    );

    // 转账：只修明确的 ACTION token；口语版 [转账 520] 仍由 transferFormat 的
    // 容错解析器负责，方向和金额安全校验也仍在那里完成。
    content = content.replace(
        /(^|[^\[])\[\s*ACTION\s*[:：]\s*(TRANSFER_(?:ACCEPT|RETURN))\s*\](?!\])/gim,
        (_all, prefix: string, verb: string) => `${prefix}[[ACTION:${verb.toUpperCase()}]]`,
    );
    content = content.replace(
        /(^|[^\[])\[\s*ACTION\s*[:：]\s*TRANSFER\s*([|｜][^\]\r\n]*)\s*\](?!\])/gim,
        (_all, prefix: string, args: string) => `${prefix}[[ACTION:TRANSFER${args.replace(/｜/g, '|')}]]`,
    );
    content = content.replace(
        /(^|[^\[])\[\s*ACTION\s*[:：]\s*TRANSFER\s*[:：]\s*([^\]\r\n]*?)\s*\](?!\])/gim,
        (_all, prefix: string, amount: string) => `${prefix}[[ACTION:TRANSFER:${amount.trim()}]]`,
    );

    // 单括号 LIFE 机器语法。
    content = content.replace(
        /(^|[^\[])\[\s*LIFE\s*[:：]\s*([A-Z_]+)\s*((?:[|｜][^\]\r\n]*)?)\s*\](?!\])/gim,
        (_all, prefix: string, verb: string, args: string) =>
            `${prefix}[[LIFE:${verb.toUpperCase()}${args.replace(/｜/g, '|')}]]`,
    );

    // LIFE 卡片摘要被模型照抄回来时，恢复成机器指令。带“已有记录/已确认”等
    // 状态尾巴的卡片不会命中，避免把历史裁决当成一笔新动作。
    content = content.replace(
        /(^|[^\[])\[\s*生活记录\s*[:：]\s*生理期开始\s*\](?!\])/gm,
        '$1[[LIFE:PERIOD_START]]',
    );
    content = content.replace(
        /(^|[^\[])\[\s*生活记录\s*[:：]\s*生理期结束\s*\](?!\])/gm,
        '$1[[LIFE:PERIOD_END]]',
    );
    content = content.replace(
        /(^|[^\[])\[\s*生活记录\s*[:：]\s*吃药\s*(?:[·・•]|\s)\s*([^\]\r\n]+?)\s*\](?!\])/gm,
        (_all, prefix: string, name: string) => `${prefix}[[LIFE:MED|${cleanArg(name)}]]`,
    );
    content = content.replace(
        /(^|[^\[])\[\s*生活记录\s*[:：]\s*支出\s+([¥￥]?\s*[0-9０-９][0-9０-９.,，]*\s*(?:元|块钱|块|圆)?)\s*(?:[（(]\s*([^\]）)\r\n]+?)\s*[）)])?\s*\](?!\])/gm,
        (_all, prefix: string, amount: string, note?: string) =>
            `${prefix}[[LIFE:EXPENSE|${amount.trim()}${note ? `|${cleanArg(note)}` : ''}]]`,
    );
    content = content.replace(
        /(^|[^\[])\[\s*生活记录\s*[:：]\s*锻炼\s*(?:[·・•]|\s)\s*([^\]\r\n]+?)\s*\](?!\])/gm,
        (_all, prefix: string, summary: string) => `${prefix}${normalizeExerciseSummary(summary)}`,
    );

    return content;
};

const EXPLICIT_PHOTO_REQUEST_RE = /(?:发|拍|来|给我|让我看|想看|看看|看一下).{0,10}(?:自拍|照片|相片|你现在的样子|你的样子)|(?:自拍|照片|相片).{0,10}(?:发来|发给我|看看|看一下)/i;
const NEGATED_PHOTO_REQUEST_RE = /(?:别|不要|不用|不许|不准|禁止).{0,8}(?:发|拍|给).{0,8}(?:自拍|照片|相片)|(?:自拍|照片|相片).{0,8}(?:别发|不要发|不用发)/i;

export const isExplicitPhotoRequest = (text: string): boolean => {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return !!value && EXPLICIT_PHOTO_REQUEST_RE.test(value) && !NEGATED_PHOTO_REQUEST_RE.test(value);
};

/** 模型漏掉照片标签时，只对用户本轮的明确索图请求补一次。 */
export const ensureRequestedPhotoDirective = (assistantContent: string, userContent: string): string => {
    const normalized = normalizeAssistantActionFormatting(assistantContent);
    if (/\[\[SEND_PHOTO\s*[:：]/i.test(normalized) || !isExplicitPhotoRequest(userContent)) return normalized;
    const request = String(userContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const selfie = /自拍|看看你|看一下你|你的样子|你现在的样子/i.test(request);
    const fallbackPrompt = selfie
        ? `candid smartphone selfie of the character, natural expression, authentic casual moment, current surroundings, user request: ${request}`
        : `candid smartphone photo taken by the character, natural lighting, authentic casual moment, user request: ${request}`;
    return `${normalized.trim()}\n[[SEND_PHOTO: ${fallbackPrompt}]]`.trim();
};
