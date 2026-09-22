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
import { createHaWatchdogHandler, createTestPingHandler, probeHomeAssistant } from './kinds.mjs';
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

    const handlers = {
        'test.ping': createTestPingHandler({ appleEvents, deliver }),
        'ha.watchdog': createHaWatchdogHandler({ db, config, deliver }),
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
                // 1c 才接；先如实报「还没有」，前端据此不显示心跳开关。
                codex: { ok: false, detail: 'not-implemented' },
            },
            // 前端只认这个字段判断功能可用与否（设计约束 4）。
            capabilities: ['jobs', 'outbox', 'watchdog'],
        };
    };

    return {
        config, db, pusher, appleEvents, handlers, deliver, quietState, buildStatus,
        // 客户端只允许创建这些种类；心跳等只能由调度器自己排。
        allowedClientKinds: ['test.ping'],
    };
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
