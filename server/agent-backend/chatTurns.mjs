/**
 * 即时回复：聊天这一轮交给 mini 跑，手机发完就能锁屏 / 被杀后台，回复靠推送回来。
 * 规格见 docs/spec-agent-backend-instant-chat.md 阶段一。
 *
 * 形状照搬 amsg 的即时对话：手机把「本地这一轮原本要发的全部内容」交上来（messages 已含
 * system 和时效段），这里一字不改地转给模型，拿到原文后按 amsg 的推送形状推回去——
 * SW 认这个形状，直接进收件箱，拆气泡、表情、发图、记忆这些后处理全在手机上照旧跑。
 *
 * 凭据只在内存：每轮随请求带来，用完即丢，不落库、不进日志。进程重启后还没跑的那一轮
 * 拿不到凭据，直接判失败让手机重发——比把 Key 写进磁盘好。
 */

import { createJob, runJobNow, toJob } from './jobs.mjs';
import { chatCompletionsUrl, extractContentText } from './runner.mjs';

export const CHAT_TURN_KIND = 'chat_turn';
/** 一轮最多等模型多久。思考链长的模型两三分钟很常见。 */
export const CHAT_TURN_TIMEOUT_MS = 5 * 60_000;
/** Web Push 正文上限约 4KB（还要过 Apple 的服务器），留余量。超了只推「去取」的信号。 */
export const PUSH_PAYLOAD_LIMIT_BYTES = 3500;
const PREVIEW_LIMIT = 80;

export const jobUuidFor = turnId => `chat:${turnId}`;

const isUuidish = value => typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);

/** 通知栏预览的兜底：去掉 [[...]] 指令、<...> 标签和多余空白。正常走下面那个跟 amsg 同一份的清洗。 */
export const previewText = text => String(text ?? '')
    .replace(/<(think|thinking|thought)>[\s\S]*?(<\/\1>|$)/gi, ' ')
    .replace(/\[\[[\s\S]*?\]\]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_LIMIT);

/**
 * 通知栏预览用前端那份 sanitizeForNotification（amsg 推送也用它）：思考块、时间戳、
 * 「你引用了…」、业务标签、表情指令全剥掉。原来只粗剥指令和标签，心象正文、时间戳、
 * 引用标记都漏进了锁屏横幅。Node 23 能直接跑 .ts；加载不了就退回上面的粗剥。
 */
let notificationSanitizer;
const loadNotificationSanitizer = async () => {
    if (notificationSanitizer !== undefined) return notificationSanitizer;
    try {
        notificationSanitizer = (await import('../../utils/sanitize.ts')).sanitizeForNotification;
    } catch {
        notificationSanitizer = null;
    }
    return notificationSanitizer;
};

export const notificationPreview = async text => {
    const sanitize = await loadNotificationSanitizer();
    if (!sanitize) return previewText(text);
    try {
        return String(sanitize(String(text ?? ''))).replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LIMIT);
    } catch {
        return previewText(text);
    }
};

/** 手机端 SW 认的 amsg content 推送（worker/sw-keep-alive.ts 的 saveContentToInbox）。 */
export const buildReplyPush = ({ turnId, charId, charName, text, reasoning = '', usage = null, at, preview = null }) => ({
    messageKind: 'content',
    messageId: `mini:${turnId}`,
    // 手机端「正在输入…」认这个熄灭（activeMsgRuntime 按 taskUuid 销账）
    taskUuid: turnId,
    contactName: charName,
    message: text,
    messageType: 'instant',
    source: 'agent-backend',
    timestamp: at,
    metadata: {
        charId,
        charName,
        source: 'agent-backend',
        agentTurnId: turnId,
        messageIndex: 1,
        totalMessages: 1,
        ...(usage ? { amsgUsage: usage } : {}),
        // 心象卡片：手机端收件箱认 amsg 即时对话的这个字段（activeMsgRuntime 挂到首条回复的 thinkingChain）
        ...(reasoning ? { amsgReasoning: reasoning } : {}),
    },
    notification: {
        title: charName,
        body: (preview ?? previewText(text)) || '发来一条消息',
        tag: `mini-chat-${charId}`,
        renotify: true,
        silent: 'when-visible',
    },
});

/** 太大推不动时的退路：只按门铃 + 叫页面来取（SW 把 result 原样转给页面，不进收件箱）。 */
export const buildPullPush = ({ turnId, charId, charName, text, preview = null }) => ({
    messageKind: 'result',
    resultKind: 'agent-pull',
    messageId: `mini:${turnId}:pull`,
    taskUuid: turnId,
    contactName: charName,
    metadata: { charId, charName, source: 'agent-backend', agentTurnId: turnId },
    notification: {
        title: charName,
        body: (preview ?? previewText(text)) || '发来一条消息',
        tag: `mini-chat-${charId}`,
        renotify: true,
        silent: 'when-visible',
    },
});

export const buildErrorPush = ({ turnId, charId, charName, reason }) => ({
    messageKind: 'error',
    code: 'AGENT_CHAT_FAILED',
    message: reason,
    messageId: `mini:${turnId}:error`,
    taskUuid: turnId,
    // errorCode 让手机端说「模型接口拒了这次请求」而不是笼统的「生成失败」（describeInstantChatFailure）
    metadata: { charId, charName, source: 'agent-backend', taskUuid: turnId, reason, ...(/^模型返回/.test(reason) ? { errorCode: 'LLM_CALL_FAILED' } : {}) },
    // show:'always'：error 这一类推送 SW 默认不弹通知，而 iOS 对「收到推送却没弹通知」是记账的，
    // 攒够几次就把这台设备的推送订阅收回——之后回复全靠手机 60 秒点名才取得到（2026-10-02）。
    notification: {
        show: 'always',
        title: charName,
        body: '这一轮没回成，点开可以重发',
        tag: `mini-chat-${charId}`,
        silent: 'when-visible',
    },
});

/**
 * 模型这一轮的思考内容。各家放的地方不一样：DeepSeek 和多数中转站是 reasoning_content，
 * OpenRouter 是 reasoning（或 reasoning_details 数组），Anthropic 透传是 content 里的 thinking 块。
 * 都没有就是没开思考 / 模型不给。原来只取正文，走 mini 的每一轮心象卡片都没了。
 */
export const extractReasoning = message => {
    if (!message || typeof message !== 'object') return '';
    // 跟手机本地那条路同一个优先级（utils/safeApi.ts）
    for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
        if (typeof message[key] === 'string' && message[key].trim()) return message[key].trim();
    }
    // Anthropic 透传：content 是分块数组，思考在 type: 'thinking' 的块里
    if (Array.isArray(message.content)) {
        const thinking = message.content
            .filter(block => block?.type === 'thinking' && typeof block.thinking === 'string')
            .map(block => block.thinking)
            .join('')
            .trim();
        if (thinking) return thinking;
    }
    if (Array.isArray(message.reasoning_details)) {
        const text = message.reasoning_details
            .map(part => (typeof part?.text === 'string' ? part.text : typeof part?.summary === 'string' ? part.summary : ''))
            .filter(Boolean)
            .join('\n')
            .trim();
        if (text) return text;
    }
    return '';
};

/**
 * 没取到心象时记下回包长什么样：只有字段名、类型和长度，不带任何内容，也不带凭据。
 * 中转站改了返回格式（2026-10-01 下午起心象又没了）时，靠它看思考跑到哪个字段去了。
 */
export const describeResponseShape = (data, extraBody) => {
    const describe = value => {
        if (typeof value === 'string') return `string(${value.length})`;
        if (Array.isArray(value)) {
            return `array[${value.map(item => (item && typeof item === 'object'
                ? `${item.type ?? 'object'}{${Object.keys(item).join(',')}}`
                : typeof item)).join(';')}]`;
        }
        if (value && typeof value === 'object') return `object{${Object.keys(value).join(',')}}`;
        return String(value);
    };
    const message = data?.choices?.[0]?.message ?? {};
    return {
        top: Object.keys(data ?? {}).join(','),
        choice: Object.keys(data?.choices?.[0] ?? {}).join(','),
        message: Object.fromEntries(Object.entries(message).map(([key, value]) => [key, describe(value)])),
        sent: extraBody && typeof extraBody === 'object'
            ? Object.fromEntries(Object.entries(extraBody).map(([key, value]) => [key, describe(value)]))
            : null,
    };
};

/**
 * 正文里的思考块抠出来：模型有时不走 reasoning 字段，而是把心象写成正文里的 <think>…</think>。
 * 手机端收件箱只从 amsgReasoning 取心象、不翻正文，所以不在这里抠的话卡片就没了，
 * 正文里还会留着那段思考。规则跟手机本地那条路一样（applyAssistantPostProcessing 的
 * extractThinkingChain）：think / thinking / thought 三种标签，没闭合的一直算到结尾。
 */
export const splitEmbeddedThinking = raw => {
    const blocks = [];
    let text = String(raw ?? '').replace(/<(think|thinking|thought)>([\s\S]*?)<\/\1>/gi, (_all, _tag, inner) => {
        if (inner.trim()) blocks.push(inner.trim());
        return '';
    });
    const open = text.match(/<(?:think|thinking|thought)>([\s\S]*)$/i);
    if (open) {
        if (open[1].trim()) blocks.push(open[1].trim());
        text = text.slice(0, open.index);
    }
    return { text: text.trim(), thinking: blocks.join('\n\n') };
};

const fitsInPush = payload => Buffer.byteLength(JSON.stringify(payload), 'utf8') <= PUSH_PAYLOAD_LIMIT_BYTES;

/** 校验手机交上来的这一轮。返回错误说明，合法返回 null。 */
export const validateTurn = body => {
    if (!body || typeof body !== 'object') return '请求体不是 JSON 对象';
    if (!isUuidish(body.turnId)) return 'turnId 不合法';
    if (typeof body.charId !== 'string' || !body.charId) return '缺少 charId';
    if (!Array.isArray(body.messages) || body.messages.length === 0) return '缺少 messages';
    const api = body.api;
    if (!api || typeof api.baseUrl !== 'string' || typeof api.model !== 'string' || !api.baseUrl || !api.model) {
        return '缺少 api.baseUrl / api.model';
    }
    if (body.supersedes !== undefined && body.supersedes !== null && !isUuidish(body.supersedes)) return 'supersedes 不合法';
    return null;
};

export const createChatTurnService = ({ db, deliver, fetchImpl = fetch, timeoutMs = CHAT_TURN_TIMEOUT_MS, logger = console }) => {
    /** jobUuid → 这一轮的请求体（含 Key）。只在内存。 */
    const secrets = new Map();

    const callModel = async ({ api, messages, temperature, maxTokens, extraBody }) => {
        const startedAt = Date.now();
        const result = await callModelOnce({ api, messages, temperature, maxTokens, extraBody });
        return { ...result, modelMs: Date.now() - startedAt };
    };

    const callModelOnce = async ({ api, messages, temperature, maxTokens, extraBody }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(chatCompletionsUrl(api.baseUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
                },
                // 跟手机本地这一轮发出去的一字不差：同一句话换了参数，用户看不出来但角色就变了。
                body: JSON.stringify({
                    model: api.model,
                    messages,
                    ...(typeof temperature === 'number' ? { temperature } : {}),
                    ...(maxTokens ? { max_tokens: maxTokens } : {}),
                    stream: false,
                    ...(extraBody && typeof extraBody === 'object' ? extraBody : {}),
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                // 正文可能回显整段提示词，只留状态码和一小截
                return { ok: false, error: `模型返回 ${response.status}：${detail.slice(0, 200)}` };
            }
            const data = await response.json();
            const message = data?.choices?.[0]?.message;
            const { text, thinking } = splitEmbeddedThinking(extractContentText(message?.content));
            if (!text) return { ok: false, error: '模型返回了空内容' };
            // 跟本地同一个拼法：reasoning 字段在前，正文里抠出来的思考块在后
            const reasoning = [extractReasoning(message), thinking].filter(Boolean).join('\n\n');
            return {
                ok: true, text, reasoning, usage: data?.usage ?? null,
                ...(reasoning ? {} : { shape: describeResponseShape(data, extraBody) }),
            };
        } catch (error) {
            if (error?.name === 'AbortError') return { ok: false, error: `等了 ${Math.round(timeoutMs / 1000)} 秒模型还没回` };
            return { ok: false, error: String(error?.message || error).slice(0, 200) };
        } finally {
            clearTimeout(timer);
        }
    };

    const fail = async (job, reason) => {
        const { turnId, charId, charName } = job.input;
        await deliver({
            messageId: `mini:${turnId}:error`,
            charId,
            jobUuid: job.uuid,
            kind: 'chat_error',
            payload: { turnId, charId, charName, reason, createdAt: new Date().toISOString() },
            title: charName,
            body: '这一轮没回成',
            pushPayload: buildErrorPush({ turnId, charId, charName, reason }),
        });
        throw new Error(reason);
    };

    const handler = async job => {
        const request = secrets.get(job.uuid);
        secrets.delete(job.uuid);
        // 进程重启过：凭据只在内存，这一轮没法再跑，让手机重发。
        if (!request) return fail(job, 'Mac mini 后端中途重启过，这一轮没跑完，重发一次就好');
        const result = await callModel(request);
        if (!result.ok) return fail(job, result.error);
        const { turnId, charId, charName } = job.input;
        const at = new Date().toISOString();
        const preview = await notificationPreview(result.text);
        const push = buildReplyPush({ turnId, charId, charName, text: result.text, reasoning: result.reasoning, usage: result.usage, at, preview });
        await deliver({
            messageId: push.messageId,
            charId,
            jobUuid: job.uuid,
            kind: 'chat_reply',
            // 信箱里存整份推送：推送丢了，手机按同一形状塞回收件箱
            payload: push,
            title: charName,
            body: push.notification.body,
            pushPayload: fitsInPush(push) ? push : buildPullPush({ turnId, charId, charName, text: result.text, preview }),
        });
        return {
            ok: true, chars: result.text.length, reasoningChars: result.reasoning.length, modelMs: result.modelMs, usage: result.usage ?? null,
            ...(result.shape ? { shape: result.shape } : {}),
        };
    };

    /**
     * 受理一轮：先落 jobs 再回话（durability 在前），然后不等巡逻立刻开跑。
     * 连发时顶掉上一轮还没开跑的（已经在跑的顶不掉，那一轮照常回，手机那边认新的 turnId）。
     */
    const submit = (body, { handlers, now = new Date(), timing = null } = {}) => {
        const error = validateTurn(body);
        if (error) return { ok: false, error };
        const uuid = jobUuidFor(body.turnId);
        if (body.supersedes) {
            // 只顶还没开跑的；已经在跑的那一轮照常回完（手机那边已经不认它的 turnId 了）
            const previous = jobUuidFor(body.supersedes);
            const changed = db.prepare(
                `UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE uuid = ? AND status = 'pending'`,
            ).run(now.toISOString(), previous).changes;
            if (changed) secrets.delete(previous);
        }
        const { job, duplicated } = createJob(db, {
            uuid,
            kind: CHAT_TURN_KIND,
            // jobs.char_id 外键要求角色在后端登记过（开了心跳的才登记）；跟任何角色聊天都该能交给 mini，
            // 所以不挂这个外键，角色 id 放在 input 里，同一角色串行靠 serializeGroup。
            charId: null,
            serializeGroup: `${body.charId}#${CHAT_TURN_KIND}`,
            runAt: now.toISOString(),
            maxAttempts: 1,
            missedPolicy: 'catch_up',
            input: {
                turnId: body.turnId,
                charId: body.charId,
                charName: String(body.charName || '').slice(0, 40),
                // 排查用：手机上传这一轮花了多久、多大（不含内容）
                ...(timing ? { uploadMs: timing.uploadMs, uploadBytes: timing.bytes } : {}),
            },
            createdBy: 'client',
        }, now);
        if (!duplicated) {
            secrets.set(uuid, {
                api: { baseUrl: body.api.baseUrl, model: body.api.model, apiKey: body.api.apiKey || '' },
                messages: body.messages,
                temperature: body.temperature,
                maxTokens: body.maxTokens,
                extraBody: body.extraBody,
            });
            if (handlers) {
                setImmediate(() => {
                    runJobNow(db, uuid, { handlers, logger }).catch(err => logger.warn?.(`[agent] 即时回复没跑起来：${err?.message || err}`));
                });
            }
        }
        return { ok: true, turnId: body.turnId, status: job.status, duplicated };
    };

    /** 手机每 60 秒点一次名。state：pending / running / done / failed / cancelled / gone。 */
    const status = turnId => {
        if (!isUuidish(turnId)) return { state: 'gone' };
        const job = toJob(db.prepare('SELECT * FROM jobs WHERE uuid = ?').get(jobUuidFor(turnId)));
        if (!job) return { state: 'gone' };
        return { state: job.status, ...(job.lastError ? { error: job.lastError } : {}) };
    };

    /** 这个角色有没有一轮正在跑 / 排着：心跳据此不插话。 */
    const busy = charId => Boolean(db.prepare(
        `SELECT 1 FROM jobs WHERE kind = ? AND status IN ('pending', 'running')
            AND json_extract(input, '$.charId') = ? LIMIT 1`,
    ).get(CHAT_TURN_KIND, charId));

    return { submit, status, busy, handler };
};
