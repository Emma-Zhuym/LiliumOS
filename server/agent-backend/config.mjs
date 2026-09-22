/**
 * 运行配置：路径、端口、外部依赖地址、密钥读取。
 *
 * 密钥一律从 `<dataDir>/secrets/<name>` 读取权限受限的文件，与 apple-events-bridge 同一套做法。
 * 不从环境变量读密钥（LaunchAgent 的 plist 会被备份工具抓走），也绝不写进日志或响应。
 */

import { existsSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_DIR = join(
    homedir(),
    'Library',
    'Application Support',
    'LiliumOS',
    'agent-backend',
);

const num = (raw, fallback) => {
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const list = (raw, fallback) => String(raw ?? fallback)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

export const loadConfig = (env = process.env) => {
    const dataDir = env.AGENT_BACKEND_DIR || DEFAULT_DIR;
    const secretsDir = join(dataDir, 'secrets');
    return {
        dataDir,
        secretsDir,
        dbPath: env.AGENT_BACKEND_DB || join(dataDir, 'agent.db'),
        host: env.AGENT_BACKEND_HOST || '127.0.0.1',
        port: num(env.AGENT_BACKEND_PORT, 8790),
        // 只允许正式站点和本地开发源；代理层还有一道同样的闸。
        allowedOrigins: list(
            env.AGENT_BACKEND_ORIGINS,
            'https://emma-zhuym.github.io,http://localhost:5173,http://127.0.0.1:5173',
        ),
        appleEventsUrl: env.AGENT_APPLE_EVENTS_URL || 'http://127.0.0.1:8765/mcp',
        // mini 上的 HAOS 在 80 端口（8123 不通），与 scripts/home-assistant-proxy.mjs 的默认目标一致。
        homeAssistantUrl: env.AGENT_HA_URL || 'http://192.168.64.2',
        // 看门狗要重启的 UTM 虚拟机名；留空则只检查不重启。
        utmVmName: env.AGENT_UTM_VM || '',
        // utmctl 在 App 包里，不在 PATH 上；/usr/bin 受 SIP 保护也放不进去。
        utmctlPath: env.AGENT_UTMCTL || '/Applications/UTM.app/Contents/MacOS/utmctl',
        version: '0.1.0',
        apiVersion: 1,
    };
};

/**
 * 读一个密钥文件。缺文件返回 null（调用方据此把对应能力标成不可用），
 * 权限比 600 松则直接拒绝启动——密钥躺在别人读得到的地方比没有更危险。
 */
export const readSecret = (config, name) => {
    const path = join(config.secretsDir, name);
    if (!existsSync(path)) return null;
    const mode = statSync(path).mode & 0o077;
    if (mode !== 0) {
        throw new Error(`密钥文件权限过松：${path}（应为 600，执行 chmod 600 后重试）`);
    }
    const value = readFileSync(path, 'utf8').trim();
    return value || null;
};

export const ensureDataDir = config => {
    mkdirSync(config.dataDir, { recursive: true });
    mkdirSync(config.secretsDir, { recursive: true, mode: 0o700 });
    mkdirSync(join(config.dataDir, 'logs'), { recursive: true });
};
