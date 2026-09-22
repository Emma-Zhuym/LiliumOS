# LiliumOS Agent Backend · 接口与数据表设计（草案 v0.1）

> 状态：设计草案，未实施
>
> 日期：2026-09-22
>
> 前置文档：[`agent-backend-phase0-audit.md`](./agent-backend-phase0-audit.md)（为什么是纯 Mac mini、2.1 的硬性约束）
>
> 读法：每节先有一段「🐾 小帕讲人话」给阿萌，后面是给实现者（Claude / Codex）看的规格。两部分说的是同一件事。

---

## 0. 全局图

> 🐾 **小帕讲人话**
>
> 把后端想成住在 Mac mini 里的一个**管家**。
>
> - **门口**：手机和电脑要找管家，得先经过 Tailscale 那扇门（已经有了），门口的分流台看到网址是 `/agent/...` 开头，就把你领到管家这里。
> - **钥匙**：每台设备第一次来要「配对」，管家发一把专属钥匙。以后每次来都出示钥匙；哪台设备丢了，就只作废那一把。
> - **笔记本**：管家有一个本子（SQLite 数据库），记着：有哪些设备、每个角色的近况、待办任务、要给你的消息。
> - **闹钟**：管家每 15 秒看一眼本子上有没有到点的任务，有就去做。凌晨 4–7 点 Mac mini 睡觉，管家也睡。
> - **信箱**：管家做完事要告诉你，就把消息放进信箱（outbox），再按门铃（推送）。门铃没响也没关系，你下次打开 LiliumOS 会自己去信箱取。

```text
LiliumOS（手机 / 电脑 / 平板）
   │ HTTPS  Authorization: Bearer <设备钥匙>
   ▼
Tailscale Funnel → home-assistant-proxy.mjs（:18123）
   ├─ /api/*    → Home Assistant 虚拟机
   ├─ /mcp      → apple-events-bridge（:8765）
   └─ /agent/*  → agent-backend（:8790）   ← 新增一条路由
                    │
                    ├─ SQLite：~/Library/Application Support/LiliumOS/agent-backend/agent.db
                    ├─ 钥匙串：API Key、VAPID 私钥
                    ├─ 调度器（15s 一轮）
                    ├─ 模型：codex exec（Elias）/ 角色 API
                    ├─ 工具：apple-events-bridge、HA MCP（本机直连，不绕 Funnel）
                    └─ 推送：web-push → 每台设备
```

**硬性约束**（来自审计 2.1）：

1. 与 amsg 不共享任何表、协议或版本号；amsg 一行不改。
2. 多设备推送由本服务自己管，outbox 是送达保证，推送只是提醒。
3. 本服务挂掉或休眠时，LiliumOS 聊天和 amsg 主动消息不受任何影响。
4. 前端按 `GET /agent/v1/status` 报告的实际能力判断功能是否可用，不看「部署成功」之类的提示。

---

## 1. 通用约定

> 🐾 **小帕讲人话**
>
> 「接口」就是管家能听懂的**固定句式**。比如「POST /agent/v1/jobs」意思是「我要交给你一件新任务」，后面附一张填好的表格（JSON）。句式固定，前端和后端才能对上话。
>
> 这里还定了几条规矩：所有句式都以 `/agent/v1` 开头，`v1` 是版本号，以后改了句式就叫 `v2`，旧的前端还能继续用 `v1`，不会一升级就全挂——8 月心跳就吃过版本对不上的亏。

- 前缀：`/agent/v1`。只用 `GET` 与 `POST`（现有代理只放行这两种，见 `scripts/home-assistant-proxy.mjs`）。
- 鉴权：除 `GET /agent/v1/health` 与 `POST /agent/v1/pair` 外，一律要求 `Authorization: Bearer <deviceToken>`。服务端只存 token 的 SHA-256。
- 请求 / 响应体：JSON，UTF-8。成功 `{ "ok": true, "data": … }`；失败 `{ "ok": false, "error": { "code": "SNAKE_CASE", "message": "中文说明" } }`。
- 时间：一律 ISO-8601 UTC 字符串（`2026-09-22T14:03:00.000Z`）；「几点安静」这类本地时间规则存 IANA 时区（`America/Chicago`），不存偏移量。
- ID：客户端生成的一律 UUID v4（任务 `uuid`、消息 `messageId`），服务端以唯一约束做幂等。
- 请求体上限 256 KB；超出回 `413 PAYLOAD_TOO_LARGE`。
- CORS 与现有代理一致：只允许 `https://emma-zhuym.github.io` 与本地开发源。
- 日志不记录请求体、Authorization、API Key、聊天正文；只记路由、状态码、耗时、任务 uuid。

---

## 2. 数据表（SQLite）

> 🐾 **小帕讲人话**
>
> 数据表就是管家本子里的**分页**，每一页是一张表格，每一行是一条记录。下面每张表我都先说它记什么，你看个大概就行。
>
> 有两个词会反复出现：
>
> - **租约（lease）**：管家开始做某个任务时，在那一行写上「我在做，X 点前别碰」。如果管家做到一半突然断电，过了 X 点这行就自动「解锁」，重启后能重新接手，不会卡死，也不会被做两遍。这招是从 amsg 抄来的。
> - **幂等（idempotent）**：同一件事说两遍，结果和说一遍一样。每个任务、每条消息都有独一无二的编号，重复提交时管家一看编号已经有了，就不会再建一份。网不好时前端重发请求也不怕。

启用：`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`

表结构版本存在 `PRAGMA user_version`，启动时按序跑迁移。

### 2.1 `devices` — 已配对的设备

> 🐾 每台手机 / 电脑一行，记着它的钥匙（只存钥匙的「指纹」，不存钥匙本身）和它的门铃地址（推送订阅）。这就是审计里说的「多设备推送」：手机和电脑各一行，谁也不会把谁顶掉。

```sql
CREATE TABLE devices (
  id              TEXT PRIMARY KEY,           -- UUID
  name            TEXT NOT NULL,              -- 「阿萌的 iPhone」
  token_hash      TEXT NOT NULL UNIQUE,       -- SHA-256(deviceToken)
  push_endpoint   TEXT,                       -- Web Push 订阅，可为空（没开通知）
  push_p256dh     TEXT,
  push_auth       TEXT,
  push_status     TEXT NOT NULL DEFAULT 'none'
                  CHECK (push_status IN ('none','active','gone')),
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT,
  revoked_at      TEXT                        -- 非空即作废
);
```

### 2.2 `pairing_codes` — 一次性配对码

> 🐾 新设备第一次来，你在 Mac mini 上运行一条命令，屏幕上出现 6 位配对码（10 分钟有效、只能用一次），在手机上输进去，手机就拿到钥匙了。

```sql
CREATE TABLE pairing_codes (
  code_hash   TEXT PRIMARY KEY,               -- SHA-256(6 位码)
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
```

### 2.3 `characters` — 角色在后端的设置

> 🐾 每个角色一行：用哪种「大脑」（Elias 用 Codex，其他人用各自的 API）、心跳开没开、多久醒一次、一天最多动几次脑子。

```sql
CREATE TABLE characters (
  char_id               TEXT PRIMARY KEY,     -- 与 LiliumOS CharacterProfile.id 一致
  display_name          TEXT NOT NULL,
  runtime               TEXT NOT NULL CHECK (runtime IN ('codex','api')),
  cred_ref              TEXT,                 -- runtime='api' 时指向钥匙串条目
  heartbeat_enabled     INTEGER NOT NULL DEFAULT 0,
  heartbeat_every_min   INTEGER NOT NULL DEFAULT 60 CHECK (heartbeat_every_min BETWEEN 30 AND 480),
  heartbeat_generation  INTEGER NOT NULL DEFAULT 0,   -- 关闭/改频率时 +1，旧链自动作废
  daily_model_budget    INTEGER NOT NULL DEFAULT 12,  -- 每天最多调用模型次数
  message_cooldown_min  INTEGER NOT NULL DEFAULT 90,  -- 两次主动消息的最小间隔
  updated_at            TEXT NOT NULL
);
```

`runtime='codex'` 在 Phase 1 只允许一个角色（Elias），由服务端配置白名单强制，不靠前端自觉。

### 2.4 `char_snapshots` — 角色近况快照

> 🐾 管家不会翻你浏览器里的聊天记录（那些只在你设备上）。所以前端每次聊完，会给管家寄一份「近况摘要」：角色是谁、最近聊了什么、今天日程、几点睡觉。管家醒来要替角色想事情，就看这份。
>
> 如果两台设备都寄了，**只留更新的那份**；旧设备晚到的旧快照会被拒收，不会盖掉新的。

```sql
CREATE TABLE char_snapshots (
  char_id        TEXT PRIMARY KEY REFERENCES characters(char_id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,            -- 快照格式版本，见 3.4
  built_at       TEXT NOT NULL,               -- 前端生成这份快照的时刻
  payload        TEXT NOT NULL,               -- JSON，见 3.4
  source_device  TEXT REFERENCES devices(id),
  received_at    TEXT NOT NULL
);
```

写入规则：`built_at` 早于库里已有的 → 拒收（`409 STALE_SNAPSHOT`）。

### 2.5 `jobs` — 任务队列（核心）

> 🐾 这是管家的**待办清单**。每行一件事：什么类型、替哪个角色做、几点做、现在是什么状态。
>
> 状态会这样走：`pending`（等着）→ `running`（在做）→ `done`（做完）/ `failed`（失败了）。另外还有 `cancelled`（你取消了）和 `expired`（错过了、也不补了）。
>
> 「过期怎么办」每个任务自己说了算：心跳是 `drop`，错过就算了；你交代的事是 `catch_up`，在截止时间前醒来就补做。这样早上 7 点不会突然弹一串消息。

```sql
CREATE TABLE jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid            TEXT NOT NULL UNIQUE,       -- 幂等键（客户端或服务端生成）
  kind            TEXT NOT NULL,              -- 见 4 节任务种类
  char_id         TEXT REFERENCES characters(char_id) ON DELETE CASCADE,
  run_at          TEXT NOT NULL,
  expires_at      TEXT,                       -- 过了这个点就不再执行
  missed_policy   TEXT NOT NULL CHECK (missed_policy IN ('drop','catch_up')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','done','failed','cancelled','expired')),
  lease_until     TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  retry_after     TEXT,
  serialize_group TEXT,                       -- 默认 `${char_id}#${kind}`
  generation      INTEGER,                    -- 心跳用：与 characters.heartbeat_generation 比对
  input           TEXT NOT NULL DEFAULT '{}', -- JSON
  result          TEXT,                       -- JSON，脱敏摘要
  last_error      TEXT,                       -- 脱敏摘要
  created_by      TEXT NOT NULL,              -- 'device:<id>' | 'scheduler' | 'cli'
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_jobs_due ON jobs (status, run_at) WHERE status = 'pending';
CREATE INDEX idx_jobs_char ON jobs (char_id, status);
```

领取（照抄 amsg，单进程也照做，保证崩溃恢复）：

```sql
UPDATE jobs
   SET status = 'running', lease_until = :lease, attempts = attempts + 1, updated_at = :now
 WHERE id = :id AND status = 'pending' AND run_at = :expected_run_at
   AND (retry_after IS NULL OR retry_after <= :now)
   AND NOT EXISTS (SELECT 1 FROM jobs b
                    WHERE b.serialize_group = :group AND b.id <> :id
                      AND b.status = 'running' AND b.lease_until > :now);
```

`changes = 1` 才算领到。执行中每 30s 续租到 `now + 90s`。启动时把 `status='running' AND lease_until < now` 的行放回 `pending`。

### 2.6 `outbox` 与 `deliveries` — 信箱与门铃记录

> 🐾 管家要告诉你的每一句话，先放进信箱（`outbox`），再给每台设备按一次门铃，按的结果记在 `deliveries`。
>
> 你打开 LiliumOS 时，前端会问：「信箱里有我还没拿的吗？」拿到之后回一句「收到了」（ack），这条才算送达。所以就算门铃全坏了，消息也不会丢。

```sql
CREATE TABLE outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- 前端用它做翻页游标
  message_id  TEXT NOT NULL UNIQUE,               -- UUID，前端据此去重写入聊天
  char_id     TEXT,
  job_uuid    TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('chat_message','job_result','system_notice')),
  payload     TEXT NOT NULL,                      -- JSON，见 3.6
  notify      INTEGER NOT NULL DEFAULT 1,         -- 0 = 只进信箱，不按门铃
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
```

一条消息被**任意一台**设备 ack 即视为送达（聊天记录会在设备间经 LiliumOS 自己的同步 / 备份流转，不在本服务范围）。推送返回 404 / 410 → 该设备 `push_status='gone'`。保留期：已 ack 7 天、全部 28 天（与 amsg 一致）。

### 2.7 `tool_policies` 与 `tool_audit` — 工具白名单与操作记录

> 🐾 **白名单**：每个角色能用哪些工具、能用到什么程度，三档：只能在你看着的时候用（`foreground-only`）、后台可以查（`background-read`）、后台可以写（`background-write`）。没写进白名单的工具，管家一律当作「只能前台用」。
>
> **操作记录**：角色在后台每用一次工具，都记一笔：谁、用了什么、结果如何。以后你想知道「Elias 半夜到底干了啥」，翻这里就行。

```sql
CREATE TABLE tool_policies (
  char_id    TEXT NOT NULL REFERENCES characters(char_id) ON DELETE CASCADE,
  tool_name  TEXT NOT NULL,                   -- 形如 'apple-events/reminders_create'
  level      TEXT NOT NULL CHECK (level IN ('foreground-only','background-read','background-write')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (char_id, tool_name)
);

CREATE TABLE tool_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_uuid        TEXT,
  char_id         TEXT,
  tool_name       TEXT NOT NULL,
  level_used      TEXT NOT NULL,
  args_summary    TEXT,                       -- 截断、去敏，不含 token / 坐标
  result_summary  TEXT,
  ok              INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);
```

服务端硬编码的**永不后台写**名单（优先级高于 `tool_policies`）：删除类、Home Assistant 设备控制、发帖 / 评论、任何支付与转账。

### 2.8 `model_runs` — 动脑记录（用于预算）

> 🐾 每次角色「动脑子」（调一次模型）记一行。管家靠它数「今天 Elias 已经想了几次」，超过每日预算就不再叫醒他。

```sql
CREATE TABLE model_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_uuid     TEXT,
  char_id      TEXT NOT NULL,
  runtime      TEXT NOT NULL CHECK (runtime IN ('codex','api')),
  started_at   TEXT NOT NULL,
  duration_ms  INTEGER,
  ok           INTEGER NOT NULL,
  outcome      TEXT,                          -- 'noop' | 'message' | 'task' | 'error'
  error        TEXT
);
CREATE INDEX idx_model_runs_day ON model_runs (char_id, started_at);
```

### 2.9 `settings` — 全局设置

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
```

初始键：`timezone`（`America/Chicago`）、`quiet_start`（`04:00`）、`quiet_end`（`07:00`）、`ha_watchdog`（`{"enabled":true,"vm":"Home Assistant","failuresBeforeRestart":3}`）。

---

## 3. 接口

> 🐾 **小帕讲人话**
>
> 下面是管家能听懂的全部句式。你不用记，只要知道它们分成几组：
>
> 1. **打招呼**：管家还活着吗、身体怎么样（health / status）
> 2. **配对与设备**：领钥匙、登记门铃、作废丢了的设备
> 3. **角色**：更新角色设置、寄近况快照、存 API Key
> 4. **任务**：交代新任务、查任务、取消任务
> 5. **信箱**：取消息、回「收到了」
> 6. **白名单与记录**：改工具权限、翻操作记录

### 3.1 健康

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/agent/v1/health` | 无 | `{ ok, version }`，只证明进程活着，不带任何数据 |
| GET | `/agent/v1/status` | 设备 | 各依赖的真实状态，前端设置页据此显示 |

`status` 响应：

```json
{
  "ok": true,
  "data": {
    "version": "0.1.0",
    "apiVersion": 1,
    "now": "2026-09-22T14:03:00.000Z",
    "quiet": { "active": false, "start": "04:00", "end": "07:00", "timezone": "America/Chicago" },
    "deps": {
      "codex":        { "ok": true,  "detail": "logged-in:chatgpt" },
      "appleEvents":  { "ok": true },
      "homeAssistant":{ "ok": false, "detail": "vm-unreachable", "lastRestartAt": "…" },
      "push":         { "ok": true,  "activeDevices": 2 }
    },
    "capabilities": ["jobs", "outbox", "heartbeat"]
  }
}
```

`capabilities` 是前端判断功能可用的唯一依据（约束 4）。

### 3.2 配对与设备

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/agent/v1/pair` | `{ code, deviceName }` → `{ deviceId, deviceToken }`。码错 5 次锁 15 分钟 |
| POST | `/agent/v1/devices/push` | 登记 / 更新本设备的推送订阅 `{ endpoint, keys: { p256dh, auth } }` |
| GET  | `/agent/v1/devices` | 列出设备（不含 token、不含完整 endpoint） |
| POST | `/agent/v1/devices/revoke` | `{ deviceId }`；不能作废最后一台仍有效的设备（否则就没人能再配对管理了，只能回 mini 上用 CLI） |

配对码由 mini 本机 CLI 生成：`node server/agent-backend/cli.mjs pair`，只在终端显示。

**VAPID**：必须与 LiliumOS 现有 `utils/pushVapid.ts` 中配置的是同一对，公钥在前端已有，私钥由阿萌在 mini 上一次性写入钥匙串。否则前端 `dropStaleSubscription` 会把订阅换掉，amsg 的推送就断了。

### 3.3 角色设置与凭据

| 方法 | 路径 | 作用 |
|---|---|---|
| GET  | `/agent/v1/characters` | 列出所有角色设置 |
| POST | `/agent/v1/characters/upsert` | 新建或更新一个角色的设置（字段见 2.3）|
| POST | `/agent/v1/credentials/put` | `{ ref, baseUrl, model, apiKey }` → 写入钥匙串，**只写不读** |
| GET  | `/agent/v1/credentials` | 只返回 `[{ ref, baseUrl, model, updatedAt }]`，永不返回 Key |

开启心跳（`heartbeat_enabled` 0→1）或改 `heartbeat_every_min` 时，服务端把 `heartbeat_generation` +1，并在约 3 分钟后排第一跳。旧代次的心跳任务到点发现代次不符，直接 `cancelled`。

### 3.4 近况快照

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/agent/v1/characters/snapshot` | 上传一个角色的快照 |

```json
{
  "charId": "elias",
  "schemaVersion": 1,
  "builtAt": "2026-09-22T14:00:00.000Z",
  "payload": {
    "identity":   { "name": "Elias", "persona": "……角色设定正文……" },
    "user":       { "name": "阿萌" },
    "timezone":   "America/Chicago",
    "sleepWindow": { "start": "00:30", "end": "08:00" },
    "todaySchedule": [ { "start": "09:00", "end": "11:00", "title": "……", "availability": "busy" } ],
    "recentMessages": [ { "role": "user", "at": "…", "text": "……" } ],
    "openThreads": [ "答应周末一起看展" ]
  }
}
```

- `recentMessages` 最多 30 条，每条截断到 500 字；图片、语音只留占位描述。
- 触发时机：每轮聊天结束后 30s 防抖上传；打开 App 时补传一次。
- 快照只是「最近的样子」，**不是记忆**。长期记忆、Continuity State 的确认流程在 Phase 2 另开文档。

### 3.5 任务

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/agent/v1/jobs` | 建任务 `{ uuid, kind, charId?, runAt, expiresAt?, missedPolicy?, input }`；`uuid` 已存在 → 原样返回已有任务（幂等） |
| GET  | `/agent/v1/jobs?status=pending&charId=…&limit=50` | 查任务 |
| POST | `/agent/v1/jobs/cancel` | `{ uuid }`；`running` 的任务标记取消，执行完的结果丢弃不投递 |

心跳任务只由服务端的调度器自己建（`created_by='scheduler'`），前端不能直接建 `heartbeat` 种类。

### 3.6 信箱

| 方法 | 路径 | 作用 |
|---|---|---|
| GET  | `/agent/v1/outbox?after=<id>&limit=50` | 取未 ack 的消息，按 `id` 升序 |
| POST | `/agent/v1/outbox/ack` | `{ messageIds: [...] }` |

`chat_message` 的 payload：

```json
{
  "charId": "elias",
  "text": "……",
  "createdAt": "2026-09-22T14:05:00.000Z",
  "source": "heartbeat",
  "jobUuid": "…"
}
```

前端写入聊天时用 `messageId` 去重，`metadata.source = 'agent-backend'`，与 amsg 来源的消息区分。

推送内容只放标题和不超过 80 字的预览，完整正文走 outbox（Web Push 正文上限约 4 KB，而且推送内容会经过 Apple / Google 的服务器）。

### 3.7 白名单与记录

| 方法 | 路径 | 作用 |
|---|---|---|
| GET  | `/agent/v1/tools` | 当前可发现的工具清单 + 每个角色的档位 |
| POST | `/agent/v1/tools/policy` | `{ charId, toolName, level }` |
| GET  | `/agent/v1/audit?charId=…&limit=100` | 工具操作记录 + 动脑记录 |

---

## 4. 调度器与任务种类

> 🐾 **小帕讲人话**
>
> 管家的一轮巡逻（每 15 秒）：
>
> 1. 现在是不是 4–7 点？是就什么都不做。
> 2. 翻待办清单，找出到点的任务。
> 3. 每件任务先问：是不是已经过期了？过期的按它自己的规矩，要么丢掉，要么补做。
> 4. 心跳任务还要多问几句：这个角色是不是在睡觉？今天的「动脑次数」用完没有？刚给阿萌发过消息吗？任何一条不满足，就安静地跳过，**连模型都不叫**，一分钱额度都不花。
> 5. 都通过了，才叫醒角色的「大脑」，让它自己决定：不说话（noop）、给你发条消息、或者顺手做件事（比如帮你建个提醒）。
> 6. 做完排好下一次心跳，然后回到第 1 步。

### 4.1 一轮巡逻

```text
每 15s：
  if 在 quiet 时段：return
  due = SELECT … FROM jobs WHERE status='pending' AND run_at <= now ORDER BY run_at LIMIT 20
  for job in due:
    if job.expires_at && now > job.expires_at → status='expired'; continue
    if 刚从休眠醒来 && job.missed_policy='drop' && run_at < 醒来时刻 - 5min → 'expired'; continue
    claim(job) 失败 → continue
    run(job)（带 30s 续租）→ done / failed(重试退避 1m, 5m, 30m) / expired
```

醒来判定：本轮与上轮间隔超过 5 分钟，即视为刚从休眠或停机中恢复。

### 4.2 任务种类

| kind | 谁建 | 过期策略 | 作用 | 阶段 |
|---|---|---|---|---|
| `test.ping` | 前端 / CLI | `catch_up` | 读一次日历，发一条 `system_notice` | Phase 1 |
| `heartbeat` | 调度器 | `drop` | 角色醒来自主判断 | Phase 1 末 |
| `ha.watchdog` | 调度器 | `drop` | 每 5 分钟检查 HA，连续失败 3 次用 `utmctl` 重启虚拟机，重启后仍不通就通知 | Phase 1 |
| `reminder.followup` | 角色 / 前端 | `catch_up` | 到点跟进你交代的事 | Phase 2 |

### 4.3 心跳执行

1. 代次检查：`job.generation != characters.heartbeat_generation` → `cancelled`，不续排。
2. **先排下一跳**：`uuid = hb:<charId>:<generation>:<nominalRunAt>`，间隔加 ±10% 确定性抖动（与 8-18 版一致，重试时算出同一个 uuid，不会长出两条链）。下一跳若落在 quiet 时段，推到 `quiet_end + 抖动`。
3. 零模型闸（任一命中即 `done`，`outcome='skipped'`，不调模型）：
   - 角色在 `sleepWindow` 内；
   - 当日 `model_runs` 次数 ≥ `daily_model_budget`；
   - 距上次该角色 `chat_message` 不足 `message_cooldown_min`；
   - 快照 `built_at` 在 2 分钟内（阿萌正在和这个角色聊天，让路）；
   - 没有快照。
4. 调模型：见第 5 节；输出必须符合 `{ action: 'noop'|'message'|'task', text?, task?, reason }`。
5. `message` → 写 outbox 并推送；`task` → 经白名单执行一个工具，结果写 `tool_audit`，需要时再发消息；`noop` → 只记 `model_runs`。

---

## 5. 模型运行器

> 🐾 **小帕讲人话**
>
> 管家叫醒角色有两种方式：
>
> - **Elias**：管家在 Mac mini 上悄悄运行一次 Codex（用你的 ChatGPT 订阅），把 Elias 的设定和近况递给它，要求它必须按固定格式回答，比如「这次不说话」或「我想说：……」。
> - **其他角色**：用各自在 LiliumOS 里绑定的 API，Key 存在 Mac mini 的钥匙串里。
>
> 两种方式对管家来说是一样的「插头」，所以以后换一种大脑，也不用改别的地方。

统一接口：

```ts
interface ModelRunner {
  run(input: {
    charId: string;
    system: string;          // 由快照 + 心跳指令拼成
    user: string;
    schema: object;          // 输出 JSON Schema
    timeoutMs: number;       // 心跳默认 120s
  }): Promise<{ ok: true; output: HeartbeatOutput } | { ok: false; error: string }>;
}
```

**Codex 运行器**（仅 `runtime='codex'`）：

```text
codex exec --ephemeral --ignore-user-config --skip-git-repo-check \
  -s read-only -C <专用空目录> \
  --output-schema <schema.json> -o <last.json> -
```

- 提示词经 stdin 传入，不出现在进程参数里（`ps` 看不到）。
- 专用空目录下不放 `AGENTS.md`；`CODEX_HOME` 使用阿萌现有登录。
- 超时即杀进程，记 `model_runs.error='timeout'`。
- 连续 3 次登录失败 → `status.deps.codex.ok=false`，停止 Codex 心跳并通知阿萌，不回落到别的 API（避免 Elias 悄悄换了「大脑」）。

**API 运行器**：OpenAI 兼容 `/chat/completions`，`response_format` 支持时用 JSON Schema，不支持时用解析容错；Key 从钥匙串按 `cred_ref` 读取。

---

## 6. 前端改动范围（EM 独立文件为主）

> 🐾 **小帕讲人话**
>
> LiliumOS 这边要加的东西都尽量放在我们自己的新文件里，上游的文件最多加一两行「入口」，以后合并上游更新时不会打架。

| 文件 | 作用 |
|---|---|
| `utils/emAgentClient.ts`（新） | 所有 `/agent/v1` 调用、设备 token 存储（仅本机 localStorage，不进备份） |
| `utils/emAgentSnapshot.ts`（新） | 从角色、聊天、日程生成 3.4 的快照 |
| `utils/emAgentOutbox.ts`（新） | 取信箱、写入聊天、ack |
| `apps/AgentBackendApp.tsx` 或设置子页（新） | 配对、设备列表、每角色心跳开关、工具白名单、操作记录 |
| `hooks/useChatAI.ts` | 1 行：聊天结束后调用快照上传（带防抖，失败静默） |
| App 启动处 | 1 行：打开时补收 outbox |

后端不可达时前端一律静默降级，只在设置页显示「后台休息中 / 离线」。

---

## 7. Mac mini 部署形态

```text
~/Library/Application Support/LiliumOS/agent-backend/
  ├─ agent.db                SQLite（WAL）
  ├─ codex-workdir/          Codex 专用空目录
  └─ logs/                   只含路由、状态码、耗时、uuid
LaunchAgent: cc.liliumos.agent-backend.plist（RunAtLoad + KeepAlive）
代理：home-assistant-proxy.mjs 增加 `/agent/*` → 127.0.0.1:8790
```

代码放在仓库 `server/agent-backend/`，与 `apple-events-bridge` 同样的部署方式。

---

## 8. 分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| **1a** | 服务骨架、迁移、配对、多设备推送、outbox、`test.ping` | 手机和电脑**都**收到测试通知；关掉后端，LiliumOS 聊天与 amsg 不受影响 |
| **1b** | `ha.watchdog`、`status` 依赖检查、前端设置页 | HA 虚拟机关掉后 15 分钟内收到通知 |
| **1c** | Codex 运行器实测、心跳（只判断不发送的「影子运行」一周） | 阿萌看影子记录，确认 Elias 的判断和语气可以接受 |
| **1d** | 心跳真实推送、白名单生效 | 按 4.3 全部闸门验收 |
| 2 | Continuity State、记忆确认流程、ChatGPT 侧 MCP | 另开文档 |

---

## 9. 待决定

1. 配对码是否也允许在 Mac mini 上用二维码显示（手机扫一下更方便），还是 6 位数字就够？
2. 心跳影子运行期的记录，想在哪里看：LiliumOS 设置页，还是只在 Mac mini 上看日志？
3. `heartbeat_every_min` 默认 60、每日预算 12 次、消息冷却 90 分钟——这组默认值合适吗？
