/**
 * Web Push：给每台登记过订阅的设备按一次门铃。
 *
 * VAPID 必须与 LiliumOS 站点现有的那一对完全一致（前端 utils/pushVapid.ts）。不一致的话
 * 前端的 dropStaleSubscription 会把订阅退掉重建，amsg 那条推送链会跟着断——这是 8-18
 * 那次事故的同款坑，别踩第二遍。
 *
 * `web-push` 是本服务唯一的外部依赖，而且是**可选**的：没装或没配 VAPID 时，推送整体降级，
 * 消息照常进信箱，前端打开时补收。推送坏掉不该让后端跟着停摆。
 */

import { readSecret } from './config.mjs';

/** 推送正文只放标题和短预览：Web Push 正文上限约 4KB，而且要经过 Apple / Google 的服务器。 */
const PREVIEW_LIMIT = 80;

let webPushModule;
const loadWebPush = async () => {
    if (webPushModule !== undefined) return webPushModule;
    try {
        webPushModule = (await import('web-push')).default;
    } catch {
        webPushModule = null;
    }
    return webPushModule;
};

export const loadVapid = config => {
    const publicKey = readSecret(config, 'vapid-public');
    const privateKey = readSecret(config, 'vapid-private');
    const subject = readSecret(config, 'vapid-subject') || 'mailto:liliumos@localhost';
    if (!publicKey || !privateKey) return null;
    return { publicKey, privateKey, subject };
};

export const createPusher = async config => {
    const vapid = loadVapid(config);
    const webPush = await loadWebPush();
    const ready = Boolean(vapid && webPush);
    if (ready) {
        webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    }
    return {
        ready,
        reason: !webPush ? 'web-push 未安装' : !vapid ? 'VAPID 密钥未配置' : null,
        /**
         * 给所有有效设备推一条。返回每台设备的结果，调用方负责写 deliveries。
         * 404 / 410 代表订阅已失效，把设备标成 gone，不再重复骚扰推送服务。
         */
        async send(db, { messageId, title, body, url }) {
            if (!ready) return [];
            const targets = db.prepare(
                `SELECT id, push_endpoint, push_p256dh, push_auth FROM devices
                  WHERE revoked_at IS NULL AND push_status = 'active' AND push_endpoint IS NOT NULL`,
            ).all();
            const payload = JSON.stringify({
                title,
                body: String(body || '').slice(0, PREVIEW_LIMIT),
                url: url || '/',
                messageId,
                source: 'agent-backend',
            });
            const results = [];
            for (const target of targets) {
                const subscription = {
                    endpoint: target.push_endpoint,
                    keys: { p256dh: target.push_p256dh, auth: target.push_auth },
                };
                try {
                    await webPush.sendNotification(subscription, payload);
                    results.push({ deviceId: target.id, status: 'sent', httpStatus: 201 });
                } catch (error) {
                    const httpStatus = Number(error?.statusCode) || null;
                    const gone = httpStatus === 404 || httpStatus === 410;
                    if (gone) {
                        db.prepare("UPDATE devices SET push_status = 'gone' WHERE id = ?").run(target.id);
                    }
                    results.push({ deviceId: target.id, status: gone ? 'gone' : 'failed', httpStatus });
                }
            }
            return results;
        },
    };
};

export const recordDeliveries = (db, messageId, results, now = new Date()) => {
    const statement = db.prepare(
        `INSERT INTO deliveries (message_id, device_id, status, http_status, attempted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(message_id, device_id) DO UPDATE SET
           status = excluded.status,
           http_status = excluded.http_status,
           attempted_at = excluded.attempted_at`,
    );
    for (const result of results) {
        statement.run(messageId, result.deviceId, result.status, result.httpStatus, now.toISOString());
    }
};
