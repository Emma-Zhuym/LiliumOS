#!/usr/bin/env node
/**
 * LiliumOS Agent Backend —— Mac mini 上的常驻服务（Phase 1a / 1b）。
 *
 * 目前只做不需要模型的部分：配对、推送、信箱、任务调度、连通测试、Home Assistant 看门狗。
 * 心跳与 Codex 运行器在 1c 之后加，契约见 docs/agent-backend-design.md。
 *
 * 启动：node server/agent-backend/index.mjs
 * 配对：node server/agent-backend/cli.mjs pair
 */

import { ensureDataDir, loadConfig, readSecret } from './config.mjs';
import { getSetting, openDb } from './db.mjs';
import { listCharacters } from './characters.mjs';
import {
    FIRST_BEAT_DELAY_MS, HEARTBEAT_TTL_MS, createHeartbeatHandler, heartbeatUuid, isShadowMode, nextRunAt,
    upcomingBreakStarts, HEARTBEAT_JITTER_SPREAD,
} from './heartbeat.mjs';
import { getSnapshot } from './snapshots.mjs';
import { createHaWatchdogHandler, createTemporalRefreshHandler, createTestPingHandler, probeHomeAssistant, syncState } from './kinds.mjs';
import { createApiRunner, createCodexRunnerStub } from './runner.mjs';
import { createJob, inQuietWindow, recoverStaleLeases, runTick } from './jobs.mjs';
import { createMcpClient } from './mcp.mjs';
import { cleanup as cleanupOutbox, enqueue } from './outbox.mjs';
import { createPusher, recordDeliveries } from './push.mjs';
import { startServer } from './server.mjs';

const TICK_MS = 15_000;
const WATCHDOG_EVERY_MIN = 5;

export const createContext = async (config = loadConfig()) => {
    ensureDataDir(config);
    const db = openDb(config.dbPath);
    const pusher = await createPusher(config);

    const appleEventsToken = readSecret(config, 'apple-events-token');
    const appleEvents = createMcpClient({ url: config.appleEventsUrl, token: appleEventsToken });

    /** 写信箱 + 推送 + 记投递结果。所有对外说话都走这一个口子。 */
    const deliver = async ({ messageId, charId = null, jobUuid = null, kind, payload, title, body, notify = true }) => {
        const entry = enqueue(db, { messageId, charId, jobUuid, kind, payload, notify });
        if (entry.duplicated || !notify) return entry;
        const results = await pusher.send(db, { messageId: entry.messageId, title, body });
        if (results.length) recordDeliveries(db, entry.messageId, results);
        return entry;
    };

    const quietState = (now = new Date()) => {
        const timezone = getSetting(db, 'timezone') || 'America/Chicago';
        const start = getSetting(db, 'quiet_start') || '00:00';
        const end = getSetting(db, 'quiet_end') || '07:00';
        return { active: inQuietWindow(now, { start, end, timezone }), start, end, timezone };
    };

    /** 给 nextRunAt 用的安静时段判断：排跳时避开 0–7 点，而不是排完再靠巡逻拦。 */
    const quietForScheduling = {
        isQuiet: date => quietState(date).active,
        nextEndAfter: date => {
            const { end, timezone } = quietState(date);
            const [hour, minute] = String(end).split(':').map(Number);
            // 从 date 往后找最近的一个 quiet_end 时刻（最多找两天，跨午夜也够用）。
            for (let step = 0; step <= 48; step += 1) {
                const candidate = new Date(date.getTime() + step * 30 * 60_000);
                const local = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
                }).format(candidate).split(':').map(Number);
                if (local[0] === hour && local[1] >= minute) return candidate;
            }
            return new Date(date.getTime() + 60 * 60_000);
        },
    };

    /** 排下一跳。心跳链由服务端自己续，不靠 cron，进程重启也不会整条断掉。 */
    const scheduleNextHeartbeat = (character, now = new Date()) => {
        if (!character.heartbeatEnabled || character.heartbeatPaused) return null;
        // 瞄准午休 / 下班这类空档：日程里有的话，把下一跳排进去（没有日程就照常随机）。
        const snapshot = getSnapshot(db, character.charId);
        const timezone = snapshot?.payload?.timezone || getSetting(db, 'timezone') || 'America/Chicago';
        const runAt = nextRunAt(character, {
            now,
            everyMinOverride: config.heartbeatEveryMinOverride,
            quiet: quietForScheduling,
            breakStarts: upcomingBreakStarts(snapshot, now, timezone),
        });
        const { job } = createJob(db, {
            uuid: heartbeatUuid(character.charId, character.heartbeatGeneration, runAt),
            kind: 'heartbeat',
            charId: character.charId,
            runAt: runAt.toISOString(),
            missedPolicy: 'drop',
            expiresAt: new Date(runAt.getTime() + HEARTBEAT_TTL_MS).toISOString(),
            // 心跳只试一次：这一跳失败就由下一跳接续，不要把旧的判断补跑出来（设计 4.2）。
            maxAttempts: 1,
            generation: character.heartbeatGeneration,
            createdBy: 'scheduler',
        }, now);
        return job;
    };

    const runners = {
        api: createApiRunner({ config }),
        codex: createCodexRunnerStub(),
    };

    const handlers = {
        'test.ping': createTestPingHandler({ appleEvents, deliver }),
        'ha.watchdog': createHaWatchdogHandler({ db, config, deliver }),
        // 阿萌的现实时间：每天读一次 Apple 日历 / 提醒，不调模型。
        'temporal.refresh': createTemporalRefreshHandler({ db, appleEvents }),
        heartbeat: createHeartbeatHandler({
            db, config, runners, scheduleNext: scheduleNextHeartbeat, deliver,
        }),
    };

    const buildStatus = async () => {
        const quiet = quietState();
        const activeDevices = db.prepare(
            "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL AND push_status = 'active'",
        ).get().n;
        const [appleOk, haOk] = await Promise.all([
            appleEvents.listTools().then(tools => tools.length > 0).catch(() => false),
            probeHomeAssistant(config.homeAssistantUrl),
        ]);
        return {
            version: config.version,
            apiVersion: config.apiVersion,
            now: new Date().toISOString(),
            quiet,
            deps: {
                appleEvents: { ok: appleOk },
                homeAssistant: { ok: haOk },
                push: { ok: pusher.ready, detail: pusher.reason, activeDevices },
                // Codex 那条路还没接：如实报「没有」，前端据此不给 codex 角色开心跳。
                codex: { ok: false, detail: 'not-implemented' },
            },
            heartbeat: {
                // 影子期：照常判断、照常调模型，但不发消息、不执行工具。
                shadow: isShadowMode(db),
                // 试跑提速开着时必须报出来，否则很容易忘了它还在生效。
                everyMinOverride: config.heartbeatEveryMinOverride || null,
                // 前端据此显示「平均 60 分钟（约 30–90）」，不必自己再抄一份幅度。
                jitterSpread: HEARTBEAT_JITTER_SPREAD,
            },
            // 前端只认这个字段判断功能可用与否（设计约束 4）。
            capabilities: ['jobs', 'outbox', 'watchdog', 'heartbeat-shadow'],
        };
    };

    return {
        config, db, pusher, appleEvents, handlers, deliver, quietState, buildStatus,
        scheduleNextHeartbeat,
        // 客户端只允许创建这些种类；心跳只能由调度器自己排（设计 3.5）。
        // temporal.refresh 允许：它不调模型、只读阿萌自己的日历，就是日历页那个「立刻刷新」。
        allowedClientKinds: ['test.ping', 'temporal.refresh'],
    };
};

/**
 * 给开着心跳、却一条待跑心跳都没有的角色补排一跳。
 *
 * 开心跳、恢复暂停、进程重启后掉链子，都靠这里接回来。约 3 分钟后的第一跳（设计 3.3），
 * 之后每跳自己续下一跳。
 */
export const ensureHeartbeatJobs = (ctx, now = new Date()) => {
    const { db } = ctx;
    for (const character of listCharacters(db)) {
        if (!character.heartbeatEnabled || character.heartbeatPaused) continue;
        const pending = db.prepare(
            `SELECT COUNT(*) AS n FROM jobs
              WHERE char_id = ? AND kind = 'heartbeat' AND status IN ('pending','running')`,
        ).get(character.charId).n;
        if (pending > 0) continue;
        const runAt = new Date(now.getTime() + FIRST_BEAT_DELAY_MS);
        createJob(db, {
            uuid: heartbeatUuid(character.charId, character.heartbeatGeneration, runAt),
            kind: 'heartbeat',
            charId: character.charId,
            runAt: runAt.toISOString(),
            missedPolicy: 'drop',
            expiresAt: new Date(runAt.getTime() + HEARTBEAT_TTL_MS).toISOString(),
            maxAttempts: 1,
            generation: character.heartbeatGeneration,
            createdBy: 'scheduler',
        }, now);
    }
};

/**
 * 现实时间同步：每天一次自己续排。
 *
 * 排在设置里的间隔之后（默认 24 小时）。手动刷新是另外创建一条马上跑的，两者互不影响：
 * 手动刷新不会把自动的那条挤掉，自动的也不会因为你刚手动刷过就跳过——最多多读一次，很便宜。
 */
const ensureTemporalJob = (db, now = new Date()) => {
    const pending = db.prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'temporal.refresh' AND status = 'pending'",
    ).get().n;
    if (pending > 0) return;
    const everyHours = Math.min(168, Math.max(1, Number(syncState(db).everyHours) || 24));
    const last = Date.parse(syncState(db).lastAt || '') || 0;
    // 从没同步过就 1 分钟后跑一次（刚开完可见性开关，别让阿萌等一天）。
    const runAt = last ? new Date(Math.max(now.getTime() + 60_000, last + everyHours * 3600_000)) : new Date(now.getTime() + 60_000);
    createJob(db, {
        uuid: `temporal:${runAt.toISOString().slice(0, 13)}`,
        kind: 'temporal.refresh',
        runAt: runAt.toISOString(),
        // 错过就算了：下一次同步照样读的是最新的日历，补跑没有意义。
        missedPolicy: 'drop',
        expiresAt: new Date(runAt.getTime() + 6 * 3600_000).toISOString(),
        maxAttempts: 2,
        createdBy: 'scheduler',
    }, now);
};

/** 看门狗自己续排下一次：不用 cron，也就不会因为进程重启漏掉一整条链。 */
const ensureWatchdogJob = (db, now = new Date()) => {
    const pending = db.prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'ha.watchdog' AND status = 'pending'",
    ).get().n;
    if (pending > 0) return;
    const runAt = new Date(now.getTime() + WATCHDOG_EVERY_MIN * 60_000);
    createJob(db, {
        uuid: `watchdog:${runAt.toISOString().slice(0, 16)}`,
        kind: 'ha.watchdog',
        runAt: runAt.toISOString(),
        // 错过就算了：几小时前的探活结果现在没有意义。
        missedPolicy: 'drop',
        expiresAt: new Date(runAt.getTime() + 10 * 60_000).toISOString(),
        maxAttempts: 1,
        createdBy: 'scheduler',
    }, now);
};

export const startScheduler = ctx => {
    const { db, handlers } = ctx;
    recoverStaleLeases(db);
    let running = false;
    const tick = async () => {
        if (running) return;        // 上一轮还没跑完就跳过这一轮，别让慢任务把巡逻挤成串
        running = true;
        try {
            ensureWatchdogJob(db);
            ensureTemporalJob(db);
            ensureHeartbeatJobs(ctx);
            await runTick(db, { handlers, quiet: ctx.quietState() });
            cleanupOutbox(db);
        } catch (error) {
            console.error(`[agent] 巡逻出错：${error?.message || error}`);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(tick, TICK_MS);
    timer.unref?.();
    void tick();
    return () => clearInterval(timer);
};

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
    const ctx = await createContext();
    const server = startServer(ctx);
    const stopScheduler = startScheduler(ctx);
    console.log(`[agent] 已启动 http://${ctx.config.host}:${ctx.config.port}${''}/agent/v1（库：${ctx.config.dbPath}）`);
    if (!ctx.pusher.ready) console.warn(`[agent] 推送未就绪：${ctx.pusher.reason}`);
    const shutdown = () => {
        stopScheduler();
        server.close(() => process.exit(0));
        // 关不干净也别吊着：给正在跑的请求 5 秒收尾。
        setTimeout(() => process.exit(0), 5_000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
