#!/usr/bin/env node
/**
 * 本机运维命令。只在 Mac mini 的终端上用，不对外暴露。
 *
 *   node server/agent-backend/cli.mjs pair        生成 6 位配对码
 *   node server/agent-backend/cli.mjs devices     列出设备
 *   node server/agent-backend/cli.mjs ping        排一个连通测试任务
 *   node server/agent-backend/cli.mjs vapid       生成一对 VAPID 密钥（仅在还没有时用）
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDataDir, loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { createPairingCode, listDevices } from './devices.mjs';
import { createJob } from './jobs.mjs';

const config = loadConfig();
ensureDataDir(config);
const command = process.argv[2] || 'help';

if (command === 'pair') {
    const db = openDb(config.dbPath);
    const { code, expiresAt } = createPairingCode(db);
    console.log(`\n  配对码：${code}\n  有效至：${expiresAt}（10 分钟，只能用一次）\n`);
} else if (command === 'devices') {
    const db = openDb(config.dbPath);
    const devices = listDevices(db);
    if (devices.length === 0) console.log('还没有配对过任何设备。');
    for (const device of devices) {
        console.log(
            `${device.revokedAt ? '✗' : '✓'} ${device.name}  推送:${device.pushStatus}  ` +
            `最近在线:${device.lastSeenAt || '—'}  id:${device.id}`,
        );
    }
} else if (command === 'ping') {
    const db = openDb(config.dbPath);
    const { job } = createJob(db, {
        kind: 'test.ping',
        runAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        createdBy: 'cli',
    });
    console.log(`已排入连通测试任务：${job.uuid}（最多 15 秒后执行）`);
} else if (command === 'vapid') {
    // 只有在阿萌还没有站点 VAPID 时才用它生成；已经有了就把现成的那对写进 secrets，
    // 两边必须是同一对，否则前端会把订阅退掉重建，amsg 的推送会跟着断。
    const webPush = (await import('web-push')).default;
    const keys = webPush.generateVAPIDKeys();
    writeFileSync(join(config.secretsDir, 'vapid-public'), `${keys.publicKey}\n`, { mode: 0o600 });
    writeFileSync(join(config.secretsDir, 'vapid-private'), `${keys.privateKey}\n`, { mode: 0o600 });
    console.log('已写入 secrets/vapid-public 与 secrets/vapid-private。');
    console.log(`公钥（要填回 LiliumOS 的推送凭据面板）：\n${keys.publicKey}`);
} else {
    console.log(`用法：
  node server/agent-backend/cli.mjs pair      生成配对码
  node server/agent-backend/cli.mjs devices   列出设备
  node server/agent-backend/cli.mjs ping      排一个连通测试任务
  node server/agent-backend/cli.mjs vapid     生成 VAPID 密钥（仅在还没有时）`);
}
