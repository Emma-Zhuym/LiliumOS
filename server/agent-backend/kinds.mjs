/**
 * Phase 1a / 1b 的任务处理器。
 *
 * 处理器只做一件事并返回结果摘要；写信箱、推送、重试都由调度器和 deliver 负责。
 * 这里的任务都**不调用模型、不产生现实副作用**（看门狗重启虚拟机除外，那是本机运维动作）。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clearNotice, getSetting, shouldNotice } from './db.mjs';
import { flattenContent } from './mcp.mjs';

const execFileAsync = promisify(execFile);

/**
 * 1a 的验收任务：读一次日历，把结果写进信箱并推送。
 * 它只用只读工具，验证的是「调度 → 工具 → 信箱 → 推送 → 前端补收」整条链。
 */
export const createTestPingHandler = ({ appleEvents, deliver }) => async job => {
    const startedAt = Date.now();
    let calendarSummary = '（未调用日历）';
    let calendarOk = true;
    if (appleEvents) {
        try {
            const result = await appleEvents.callTool('calendar_events', { action: 'read', limit: 3 });
            calendarSummary = flattenContent(result, 300) || '（日历没有返回内容）';
        } catch (error) {
            // 日历连不上不该让这条任务整个失败：它要验证的是「调度 → 信箱 → 推送 → 补收」这条链，
            // 日历只是顺路看一眼。失败原因照实写进消息里，不掩盖。
            calendarOk = false;
            calendarSummary = `日历桥接连不上：${String(error?.message || error).slice(0, 200)}`;
        }
    }
    await deliver({
        messageId: `ping:${job.uuid}`,
        jobUuid: job.uuid,
        kind: 'system_notice',
        title: '后端连通测试',
        body: calendarOk ? '调度、信箱、推送这条链是通的。' : '这条链是通的，但日历桥接连不上。',
        payload: {
            text: calendarOk ? '后端连通测试成功。' : '后端连通测试成功，但日历桥接连不上。',
            detail: calendarSummary,
            createdAt: new Date().toISOString(),
            source: 'test.ping',
        },
    });
    return { ok: true, calendarOk, durationMs: Date.now() - startedAt, calendarSummary: calendarSummary.slice(0, 200) };
};

/**
 * 1b：Home Assistant 看门狗。
 *
 * HA 跑在 UTM 虚拟机里，重启时好时坏，所以这里只做三件事：探活、连续失败到阈值时重启一次、
 * 重启后仍然不通就通知阿萌**一次**。绝不无限重启——那只会把一台起不来的虚拟机反复踢。
 */
export const createHaWatchdogHandler = ({ db, config, deliver, fetchImpl = fetch, execImpl = execFileAsync }) => {
    let consecutiveFailures = 0;
    return async () => {
        const settings = JSON.parse(getSetting(db, 'ha_watchdog') || '{}');
        if (settings.enabled === false) return { skipped: 'disabled' };

        const alive = await probeHomeAssistant(config.homeAssistantUrl, fetchImpl);
        if (alive) {
            consecutiveFailures = 0;
            clearNotice(db, 'ha_down');
            return { ok: true };
        }

        consecutiveFailures += 1;
        const threshold = Number(settings.failuresBeforeRestart) || 3;
        if (consecutiveFailures < threshold) {
            return { ok: false, consecutiveFailures };
        }

        let restart = { attempted: false };
        if (config.utmVmName) {
            restart = await restartUtmVm(config.utmVmName, execImpl);
            // 给 HAOS 一点启动时间再探一次；还不通就认定这次重启没救回来。
            if (restart.ok) {
                await new Promise(resolve => setTimeout(resolve, 60_000));
                if (await probeHomeAssistant(config.homeAssistantUrl, fetchImpl)) {
                    consecutiveFailures = 0;
                    clearNotice(db, 'ha_down');
                    return { ok: true, restarted: true };
                }
            }
        }

        if (shouldNotice(db, 'ha_down')) {
            await deliver({
                messageId: `ha-down:${new Date().toISOString().slice(0, 13)}`,
                kind: 'system_notice',
                title: 'Home Assistant 连不上',
                body: restart.attempted
                    ? '已经试过重启虚拟机，还是起不来，需要你看一眼。'
                    : '连不上，而且没有配置要重启的虚拟机名。',
                payload: {
                    text: 'Home Assistant 连不上。',
                    restart,
                    checkedAt: new Date().toISOString(),
                    source: 'ha.watchdog',
                },
            });
        }
        // 已经通知过就别再攒失败次数，否则每 5 分钟都会走一遍重启分支。
        consecutiveFailures = 0;
        return { ok: false, restarted: restart.ok === true, notified: true };
    };
};

export const probeHomeAssistant = async (baseUrl, fetchImpl = fetch) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        // `/` 不需要令牌就能回应；这里只关心「这台机器在不在」，不读任何实体数据。
        const response = await fetchImpl(new URL('/', baseUrl), { signal: controller.signal });
        return response.ok || response.status === 401;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
};

export const restartUtmVm = async (vmName, execImpl = execFileAsync) => {
    try {
        await execImpl('/usr/bin/utmctl', ['stop', vmName], { timeout: 60_000 });
    } catch {
        // 已经停了或停不动都继续尝试启动：目标是「让它起来」，不是「让停止成功」。
    }
    try {
        await execImpl('/usr/bin/utmctl', ['start', vmName], { timeout: 60_000 });
        return { attempted: true, ok: true };
    } catch (error) {
        return { attempted: true, ok: false, error: String(error?.message || error).slice(0, 200) };
    }
};
