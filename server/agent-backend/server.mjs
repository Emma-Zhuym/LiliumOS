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
import { characterExists, getCharacter, listCharacters, toCharacter, touchPresence, upsertCharacter } from './characters.mjs';
import { listCredentials, putCredential } from './credentials.mjs';
import { lastRealInteractionAt, listModelRuns } from './heartbeat.mjs';
import { applyThread, cancelPlan, listPlans } from './lifeThreads.mjs';
import { parsePlanTime } from './planTime.mjs';
import { listPocketForPhone } from './pocket.mjs';
import {
    applyTemperament, evolve as evolveDrives, ingestChatEvents, loadState as loadDriveState, privateMomentOf, setPrivateMoment, summarizeForPhone,
} from './drives.mjs';
import { getSnapshot, listSnapshotMeta, putSnapshot } from './snapshots.mjs';
import { getSetting, setSetting } from './db.mjs';
import { readAdminSettings, writeAdminSettings } from './adminSettings.mjs';
import { cancelDeepTalkDue, scheduleDeepTalkDue } from './deepTalk.mjs';
import {
    createReminder, listTemporalItems, readVisibility, removeTemporalItems, setReminderCompleted,
    upsertTemporalItem, veilForCharacter, VISIBILITY, SOURCES_TIMEOUT_MS,
} from './temporal.mjs';
import { syncState } from './kinds.mjs';
import { flattenContent } from './mcp.mjs';
import { fetchRemoteImage, listImages, MAX_IMAGE_BYTES, putImage } from './imageVault.mjs';

const MAX_BODY_BYTES = 256 * 1024;
/** 即时回复这一路：整轮对话连同阿萌发过的图（已还原成 data URL）一起上来，给足。 */
const CHAT_TURN_MAX_BODY_BYTES = 16 * 1024 * 1024;
/** 图片仓库：一张图 base64 后约大三分之一，再留点 JSON 余量。 */
const IMAGE_PUT_MAX_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64 * 1024;
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

const readBody = (req, limit = MAX_BODY_BYTES) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
        size += chunk.length;
        if (size > limit) {
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
    const requireDriveChar = raw => {
        const charId = String(raw || '');
        if (!characterExists(db, charId)) {
            throw Object.assign(new Error('这个角色还没在后端登记'), { code: 'UNKNOWN_CHARACTER', status: 400 });
        }
        return charId;
    };
    /** 心思系统算时间要的：角色那边几点、多久没真聊天、脾气读数（都跟心跳读的同一份快照）。 */
    const driveContext = (charId, now) => {
        const snapshot = getSnapshot(db, charId);
        const timeZone = snapshot?.payload?.timezone || getSetting(db, 'timezone') || 'UTC';
        const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric' }).format(now)) || 12;
        const character = toCharacter(getCharacter(db, charId));
        const lastContact = character ? lastRealInteractionAt(character, snapshot) : null;
        return {
            localHour,
            silenceHours: lastContact ? Math.max(0, (now.getTime() - lastContact.getTime()) / 3_600_000) : 0,
            temperament: snapshot?.payload?.driveTemperament ?? null,
        };
    };
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
        // 烛下约好的时间：手机交过来，到点 mini 来叫她（deepTalk.mjs）
        'POST /deep-talk/plans': {
            handle: ({ body }) => {
                const charId = requireDriveChar(body.charId);
                return { plan: scheduleDeepTalkDue(db, { charId, nightId: body.nightId, dueAt: body.dueAt, charName: body.charName }) };
            },
        },
        'POST /deep-talk/plans/cancel': {
            handle: ({ body }) => ({ cancelled: cancelDeepTalkDue(db, String(body.nightId || '')) }),
        },
        // 机房 App 的开关：只认白名单里那几项（adminSettings.mjs）
        'GET /settings': { handle: () => ({ settings: readAdminSettings(db) }) },
        'POST /settings': { handle: ({ body }) => ({ settings: writeAdminSettings(db, body.settings) }) },

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

        // 每个角色带上下一跳几点（机房 App「此刻」那一行）；没排上就是 null
        'GET /characters': {
            handle: () => {
                const next = db.prepare(
                    "SELECT run_at FROM jobs WHERE kind = 'heartbeat' AND char_id = ? AND status IN ('pending','running') ORDER BY run_at LIMIT 1",
                );
                return { characters: listCharacters(db).map(c => ({ ...c, nextHeartbeatAt: next.get(c.charId)?.run_at ?? null })) };
            },
        },
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

        // ── 角色们的约定（心跳里跟亲友约下的事）─────────────────────────
        'GET /plans': {
            // 日历 App 摆出来、聊天里告诉 TA 自己约了什么。默认往前一周、往后两个月。
            handle: ({ query }) => ({ plans: listPlans(db, { from: query.get('from'), to: query.get('to') }) }),
        },
        // 聊天里 TA 自己约下 / 取消的事（utils/emAgentPlans.ts）。时间跟心跳一样由这里按角色时区解析，
        // 认不出就整条不记：宁可少一个约定，也不能落一个错的时间。
        'POST /plans': {
            handle: ({ body }) => {
                const charId = requireDriveChar(body.charId);
                const snapshot = getSnapshot(db, charId);
                const timeZone = snapshot?.payload?.timezone || getSetting(db, 'timezone') || 'America/Chicago';
                const what = String(body.what || '').trim();
                const at = String(body.at || '').trim();
                // 「明天下午」按说这句话的时候算：mini 不在线时手机排着队，晚几小时才送到也不会差一天。
                // 只认过去三天内的 saidAt；算出来已经过了的照样不记。
                const now = new Date();
                const said = Date.parse(body.saidAt);
                const saidAt = Number.isFinite(said) && said <= now.getTime() && now.getTime() - said <= 3 * 86_400_000 ? new Date(said) : now;
                const parsed = parsePlanTime(at, saidAt, timeZone);
                const dueAt = parsed && parsed > now ? parsed : null;
                if (!what || !dueAt) {
                    throw Object.assign(new Error(what ? `认不出时间：${at.slice(0, 40)}` : '没写做什么'), { code: 'BAD_PLAN', status: 400 });
                }
                const plan = applyThread(db, charId, {
                    title: what, summary: `约在${at}`, status: 'open', dueAt: dueAt.toISOString(), timeZone,
                });
                return { plan: { ...plan, charId } };
            },
        },
        'POST /plans/cancel': {
            handle: ({ body }) => {
                const charId = requireDriveChar(body.charId);
                const plan = cancelPlan(db, charId, body.id);
                return { cancelled: plan ? { ...plan, charId } : null };
            },
        },

        // ── 心思系统：聊天里副 API 评估给的事件标签（drives.mjs）──────────────
        'POST /drives/events': {
            handle: ({ body }) => {
                const charId = requireDriveChar(body.charId);
                const { localHour, temperament } = driveContext(charId, new Date());
                // 她正在聊天：「想你」不再因为久不说话往上爬
                return { accepted: ingestChatEvents(db, { charId, events: body.events, now: new Date(), silenceHours: 0, localHour, temperament }) };
            },
        },
        // 查手机的状态小组件、聊天的「贴贴」按钮用：最强的一两种和档位（不给精确数值），以及在不在两个人的时间里
        'GET /drives': {
            handle: ({ query }) => {
                const charId = String(query.get('charId') || '');
                if (!charId) return { drives: [], private: privateMomentOf(null) };
                const now = new Date();
                // 跟心跳同一种算法：带上多久没说话、角色那边几点，不然查手机看到的跟心跳感觉到的对不上
                const { localHour, silenceHours, temperament } = driveContext(charId, now);
                const state = evolveDrives(applyTemperament(loadDriveState(db, charId, now), temperament), now, { silenceHours, localHour });
                return { drives: summarizeForPhone(state), private: privateMomentOf(state, now) };
            },
        },
        // 「贴贴」按钮：她自己说开始 / 结束（drives.mjs setPrivateMoment）
        'POST /drives/private': {
            handle: ({ body }) => {
                const charId = requireDriveChar(body.charId);
                const now = new Date();
                const { localHour, temperament } = driveContext(charId, now);
                return { private: setPrivateMoment(db, { charId, on: body.on === true, now, silenceHours: 0, localHour, temperament }) };
            },
        },

        // ── 话兜：TA 攒着还没跟阿萌说的话（查手机的草稿箱）─────────────────
        'GET /pocket': {
            // 先拿快照里的聊天记录把已经说过的划掉；她的名字用来筛写给自己的备忘
            handle: ({ query }) => ({
                items: listPocketForPhone(db, { charId: query.get('charId') || null, snapshotsFor: id => getSnapshot(db, id) }),
            }),
        },

        // ── 即时回复：聊天这一轮交给 mini 跑（spec-agent-backend-instant-chat 阶段一）──
        'POST /chat/turns': {
            maxBodyBytes: CHAT_TURN_MAX_BODY_BYTES,
            handle: ({ body, timing }) => {
                const result = ctx.chatTurns.submit(body, { handlers: ctx.handlers, timing });
                if (!result.ok) throw Object.assign(new Error(result.error), { code: 'BAD_REQUEST', status: 400 });
                return { turnId: result.turnId, status: 'accepted' };
            },
        },
        'GET /chat/turns': {
            // 手机每 60 秒点一次名：只有这里说 failed / gone 才算这一轮没了
            handle: ({ query }) => ctx.chatTurns.status(query.get('turnId')),
        },
        'POST /chat/turns/cancel': {
            // 手机上点了「停止」
            handle: ({ body }) => ctx.chatTurns.cancel(String(body?.turnId || '')),
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

        // ── 写回 Apple 提醒事项 ───────────────────────────────────────
        // 建 / 勾完成都是阿萌在界面上等着的，所以同步做（桥接约一秒），不走任务队列。
        'POST /temporal/reminders': {
            handle: async ({ body, db }) => {
                const title = String(body.title ?? '').trim().slice(0, 200);
                const list = String(body.list ?? '').trim().slice(0, 80);
                if (!title) throw Object.assign(new Error('提醒得有个标题'), { status: 400, code: 'BAD_TITLE' });
                if (!list) throw Object.assign(new Error('要放进哪个提醒清单'), { status: 400, code: 'BAD_LIST' });
                const item = await createReminder({
                    appleEvents: ctx.appleEvents,
                    list,
                    title,
                    dueAt: body.dueAt ?? null,
                    note: body.note ? String(body.note).slice(0, 1000) : null,
                    priority: body.priority ?? null,
                    timeZone: getSetting(db, 'timezone') || 'America/Chicago',
                });
                // 不给角色看的清单，建出来的条目也不该进缓存——缓存是喂提示词的那一份。
                const visibility = readVisibility(getSetting(db, 'temporal_visibility'));
                if (visibility.lists[list] && visibility.lists[list] !== 'hidden') upsertTemporalItem(db, item);
                return { item };
            },
        },
        'POST /temporal/reminders/complete': {
            handle: async ({ body, db }) => {
                const sourceId = String(body.sourceId ?? '').trim();
                if (!sourceId) throw Object.assign(new Error('要勾哪一条'), { status: 400, code: 'BAD_ID' });
                const completed = body.completed !== false;
                await setReminderCompleted({ appleEvents: ctx.appleEvents, sourceId, completed });
                // 缓存里只存没完成的，勾掉就从缓存里拿走；取消勾选等明天那次同步补回来。
                if (completed) removeTemporalItems(db, sourceId);
                return { sourceId, completed };
            },
        },

        // ── 图片仓库：外链图存进手机时在 mini 留一份底（imageVault.mjs）──────────
        'POST /images/put': {
            maxBodyBytes: IMAGE_PUT_MAX_BODY_BYTES,
            handle: ({ body }) => {
                const raw = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
                if (!raw) throw Object.assign(new Error('没有图片内容'), { code: 'EMPTY_IMAGE', status: 400 });
                return putImage(config, { data: Buffer.from(raw, 'base64'), mime: body.mime, source: body.source, label: body.label });
            },
        },
        // 浏览器跨域下载不了的外链图：mini 代为下载，存一份，再把图交回手机
        'POST /images/fetch': {
            handle: async ({ body }) => {
                const fetched = await fetchRemoteImage(String(body.url || ''), ctx.imageFetchOptions);
                const saved = putImage(config, { data: fetched.data, mime: fetched.mime, source: body.url, label: body.label });
                return { ...saved, dataBase64: fetched.data.toString('base64') };
            },
        },
        // 只回元数据，不回图
        'GET /images': {
            handle: () => {
                const { count, totalBytes } = listImages(config);
                return { count, totalBytes };
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
        const requestStartedAt = Date.now();
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
            const body = req.method === 'POST' ? await readBody(req, route.maxBodyBytes) : {};
            // 上传花了多久、多大：排查「即时回复慢」时分得清是手机传得慢还是模型 / 推送慢。只有数，没有内容。
            const timing = { uploadMs: Date.now() - requestStartedAt, bytes: Number(req.headers['content-length']) || null };
            const data = await route.handle({ db, body, query: url.searchParams, device, ctx, timing });
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
