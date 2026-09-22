/**
 * 角色 API 凭据（设计 3.3）。
 *
 * 一个角色一条，按 cred_ref 存成 secrets/ 下的 600 文件——和 VAPID、apple-events-token
 * 同一套规矩（设计原文写的是 macOS 钥匙串；LaunchAgent 下访问登录钥匙串要解锁，
 * 常驻服务上不可靠，所以这里沿用已经在跑的 secrets/ 约定，权限检查照旧）。
 *
 * **只写不读**：接口永远不返回 apiKey，只回 baseUrl / model / 更新时间。写进来的 Key
 * 只有心跳调模型时在进程内用一次，不进日志、不进 /status、不进备份。
 */

import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readdirSync } from 'node:fs';

const PREFIX = 'cred.';
const SUFFIX = '.json';

/** ref 直接用来拼文件名，所以只允许最保守的一组字符。 */
export const isValidRef = ref => /^[A-Za-z0-9_-]{1,64}$/.test(String(ref || ''));

const pathFor = (config, ref) => join(config.secretsDir, `${PREFIX}${ref}${SUFFIX}`);

export const putCredential = (config, { ref, baseUrl, model, apiKey }, now = new Date()) => {
    if (!isValidRef(ref)) {
        throw Object.assign(new Error('ref 只能是字母、数字、下划线或减号'), { code: 'BAD_REQUEST', status: 400 });
    }
    if (!baseUrl || !model || !apiKey) {
        throw Object.assign(new Error('baseUrl、model、apiKey 都不能为空'), { code: 'BAD_REQUEST', status: 400 });
    }
    let parsed;
    try {
        parsed = new URL(String(baseUrl));
    } catch {
        throw Object.assign(new Error('baseUrl 不是合法地址'), { code: 'BAD_REQUEST', status: 400 });
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        throw Object.assign(new Error('baseUrl 必须是 https（本机地址除外）'), { code: 'BAD_REQUEST', status: 400 });
    }
    const path = pathFor(config, ref);
    const body = JSON.stringify({
        ref,
        baseUrl: String(baseUrl),
        model: String(model),
        apiKey: String(apiKey),
        updatedAt: now.toISOString(),
    });
    // 先建文件再收权限会留一个短暂的可读窗口，所以写之前就把 mode 定死。
    writeFileSync(path, body, { mode: 0o600 });
    chmodSync(path, 0o600);
    return { ref, baseUrl: String(baseUrl), model: String(model), updatedAt: now.toISOString() };
};

/** 给运行器用的完整读取（含 Key）。找不到返回 null，调用方据此报「没配凭据」。 */
export const readCredential = (config, ref) => {
    if (!isValidRef(ref)) return null;
    const path = pathFor(config, ref);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
};

/** 接口用的列表：永远不含 apiKey。 */
export const listCredentials = config => {
    let names = [];
    try {
        names = readdirSync(config.secretsDir);
    } catch {
        return [];
    }
    return names
        .filter(name => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
        .map(name => {
            try {
                const parsed = JSON.parse(readFileSync(join(config.secretsDir, name), 'utf8'));
                return {
                    ref: parsed.ref,
                    baseUrl: parsed.baseUrl,
                    model: parsed.model,
                    updatedAt: parsed.updatedAt,
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(a.ref).localeCompare(String(b.ref)));
};

export const deleteCredential = (config, ref) => {
    if (!isValidRef(ref)) return false;
    const path = pathFor(config, ref);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
};
