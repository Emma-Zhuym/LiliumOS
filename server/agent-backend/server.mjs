/**
 * HTTP 接口层（/agent/v1）。
 *
 * 只用 GET 与 POST：mini 上那个共用代理（scripts/home-assistant-proxy.mjs）只放行这两种方法，
 * 加了 PUT / DELETE 在本机测得通、过代理就会被挡下。
 *
 * 除 /health 与 /pair 外一律要求设备钥匙。响应一律 { ok, data } 或 { ok:false, error }。
 */

import { createServer } from 'node:http';
import { authenticate, createPairingCode, listDevices, putPushSubscription, redeemPairingCode, revokeDevice } from './devices.mjs';
import { ack, listUnacked } from './outbox.mjs';
import { cancelJob, createJob, listJobs } from './jobs.mjs';
import { characterExists, listCharacters, touchPresence, upsertCharacter } from './characters.mjs';
import { listCredentials, putCredential } from './credentials.mjs';
import { listModelRuns } from './heartbeat.mjs';
import { listSnapshotMeta, putSnapshot } from './snapshots.mjs';
import { getSetting, setSetting } from './db.mjs';
import { listTemporalItems, readVisibility, veilForCharacter, VISIBILITY, SOURCES_TIMEOUT_MS } from './temporal.mjs';
import { syncState } from './kinds.mjs';
import { flattenContent } from './mcp.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const PREFIX = '/agent/v1';

const json = (res, status, payload, origin) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        ...corsHeaders(origin),
    });
    res.end(body);
};

const ok = (res, data, origin) => json(res, 200, { ok: true, data }, origin);
const fail = (res, status, code, message, origin) =>
    json(res, status, { ok: false, error: { code, message } }, origin);

const corsHeaders = origin => (origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
} : { Vary: 'Origin' });

const readBody = req => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            reject(Object.assign(new Error('请求体过大'), { code: 'PAYLOAD_TOO_LARGE' }));
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) { resolve({}); return; }
        try { resolve(JSON.parse(raw)); } catch {
            reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON' }));
        }
    });
    req.on('error', reject);
});

/**
 * 路由表。每个 handler 收到 { db, body, query, device, ctx }，返回要放进 data 的对象；
 * 抛出带 code 的错误即按业务失败返回。
 */
export const createRouter = ctx => {
    const { db, config } = ctx;
    const routes = {
        'GET /health': { auth: false, handle: () => ({ ok: true, version: config.version }) },

        'POST /pair': {
            auth: false,
            handle: ({ body }) => {
                const result = redeemPairingCode(db, {
                    code: String(body.code || ''),
                    deviceName: body.deviceName,
                });
                if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code, status: 401 });
                return { deviceId: result.deviceId, deviceToken: result.deviceToken };
            },
        },

        'GET /status': { handle: () => ctx.buildStatus() },

        'GET /devices': { handle: () => ({ devices: listDevices(db) }) },
        'POST /devices/push': {
            handle: ({ body, device }) => {
                const result = putPushSubscription(db, device.id, body.subscription ?? body);
                if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code, status: 400 });
                return { ok: true };
            },
        },
        'POST /devices/revoke': {
            handle: ({ body }) => {
                const result = revokeDevice(db, String(body.deviceId || ''));
                if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code, status: 400 });
                return { ok: true };
            },
        },

        'POST /jobs': {
            handle: ({ body, device }) => {
                const kind = String(body.kind || '');
                if (!ctx.allowedClientKinds.includes(kind)) {
                    throw Object.assign(new Error(`不支持从客户端创建这种任务：${kind}`), {
                        code: 'KIND_NOT_ALLOWED', status: 400,
                    });
                }
                const charId = body.charId ?? null;
                if (charId && !characterExists(db, charId)) {
                    // 角色是任务表的外键：没登记过就先登记，否则这里会以 500 的形式炸出来。
                    throw Object.assign(new Error('这个角色还没在后端登记'), {
                        code: 'UNKNOWN_CHARACTER', status: 400,
                    });
                }
                const { job, duplicated } = createJob(db, {
                    uuid: body.uuid,
                    kind,
                    charId,
                    runAt: body.runAt || new Date().toISOString(),
                    expiresAt: body.expiresAt ?? null,
                    missedPolicy: body.missedPolicy === 'drop' ? 'drop' : 'catch_up',
                    input: body.input ?? {},
                    createdBy: `device:${device.id}`,
                });
                return { job, duplicated };
            },
        },
        'GET /jobs': {
            handle: ({ query }) => ({
                jobs: listJobs(db, {
                    status: query.get('status') || 'all',
                    charId: query.get('charId'),
                    limit: query.get('limit'),
                }),
            }),
        },
        'POST /jobs/cancel': {
            handle: ({ body }) => ({ cancelled: cancelJob(db, String(body.uuid || '')) }),
        },

        'GET /characters': { handle: () => ({ characters: listCharacters(db) }) },
        'POST /characters/upsert': {
            handle: ({ body }) => ({ character: upsertCharacter(db, body) }),
        },
        'POST /characters/presence': {
            handle: ({ body }) => {
                const charId = String(body.charId || '');
                if (!characterExists(db, charId)) {
                    throw Object.assign(new Error('这个角色还没在后端登记'), {
                        code: 'UNKNOWN_CHARACTER', status: 400,
                    });
                }
                // 只回执，不回读时间：客户端不需要，也省得把互动时间到处散播。
                return { updated: touchPresence(db, charId) };
            },
        },

        'POST /characters/snapshot': {
            handle: ({ body, device }) => {
                const charId = String(body.charId || '');
                if (!characterExists(db, charId)) {
                    throw Object.assign(new Error('这个角色还没在后端登记'), {
                        code: 'UNKNOWN_CHARACTER', status: 400,
                    });
                }
                return putSnapshot(db, {
                    charId,
                    schemaVersion: Number(body.schemaVersion) || 1,
                    builtAt: body.builtAt,
                    payload: body.payload,
                    sourceDevice: device.id,
                });
            },
        },
        'GET /characters/snapshots': {
            // 只报「有没有、多新」，正文不回读：近况里带着聊天内容。
            handle: () => ({ snapshots: listSnapshotMeta(db) }),
        },

        'POST /credentials/put': {
            handle: ({ body }) => ({ credential: putCredential(config, body) }),
        },
        'GET /credentials': {
            // 只读得到 ref / baseUrl / model，永远读不到 Key。
            handle: () => ({ credentials: listCredentials(config) }),
        },

        'GET /audit': {
            // 影子期就靠这个看角色「本来想说什么」（设计第 9 节第 2 条）。
            handle: ({ query }) => ({
                modelRuns: listModelRuns(db, {
                    charId: query.get('charId'),
                    limit: query.get('limit'),
                }),
            }),
        },

        // ── 阿萌的现实时间（Apple 日历 / 提醒）──────────────────────────
        'GET /temporal': {
            // 日历 App 读这个：缓存里的条目 + 上次同步时间 + 当前可见性设置。
            handle: ({ query }) => ({
                items: listTemporalItems(db, { from: query.get('from'), to: query.get('to') }),
                visibility: readVisibility(getSetting(db, 'temporal_visibility')),
                sync: syncState(db),
            }),
        },
        'GET /temporal/sources': {
            // 列出有哪些日历 / 提醒清单，供设置页勾选。直接问桥接，不进缓存——
            // 列日历那一下要 20 多秒（EventKit 慢），所以只在打开设置页时调。
            handle: async () => {
                const [calendars, lists] = await Promise.all([
                    ctx.appleEvents.callTool('calendar_calendars', { action: 'read' }, { timeoutMs: SOURCES_TIMEOUT_MS }),
                    ctx.appleEvents.callTool('reminders_lists', { action: 'read' }, { timeoutMs: SOURCES_TIMEOUT_MS }),
                ]);
                // 提醒清单那一行后面还挂着 (Color: …) (ID: …)，得剥干净：
                // 这个名字既要当 filterList 传回去，又要跟条目里的 List: 对上。
                const names = result => flattenContent(result, 8000).split('\n')
                    .map(line => line.match(/^- (.+)$/)?.[1]?.replace(/\s*\((?:Color|ID):[^)]*\)/g, '').trim())
                    .filter(Boolean);
                return { calendars: names(calendars), lists: names(lists) };
            },
        },
        // 用 POST 不用 PUT：外面那层网关（scripts/home-assistant-proxy.mjs）只放行 GET / POST，
        // 而且这个后端其余的写接口（characters/upsert、outbox/ack…）也全是 POST。
        'POST /temporal/visibility': {
            handle: ({ body }) => {
                const clean = source => Object.fromEntries(
                    Object.entries(source ?? {})
                        .filter(([name, level]) => typeof name === 'string' && VISIBILITY.includes(level))
                        .map(([name, level]) => [name.slice(0, 80), level]),
                );
                const next = { calendars: clean(body.calendars), lists: clean(body.lists) };
                setSetting(db, 'temporal_visibility', JSON.stringify(next));
                return { visibility: next };
            },
        },

        'GET /outbox': {
            handle: ({ query }) => ({
                messages: listUnacked(db, { after: query.get('after'), limit: query.get('limit') }),
            }),
        },
        'POST /outbox/ack': {
            handle: ({ body, device }) => ack(db, body.messageIds, device.id),
        },
    };
    return routes;
};

export const createApp = ctx => {
    const routes = createRouter(ctx);
    const { db, config } = ctx;

    return async (req, res) => {
        const origin = config.allowedOrigins.includes(req.headers.origin) ? req.headers.origin : null;
        if (req.method === 'OPTIONS') {
            res.writeHead(204, corsHeaders(origin));
            res.end();
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const path = url.pathname.replace(/\/+$/, '') || '/';
        if (!path.startsWith(PREFIX)) {
            fail(res, 404, 'NOT_FOUND', '未知路径', origin);
            return;
        }
        const key = `${req.method} ${path.slice(PREFIX.length) || '/'}`;
        const route = routes[key];
        if (!route) {
            fail(res, 404, 'NOT_FOUND', '未知路径', origin);
            return;
        }

        let device = null;
        if (route.auth !== false) {
            device = authenticate(db, req.headers.authorization);
            if (!device) {
                fail(res, 401, 'UNAUTHORIZED', '设备钥匙无效或缺失', origin);
                return;
            }
        }

        try {
            const body = req.method === 'POST' ? await readBody(req) : {};
            const data = await route.handle({ db, body, query: url.searchParams, device, ctx });
            ok(res, data, origin);
        } catch (error) {
            const status = error?.status || (error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 500);
            const code = error?.code || 'INTERNAL_ERROR';
            if (status >= 500) {
                // 只记路由和错误信息，不记请求体——里面可能有聊天内容。
                console.error(`[agent] ${key} 失败：${error?.message || error}`);
            }
            fail(res, status, code, status >= 500 ? '服务内部错误' : String(error.message), origin);
        }
    };
};

export const startServer = (ctx, { onFatal = message => { console.error(message); process.exit(1); } } = {}) => {
    const server = createServer(createApp(ctx));
    // 不接 error 事件的话，端口被占会以未捕获异常的形式崩掉；LaunchAgent 的 KeepAlive
    // 会立刻把它拉起来，于是变成每秒崩一次的重启循环，日志里全是同一段堆栈。
    server.on('error', error => {
        if (error?.code === 'EADDRINUSE') {
            onFatal(`[agent] 端口 ${ctx.config.host}:${ctx.config.port} 已被占用——多半是已经有一个后端在跑了。`
                + '确认后再启动，或用 AGENT_BACKEND_PORT 换一个端口。');
            return;
        }
        onFatal(`[agent] 监听失败：${error?.message || error}`);
    });
    server.listen(ctx.config.port, ctx.config.host);
    return server;
};

export { createPairingCode };
