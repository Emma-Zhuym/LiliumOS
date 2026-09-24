/**
 * 模型运行器（设计第 5 节）。
 *
 * 对心跳来说，不同的「大脑」只是同一个插头：run(input) → { ok, output } | { ok:false, error }。
 * 这一版只实现 API 运行器（OpenAI 兼容 /chat/completions）。Codex 那条路留空——
 * 没接就如实说没接，绝不在角色的大脑失灵时偷偷换一个（设计第 5 节的硬性要求）。
 */

import { readCredential } from './credentials.mjs';

const JSON_BLOCK = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * 工作往来（episode）：一小段和同事的对话，外加「手头正在推进的事」的一句进展。
 *
 * 它是**附赠**的：写坏了只丢这一段，不能连累这一跳原本的 action / activity / reason
 * ——模型多带一层嵌套结构，偶尔掉格式是常态，不该因此整跳作废。
 */
const EPISODE_CHANNELS = new Set(['group', 'dm', 'email']);

export const parseEpisode = raw => {
    if (!raw || typeof raw !== 'object') return null;
    if (!EPISODE_CHANNELS.has(raw.channel)) return null;
    const withWho = String(raw.with ?? '').trim().slice(0, 40);
    if (!withWho) return null;
    const lines = (Array.isArray(raw.lines) ? raw.lines : [])
        .map(line => ({ who: String(line?.who ?? '').trim().slice(0, 24), text: String(line?.text ?? '').trim().slice(0, 400) }))
        .filter(line => line.who && line.text)
        .slice(0, 8);
    if (lines.length === 0) return null;

    const episode = { channel: raw.channel, with: withWho, lines };
    if (raw.channel === 'email') {
        const subject = String(raw.subject ?? '').trim().slice(0, 80);
        if (subject) episode.subject = subject;
    }
    const thread = raw.thread;
    if (thread && typeof thread === 'object') {
        const title = String(thread.title ?? '').trim().slice(0, 40);
        if (title) {
            episode.thread = {
                ...(thread.id ? { id: String(thread.id).trim().slice(0, 64) } : {}),
                title,
                summary: String(thread.summary ?? '').trim().slice(0, 200),
                status: thread.status === 'done' ? 'done' : 'open',
            };
        }
    }
    return episode;
};

/**
 * 两层容错解析：先当整段 JSON 读，不行再从 ``` 代码块 / 第一个花括号里捞。
 * 各家模型对 response_format 的支持参差不齐，掉格式是常态，不是异常。
 */
export const parseHeartbeatOutput = raw => {
    const text = String(raw ?? '').trim();
    if (!text) return { ok: false, error: '模型没有返回内容' };
    const candidates = [text];
    const block = text.match(JSON_BLOCK);
    if (block) candidates.push(block[1]);
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

    for (const candidate of candidates) {
        let parsed;
        try {
            parsed = JSON.parse(candidate);
        } catch {
            continue;
        }
        const action = parsed?.action;
        if (action !== 'noop' && action !== 'message') continue;
        if (action === 'message' && !String(parsed.text || '').trim()) continue;
        const episode = parseEpisode(parsed.episode);
        return {
            ok: true,
            output: {
                ...(episode ? { episode } : {}),
                action,
                activity: String(parsed.activity ?? '').slice(0, 120),
                reason: String(parsed.reason ?? '').slice(0, 500),
                urge: parsed.urge === 'later' || parsed.urge === 'now' ? parsed.urge : 'none',
                ...(action === 'message' ? { text: String(parsed.text).slice(0, 2000) } : {}),
            },
        };
    }
    // 带上原文：调用方在排查开关打开时才会落库，平时直接丢掉。
    return { ok: false, error: '模型输出解析不出合法的心跳结果', raw: text };
};

/**
 * 取出这轮回复的正文。
 *
 * 各家代理给 content 的形状不一：字符串是常见的，Claude 系经过代理时常常是
 * `[{type:'thinking',...},{type:'text',text:'{...}'}]`。整个 JSON.stringify 会把真正的
 * JSON 转义成字符串塞进数组里，两层容错都捞不出来——这是解析失败里耗时特别长的那一类。
 * 所以数组按块取 text 拼起来，thinking / reasoning 块丢掉。
 */
export const extractContentText = content => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(block => (typeof block === 'string' ? block : block?.text ?? ''))
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
    return content === null || content === undefined ? '' : JSON.stringify(content);
};

/** baseUrl 可能已经带 /chat/completions，也可能只给到 /v1，两种都收。 */
export const chatCompletionsUrl = baseUrl => {
    const trimmed = String(baseUrl).replace(/\/+$/, '');
    return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};

export const createApiRunner = ({ config, fetchImpl = fetch }) => ({
    async run({ charId, credRef, system, user, schema, timeoutMs = 120_000 }) {
        const cred = readCredential(config, credRef);
        if (!cred) return { ok: false, error: `角色 ${charId} 还没有配 API 凭据（credRef=${credRef ?? '空'}）` };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(chatCompletionsUrl(cred.baseUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${cred.apiKey}`,
                },
                body: JSON.stringify({
                    model: cred.model,
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user },
                    ],
                    // 支持的就按 schema 出；不支持的这个字段会被忽略，靠上面的容错解析兜底。
                    response_format: {
                        type: 'json_schema',
                        json_schema: { name: 'heartbeat', strict: true, schema },
                    },
                    temperature: 0.8,
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                // 正文可能带 Key 或整段提示词，只留状态码和很短的一截。
                return { ok: false, error: `模型返回 ${response.status}：${detail.slice(0, 200)}` };
            }
            const data = await response.json();
            const message = data?.choices?.[0]?.message;
            // 有的代理把正文放在 reasoning_content 之外的 content 里，两个都可能为空，
            // 这时候把整条 message 交给容错解析，至少能从原文里捞出 JSON。
            const text = extractContentText(message?.content) || extractContentText(message);
            return parseHeartbeatOutput(text);
        } catch (error) {
            if (error?.name === 'AbortError') return { ok: false, error: 'timeout' };
            return { ok: false, error: String(error?.message || error).slice(0, 200) };
        } finally {
            clearTimeout(timer);
        }
    },
});

/** Codex 那条路还没接：明确拒绝，不回退到别的大脑。 */
export const createCodexRunnerStub = () => ({
    async run() {
        return { ok: false, error: 'codex 运行器还没接入（1c 只做 API 角色）' };
    },
});
