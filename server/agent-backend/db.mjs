/**
 * SQLite 打开与迁移。表结构契约见 docs/agent-backend-design.md 第 2 节。
 *
 * 迁移只增不改：每条迁移一个编号，按 `PRAGMA user_version` 顺序跑。已经发过的迁移永远
 * 不许改写——mini 上那份库已经按旧语句建好了，改了只会让两台机器的库长得不一样。
 */

import { DatabaseSync } from 'node:sqlite';

/** 每条迁移是一段 SQL；数组下标 + 1 就是它的 user_version。 */
export const MIGRATIONS = [
    // 1：Phase 1a/1b —— 设备、配对、角色、快照、任务、信箱。
    `
    CREATE TABLE devices (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      token_hash      TEXT NOT NULL UNIQUE,
      push_endpoint   TEXT,
      push_p256dh     TEXT,
      push_auth       TEXT,
      push_status     TEXT NOT NULL DEFAULT 'none'
                      CHECK (push_status IN ('none','active','gone')),
      created_at      TEXT NOT NULL,
      last_seen_at    TEXT,
      revoked_at      TEXT
    );

    CREATE TABLE pairing_codes (
      code_hash   TEXT PRIMARY KEY,
      expires_at  TEXT NOT NULL,
      used_at     TEXT
    );

    CREATE TABLE characters (
      char_id                  TEXT PRIMARY KEY,
      display_name             TEXT NOT NULL,
      runtime                  TEXT NOT NULL DEFAULT 'api' CHECK (runtime IN ('codex','api')),
      cred_ref                 TEXT,
      heartbeat_enabled        INTEGER NOT NULL DEFAULT 0,
      heartbeat_every_min      INTEGER NOT NULL DEFAULT 90
                               CHECK (heartbeat_every_min BETWEEN 30 AND 480),
      heartbeat_generation     INTEGER NOT NULL DEFAULT 0,
      daily_model_budget       INTEGER NOT NULL DEFAULT 12,
      message_cooldown_min     INTEGER NOT NULL DEFAULT 90,
      last_user_interaction_at TEXT,
      heartbeat_paused         TEXT,
      heartbeat_paused_at      TEXT,
      updated_at               TEXT NOT NULL
    );

    CREATE TABLE char_snapshots (
      char_id        TEXT PRIMARY KEY REFERENCES characters(char_id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL,
      built_at       TEXT NOT NULL,
      payload        TEXT NOT NULL,
      source_device  TEXT REFERENCES devices(id),
      received_at    TEXT NOT NULL
    );

    CREATE TABLE jobs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid            TEXT NOT NULL UNIQUE,
      kind            TEXT NOT NULL,
      char_id         TEXT REFERENCES characters(char_id) ON DELETE CASCADE,
      run_at          TEXT NOT NULL,
      expires_at      TEXT,
      missed_policy   TEXT NOT NULL DEFAULT 'catch_up'
                      CHECK (missed_policy IN ('drop','catch_up')),
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','done','failed','cancelled','expired')),
      lease_until     TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      max_attempts    INTEGER NOT NULL DEFAULT 3,
      retry_after     TEXT,
      serialize_group TEXT,
      generation      INTEGER,
      input           TEXT NOT NULL DEFAULT '{}',
      result          TEXT,
      last_error      TEXT,
      created_by      TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX idx_jobs_due ON jobs (status, run_at) WHERE status = 'pending';
    CREATE INDEX idx_jobs_char ON jobs (char_id, status);

    CREATE TABLE outbox (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id  TEXT NOT NULL UNIQUE,
      char_id     TEXT,
      job_uuid    TEXT,
      kind        TEXT NOT NULL CHECK (kind IN ('chat_message','job_result','system_notice')),
      payload     TEXT NOT NULL,
      notify      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      acked_at    TEXT,
      acked_by    TEXT REFERENCES devices(id)
    );
    CREATE INDEX idx_outbox_unacked ON outbox (id) WHERE acked_at IS NULL;

    CREATE TABLE deliveries (
      message_id   TEXT NOT NULL REFERENCES outbox(message_id) ON DELETE CASCADE,
      device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      status       TEXT NOT NULL CHECK (status IN ('sent','failed','gone')),
      http_status  INTEGER,
      attempted_at TEXT NOT NULL,
      PRIMARY KEY (message_id, device_id)
    );

    CREATE TABLE settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE notices (
      key         TEXT PRIMARY KEY,
      notified_at TEXT NOT NULL
    );
    `,
    // 2：Phase 1c —— 心跳的动脑记录。影子期只往这里写，不写 outbox、不推送（设计 4.3 第 9 步）。
    `
    CREATE TABLE model_runs (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      job_uuid              TEXT,
      char_id               TEXT NOT NULL,
      runtime               TEXT NOT NULL CHECK (runtime IN ('codex','api')),
      started_at            TEXT NOT NULL,
      duration_ms           INTEGER,
      ok                    INTEGER NOT NULL,
      outcome               TEXT,
      shadow                INTEGER NOT NULL DEFAULT 0,
      reason                TEXT,
      proposed_text         TEXT,
      proposed_tool         TEXT,
      proposed_args_summary TEXT,
      skip_gate             TEXT,
      error                 TEXT
    );
    CREATE INDEX idx_model_runs_day ON model_runs (char_id, started_at);
    `,
    // 3：起居注要的那句「我这次做了什么」，以及排查用的原始输出。
    `
    ALTER TABLE model_runs ADD COLUMN activity TEXT;
    ALTER TABLE model_runs ADD COLUMN raw_output TEXT;
    `,
    // 4：这一跳「本来打算」做什么。抽签定的意图和模型最后给的结果要能对上账，
    // 否则没法知道角色是真没话说，还是抽中了开口却又自己缩回去。
    `
    ALTER TABLE model_runs ADD COLUMN intent TEXT;
    `,
    // 5：TA 这一跳有没有「想找对方」的念头。模型最爱的托词是「等会儿再说」，
    // 这个念头由程序记下来、下一跳兑现，否则「等会儿」永远不会来。
    `
    ALTER TABLE model_runs ADD COLUMN urge TEXT;
    `,
    // 6：工作 App 的「正在推进的事」，以及每一跳产出的那段工作往来（审计用，前端拿到的副本在 outbox 里）。
    `
    CREATE TABLE life_threads (
      id          TEXT PRIMARY KEY,
      char_id     TEXT NOT NULL REFERENCES characters(char_id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      summary     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX idx_life_threads_open ON life_threads (char_id, status, updated_at);
    ALTER TABLE model_runs ADD COLUMN episode TEXT;
    `,
    // 7：阿萌的现实时间（Apple 日历 / 提醒）。只存一个窗口的缓存，原件永远在 Apple 那边；
    // 每次同步整表重写，所以不留历史、也不用对账（设计 temporal.mjs 开头）。
    `
    CREATE TABLE temporal_items (
      source_id   TEXT PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('event','reminder')),
      source      TEXT NOT NULL,
      title       TEXT NOT NULL,
      start_at    TEXT,
      end_at      TEXT,
      all_day     INTEGER NOT NULL DEFAULT 0,
      due_at      TEXT,
      completed   INTEGER NOT NULL DEFAULT 0,
      priority    TEXT,
      location    TEXT,
      repeats     TEXT,
      fetched_at  TEXT NOT NULL
    );
    CREATE INDEX idx_temporal_when ON temporal_items (start_at, due_at);
    `,
];

export const DEFAULT_SETTINGS = {
    timezone: 'America/Chicago',
    quiet_start: '00:00',
    quiet_end: '07:00',
    // 看门狗：连续 3 次检查不通过才重启虚拟机，重启后仍不通只通知一次。
    ha_watchdog: JSON.stringify({ enabled: true, failuresBeforeRestart: 3, everyMin: 5 }),
    // 影子运行（1c）：心跳照常判断、照常调模型，但不发消息、不执行工具，只记 model_runs。
    // 关掉它就是 1d 的真实执行，所以默认必须是开着的——忘了关比忘了开危险得多。
    heartbeat_shadow: JSON.stringify({ enabled: true }),
    // 排查开关：打开后，解析失败时把模型的原始输出截一段存进 model_runs.raw_output。
    // 原始输出里有角色的话，只留在 mini 的库里、不进日志，查完记得关。
    heartbeat_debug: JSON.stringify({ captureRawOnError: false }),
    // 阿萌的现实时间：逐个日历 / 提醒清单设可见性，默认什么都不给看。
    // 空 = 一个都没开，同步任务什么都不读，角色也就什么都不知道。
    temporal_visibility: JSON.stringify({ calendars: {}, lists: {} }),
    // 每天同步一次就够（课表本来就固定）；改了日历自己点「立刻刷新」。
    temporal_sync: JSON.stringify({ everyHours: 24 }),
};

export const openDb = (path, { now = () => new Date().toISOString() } = {}) => {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
    seedSettings(db, now());
    return db;
};

export const migrate = db => {
    const current = db.prepare('PRAGMA user_version').get().user_version ?? 0;
    for (let version = current; version < MIGRATIONS.length; version += 1) {
        db.exec('BEGIN');
        try {
            db.exec(MIGRATIONS[version]);
            // user_version 不接受占位符，只能拼字符串；version 来自本文件的循环下标，不是外部输入。
            db.exec(`PRAGMA user_version = ${version + 1}`);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw new Error(`迁移 ${version + 1} 失败：${error.message}`);
        }
    }
};

const seedSettings = (db, now) => {
    const insert = db.prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
    );
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value, now);
};

export const getSetting = (db, key) =>
    db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;

export const setSetting = (db, key, value, now = new Date().toISOString()) => {
    db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value, now);
};

/**
 * 同一个原因在恢复前只通知一次。返回 true 表示「这次该通知」。
 * 恢复时调用 clearNotice 把记号清掉，下次再出问题才会重新通知。
 */
export const shouldNotice = (db, key, now = new Date().toISOString()) => {
    const existing = db.prepare('SELECT notified_at FROM notices WHERE key = ?').get(key);
    if (existing) return false;
    db.prepare('INSERT INTO notices (key, notified_at) VALUES (?, ?)').run(key, now);
    return true;
};

export const clearNotice = (db, key) => {
    db.prepare('DELETE FROM notices WHERE key = ?').run(key);
};
