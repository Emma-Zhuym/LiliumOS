// [EM-START: impression-json-tolerant]
/**
 * 印象档案的模型回包 → 对象。
 *
 * 上游原来是 `JSON.parse(回包)`，回包只要有一处不规矩就整次作废。阿萌每次更新都撞上同一句
 * `JSON Parse error: Unrecognized token '哼'`（2026-10-01）。两种回包都会报出这一句，一字不差：
 *   1. 模型先用角色口吻说了一句（「哼，又让我写这个」）再给 JSON；
 *   2. JSON 本身没问题，但字符串里用英文双引号引了一句原话：`"tone_style": "不高兴时爱说"哼"…"`，
 *      引号把字符串提前截断，解析器下一个读到的就是「哼」。口头禅每次都会被引用，所以每次都是这个字。
 * 这里改用 safeApi 的 `extractJson`（剥掉前后的闲话、补转义没转义的内层引号）。
 *
 * 宽容解析有一个新风险要堵住：`normalizeUserImpression` 只要见到任意一节就会把其余几节补成空白。
 * 回包被截断、或者只抠出一小块时，补出来的半份档案会**覆盖掉原来那份**。所以这里不修截断，
 * 并且四个核心小节缺一个就整次作废——宁可让她再点一次，也不能把旧档案冲成空的。
 */

import { extractJson } from './safeApi';

/** 缺了任何一节，都说明拿到的不是整份档案。mbti_analysis / observed_changes 本来就允许没有。 */
const REQUIRED_SECTIONS = ['value_map', 'behavior_profile', 'emotion_schema', 'personality_core'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const parseImpressionReply = (raw: string): Record<string, unknown> => {
    const parsed = extractJson(raw, { allowTruncated: false, silent: true });
    if (!isRecord(parsed)) {
        // 只进本机的日志面板：下次再失败时看得到模型到底回了什么开头
        console.error('[印象档案] 模型回包里读不出 JSON，开头是：', String(raw ?? '').slice(0, 200));
        throw new Error('模型没有按格式返回印象档案（旧档案没有改动，可以再点一次）');
    }
    const missing = REQUIRED_SECTIONS.filter(key => !isRecord(parsed[key]));
    if (missing.length) {
        console.error('[印象档案] 模型回包不完整，缺：', missing.join(', '), '｜开头是：', String(raw ?? '').slice(0, 200));
        throw new Error('模型返回的印象档案不完整（旧档案没有改动，可以再点一次）');
    }
    return parsed;
};
// [EM-END: impression-json-tolerant]
