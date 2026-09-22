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
        return {
            ok: true,
            output: {
                action,
                activity: String(parsed.activity ?? '').slice(0, 120),
                reason: String(parsed.reason ?? '').slice(0, 500),
                ...(action === 'message' ? { text: String(parsed.text).slice(0, 2000) } : {}),
            },
        };
    }
    return { ok: false, error: '模型输出解析不出合法的心跳结果' };
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
            const content = data?.choices?.[0]?.message?.content;
            return parseHeartbeatOutput(typeof content === 'string' ? content : JSON.stringify(content));
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
