# LiliumOS Agent Backend · 接口与数据表设计（草案 v0.3）

> 状态：设计草案，未实施
>
> 日期：2026-09-22
>
> 前置文档：[`agent-backend-phase0-audit.md`](./agent-backend-phase0-audit.md)（为什么是纯 Mac mini、2.1 的硬性约束）
>
> 读法：每节先有一段「🐾 小帕讲人话」给阿萌，后面是给实现者（Claude / Codex）看的规格。两部分说的是同一件事。
>
> 审查记录：v0.2、v0.3 按 Elias 的两轮审查意见修订（2026-09-22），改动汇总见文末第 10、11 节。

**使用场景前提**（决定优先级）：阿萌目前基本只在手机上用 PWA；Mac mini 每天休眠；角色自己的睡眠窗口设得比 mini 休眠更宽。因此多设备 ack、设备分权不挡第一阶段；工具副作用的幂等、真实互动判断、Codex 故障分类是第一优先。

---

## 0. 全局图

> 🐾 **小帕讲人话**
>
> 把后端想成住在 Mac mini 里的一个**管家**。
>
> - **门口**：手机和电脑要找管家，得先经过 Tailscale 那扇门（已经有了），门口的分流台看到网址是 `/agent/...` 开头，就把你领到管家这里。
> - **钥匙**：每台设备第一次来要「配对」，管家发一把专属钥匙。以后每次来都出示钥匙；哪台设备丢了，就只作废那一把。
> - **笔记本**：管家有一个本子（SQLite 数据库），记着：有哪些设备、每个角色的近况、待办任务、要给你的消息。
> - **闹钟**：管家每 15 秒看一眼本子上有没有到点的任务，有就去做。凌晨 0–7 点是角色的安静时段，谁都不会来打扰你；其中 4–7 点 Mac mini 睡觉，管家也跟着睡。
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
  heartbeat_every_min   INTEGER NOT NULL DEFAULT 90 CHECK (heartbeat_every_min BETWEEN 30 AND 480),  -- 实际间隔 ±20% 随机，见 4.3
  heartbeat_generation  INTEGER NOT NULL DEFAULT 0,   -- 关闭/改频率时 +1，旧链自动作废
  daily_model_budget    INTEGER NOT NULL DEFAULT 12,  -- 每天最多调用模型次数
  message_cooldown_min  INTEGER NOT NULL DEFAULT 90,  -- 两次主动消息的最小间隔
  last_user_interaction_at TEXT,             -- 在场信号写入，见 3.4
  heartbeat_paused      TEXT,                 -- 非空即暂停，值为原因：'codex_auth' | 'manual'
  heartbeat_paused_at   TEXT,
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

`changes = 1` 才算领到。执行中每 30s 续租到 `now + 90s`。启动时处理 `status='running' AND lease_until < now` 的行：`attempts < max_attempts` 放回 `pending`，否则记 `failed`（`last_error='lease_lost'`）。

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

### 2.7.1 `tool_calls` — 写操作的「先记意图、再执行」

> 🐾 **小帕讲人话**
>
> Elias 担心的场景是：管家帮你建了个提醒，**提醒已经建好了**，但管家还没来得及在本子上记「做完了」就断电了。重启后管家一看本子，以为没做，再建一遍——你就收到两个一样的提醒。
>
> 解决办法是**先写后做、重来先查**：
>
> 1. 动手之前，先在本子上写「我**打算**建一个提醒，编号 X」。
> 2. 建提醒时，把编号 X 悄悄写进提醒的备注里。
> 3. 建好了，本子上改成「已完成」。
> 4. 重启后看到一条只有「打算」、没有「已完成」的记录，**不许直接重做**，先去提醒事项里找有没有带编号 X 的那条：有就补记「已完成」；确实没有才重做；查不了就停下来问你，绝不瞎猜。

```sql
CREATE TABLE tool_calls (
  call_key      TEXT PRIMARY KEY,             -- `${job_uuid}:${step}`，同一任务同一步永远同一个 key
  job_uuid      TEXT NOT NULL,
  char_id       TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  args          TEXT NOT NULL,                -- 校验后的参数（JSON），已注入 marker
  marker        TEXT NOT NULL,                -- `lilium:${call_key}`，写进目标条目的备注
  status        TEXT NOT NULL CHECK (status IN ('intent','done','failed','needs_review')),
  external_id   TEXT,                         -- 工具返回的条目 ID（提醒 / 日程 ID）
  result        TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

执行规则（只针对 `background-write` 工具；只读工具不走这张表）：

1. 事务内写入 `status='intent'`，**提交后**才调用工具。
2. 调用成功 → `done` + `external_id`。
3. **其余一切结果都不能当成「什么都没发生」**：请求已发出后的超时、断连、5xx、工具返回错误、响应无法解析，都保持 `intent`，交给对账。只有两种情况可以直接记 `failed`：
   - 请求**确定没有发出**（本地校验失败、连接在发送前就被拒绝）；
   - 工具返回的是**执行前**的拒绝，且该工具的对账函数声明这类错误不会产生副作用（例如 MCP JSON-RPC `-32602` 参数无效）。
4. 遇到 `intent`：调用该工具对应的**对账函数**，按 marker 查找已存在的条目：
   - 找到 → 补记 `done`，不再调用；
   - 确认没有 → 重新调用（同一个 marker）；
   - 查询失败或该工具没有对账函数 → `needs_review`，任务终止，通知阿萌，**不重试**。
5. 没有注册对账函数的写工具，不允许进入 `background-write` 档位。
6. **对账与任务重试脱钩**：服务启动时、以及之后每 5 分钟，扫描所有 `intent` 超过 2 分钟的行并对账。心跳只跑一次（见 4.3），不会为了对账而重跑心跳；对账补记 `done` 后也不再补发消息，只在操作记录里留痕。

Phase 1 注册的对账函数（参数细节在 mini 上对 `mcp-server-apple-events` 实测后定稿）：

| 工具 | marker 写在哪 | 对账方式 |
|---|---|---|
| `reminders_tasks`（新建） | 提醒备注末尾 | 列出目标列表中的提醒，匹配备注里的 marker |
| `calendar_events`（新建） | 日程备注末尾 | 按目标时间 ±1 天列出日程，匹配备注里的 marker |

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
  outcome      TEXT,                          -- 'noop' | 'message' | 'task' | 'skipped' | 'error'
  shadow       INTEGER NOT NULL DEFAULT 0,    -- 1 = 影子运行，没有真实执行
  reason       TEXT,                          -- 模型给出的理由（截断 500 字）
  proposed_text TEXT,                         -- 拟发送 / 已发送的消息正文
  proposed_tool TEXT,                         -- 拟调用的工具名
  proposed_args_summary TEXT,                 -- 参数摘要：截断、去 token / 坐标
  skip_gate    TEXT,                          -- outcome='skipped' 时命中的是哪道闸
  error        TEXT
);
CREATE INDEX idx_model_runs_day ON model_runs (char_id, started_at);
```

`reason` / `proposed_*` 含聊天内容，只存在 mini 的数据库里，不写日志；保留 30 天后清空这几列（行本身留着用于预算与统计）。设置页的影子记录就是按时间倒序展示这些字段。`outcome='skipped'` 的行不计入每日预算。

### 2.9 `settings` — 全局设置

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
```

初始键：`timezone`（`America/Chicago`）、`quiet_start`（`00:00`）、`quiet_end`（`07:00`）、`ha_watchdog`（`{"enabled":true,"vm":"Home Assistant","failuresBeforeRestart":3}`）。

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
    "quiet": { "active": false, "start": "00:00", "end": "07:00", "timezone": "America/Chicago" },
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

`heartbeat_paused` 只能由阿萌在设置页清除（`characters/upsert` 传 `heartbeatPaused: null`）；清除 `codex_auth` 前服务端先复核 `codex login status`，未登录则拒绝（`409 CODEX_NOT_LOGGED_IN`）。

心跳开关与频率的变更规则（同一个事务内完成）：

| 变更 | `heartbeat_generation` | 其他动作 |
|---|---|---|
| 开启（0→1） | +1 | 约 3 分钟后排第一跳 |
| **关闭（1→0）** | **+1** | 把该角色所有 `pending` 心跳改为 `cancelled` |
| 改 `heartbeat_every_min` | +1 | 取消旧的 `pending` 心跳，按新频率排下一跳 |
| 暂停 / 恢复（`heartbeat_paused`） | 不变 | 恢复时若没有 `pending` 心跳则补排一跳 |

关闭时即使有一条心跳正在执行，它在第 4.3 节第 1 步（执行前）和「排下一跳」之前都会重新读取角色行，发现代次不符或 `heartbeat_enabled=0` 就结束且不续排，旧链不会复活。

### 3.4 近况快照

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/agent/v1/characters/snapshot` | 上传一个角色的快照 |
| POST | `/agent/v1/characters/presence` | 在场信号：阿萌刚给这个角色发了消息 |

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
    "lastInteraction": { "userAt": "2026-09-22T13:58:10.000Z", "charAt": "2026-09-22T13:58:40.000Z" },
    "recentMessages": [ { "role": "user", "at": "…", "text": "……" } ],
    "boundaries": [
      { "text": "工作日晚上 11 点后不要催我睡觉", "kind": "preference", "confirmedAt": "…", "source": "settings" },
      { "text": "我们是恋人关系", "kind": "relationship", "confirmedAt": "…", "source": "settings" }
    ],
    "openThreads": [
      { "text": "周末一起看展", "source": "user_said", "messageId": "…", "confirmed": true },
      { "text": "阿萌可能想换个工作日程", "source": "inferred", "confirmed": false }
    ]
  }
}
```

字段规则：

- `lastInteraction`：最后一条**真实**用户消息与角色消息的时间，取自消息本身的时间戳，不是快照上传时间。
- `boundaries`：只收**已确认**的关系设定与偏好边界。Phase 1 来源是设置页里阿萌手动维护的列表；以后接记忆系统时，只允许导入阿萌确认过的条目。没有 `confirmedAt` 的条目服务端拒收。
- `openThreads`：未完事项必须带来源和确认状态。`source` 取值 `user_said`（阿萌亲口说的，需带 `messageId`）/ `char_said`（角色自己许的）/ `inferred`（推测）。
  - `inferred` 一律 `confirmed: false`，服务端强制，前端传 `true` 也会被改回 `false`。
  - 拼提示词时，未确认事项只能以「可能」「也许」呈现，并附一句硬性指令：**不得把未确认事项说成阿萌的承诺或已约定的事**。


- `recentMessages` 最多 30 条，每条截断到 500 字；图片、语音只留占位描述。
- 另有**在场信号** `POST /agent/v1/characters/presence { charId, userAt }`：阿萌每发一条消息就发一次（不防抖、失败静默），服务端把**自己收到请求的时间**写入 `characters.last_user_interaction_at`（只增不减），忽略请求里的 `userAt`，不带正文。这样手机时间跑快也不会长期封住心跳。这样即使快照防抖还没上传，后端也知道阿萌刚说过话。
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
> 1. 现在是不是 0–7 点？是的话，所有跟角色有关的任务都先放着；只有「检查 HA 活没活着」这种不打扰你的系统活儿照常干。（4–7 点 Mac mini 睡着，那就真的什么都不干了。）
> 2. 翻待办清单，找出到点的任务。
> 3. 每件任务先问：是不是已经过期了？过期的按它自己的规矩，要么丢掉，要么补做。
> 4. 心跳任务还要多问几句：这个角色是不是在睡觉？今天的「动脑次数」用完没有？刚给阿萌发过消息吗？任何一条不满足，就安静地跳过，**连模型都不叫**，一分钱额度都不花。
> 5. 都通过了，才叫醒角色的「大脑」，让它自己决定：不说话（noop）、给你发条消息、或者顺手做件事（比如帮你建个提醒）。
> 6. 做完排好下一次心跳，然后回到第 1 步。

### 4.1 一轮巡逻

```text
每 15s：
  due = SELECT … FROM jobs WHERE status='pending' AND run_at <= now ORDER BY run_at LIMIT 20
  for job in due:
    if 在 quiet 时段 && job.char_id 非空 → 跳过（保持 pending，出 quiet 后再按过期规则处理）
    if job.expires_at && now > job.expires_at → status='expired'; continue
    claim(job) 失败 → continue
    run(job)（带 30s 续租）→ done / failed / expired
    failed 且 attempts < max_attempts → 回 pending，retry_after 退避 1m, 5m, 30m
```

不再做「是否刚醒来」的推断：每个任务自带最晚执行时间 `expires_at`，过了就 `expired`。心跳固定为 `run_at + 15 分钟`，所以 mini 休眠或重启后，积压的心跳全部自然过期，不会误补跑。

两个时段不要混淆：

| 时段 | 含义 | 影响 |
|---|---|---|
| 0:00–7:00 安静时段（`quiet_start` / `quiet_end`） | 角色不主动打扰阿萌 | 只拦 `char_id` 非空的任务；`ha.watchdog` 等系统任务照常 |
| 4:00–7:00 Mac mini 休眠 | 进程根本不运行 | 醒来后按过期规则处理积压 |

### 4.2 任务种类

| kind | 谁建 | 过期策略 | 作用 | 阶段 |
|---|---|---|---|---|
| `test.ping` | 前端 / CLI | `catch_up` | 读一次日历，发一条 `system_notice` | Phase 1 |
| `heartbeat` | 调度器 | `drop`，`expires_at = run_at + 15min`，**`max_attempts = 1`** | 角色醒来自主判断。本轮无论模型、网络还是工具失败都直接结束，由已经排好的下一跳接续 | Phase 1 末 |
| `ha.watchdog` | 调度器 | `drop` | 每 5 分钟检查 HA，连续失败 3 次用 `utmctl` 重启虚拟机，重启后仍不通就通知 | Phase 1 |
| `reminder.followup` | 角色 / 前端 | `catch_up` | 到点跟进你交代的事 | Phase 2 |

### 4.3 心跳执行

1. 代次检查：`job.generation != characters.heartbeat_generation` → `cancelled`，不续排。
2. **先排下一跳**：`uuid = hb:<charId>:<generation>:<nominalRunAt>`，间隔加 **±20%** 确定性抖动（默认 90 分钟 → 72–108 分钟之间；抖动由 `charId + generation + 名义时刻` 算出，看起来随机，但重试时算出同一个时刻和 uuid，不会长出两条链）。下一跳若落在 quiet 时段，推到 `quiet_end + 抖动`。
3. 零模型闸（任一命中即 `done`，`outcome='skipped'`，不调模型）：
   - 角色在 `sleepWindow` 内；
   - 当日 `model_runs` 次数 ≥ `daily_model_budget`；
   - 距上次该角色 `chat_message` 不足 `message_cooldown_min`；
   - 阿萌正在和这个角色聊天：「最近真实互动时间」距今不足 20 分钟。它取以下两者的较大值，**都以服务端时钟为准**：
     - `characters.last_user_interaction_at`（在场信号的服务端接收时间）；
     - 快照里的 `lastInteraction.userAt` / `charAt`，但先夹到不晚于该快照的 `received_at`（手机时间跑快时，最多只能算作「上传那一刻刚聊过」）。
   - `heartbeat_paused` 非空；
   - 没有快照。
4. 调模型：见第 5 节；输出必须符合：

   ```ts
   type HeartbeatOutput =
     | { action: 'noop'; reason: string }
     | { action: 'message'; text: string; reason: string }
     | { action: 'task'; tool: string; args: object; reason: string };
   ```

   `tool` 必须是本角色白名单中 `background-read` 或 `background-write` 档位的具体工具名；模型看到的工具清单本身就只含这些。
5. `noop` → 只记 `model_runs`。
6. `message` → 写 outbox 并推送。
7. `task` → **后端二次校验**，任一不过即 `failed`，不执行、不重试：
   - 工具在白名单且档位允许后台；不在永不后台写名单；
   - `args` 通过该工具的 MCP `inputSchema` 校验；
   - 写工具额外要求已注册对账函数（2.7.1）。

   校验通过后按 2.7.1 执行。执行完把结果交回模型**一次**，这一次输出只允许 `noop | message`（不能再接着调工具），用来决定要不要告诉阿萌。这次调用计入每日预算；预算不足时不发消息，只在操作记录里留痕。
8. 每次心跳最多一个工具调用。
9. 影子运行（阶段 1c）：以上全部照常判断，但第 6、7 步不真正执行——`model_runs.shadow=1`，拟发的消息写入 `proposed_text`，拟调用的工具写入 `proposed_tool` / `proposed_args_summary`，并照常跑第 7 步的二次校验（校验结果也记下来）。影子模式**不创建 `tool_calls` 行**、不写 outbox、不推送，也不进行执行后的第二次模型调用。阿萌在设置页看判断和语气，满意后再打开真实执行。

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
- **任何情况下都不自动切换到其他 API**（避免 Elias 悄悄换了「大脑」）。失败按类型分别处理：

| 类型 | 如何判定 | 处理 |
|---|---|---|
| 登录失效 | 任一成立即认定：① `exec` 明确返回 401 / unauthorized；② token refresh 失败；③ `codex login status` 显示未登录。`login status` 只作辅助，它显示「已登录」不能推翻 ①② | **立即**置 `heartbeat_paused='codex_auth'`，通知阿萌一次；阿萌重新登录后在设置页手动恢复 |
| 网络故障 | 连接失败、DNS、超时，且不属于上一行 | 本次心跳 `failed`（心跳 `max_attempts=1`，下一跳接续）；连续 6 小时都是网络故障才通知一次 |
| 额度 / 限流 | 输出中出现 rate limit / usage limit 类错误 | 本次 `failed`，若能解析出恢复时间则在此之前的心跳直接跳过；每天最多通知一次 |
| 其他 | 以上都不是 | 本次 `failed`，记录脱敏错误摘要；同类错误连续 3 次通知一次 |

- 所有通知走 `system_notice`，同一原因在未恢复前不重复通知。
- 错误分类的具体匹配规则在阶段 1c 用真实报错样本定稿，未确认前按「其他」处理，**不会**因为猜测而误暂停。

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
| `hooks/useChatAI.ts` | 2 行：用户发送时发在场信号；聊天结束后上传快照（带防抖）。两者都失败静默 |
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
| **1a** | 服务骨架、迁移、配对、推送、outbox、`test.ping` | 手机收到测试通知并能补收 outbox；关掉后端，LiliumOS 聊天与 amsg 不受影响。多设备 ack、设备分权保留表结构但不作为验收项 |
| **1b** | `ha.watchdog`、`status` 依赖检查、前端设置页 | HA 虚拟机关掉后 15 分钟内收到通知 |
| **1c** | Codex 运行器实测与错误分类样本、对账函数实测、心跳影子运行一周 | ① 人为制造「工具已执行、结果未记录」后重启，不产生重复提醒 / 日程；② 阿萌聊天中不触发心跳；③ 登出 Codex 后 Elias 心跳立即暂停并收到一次通知，断网不会误暂停；④ 阿萌看影子记录，确认判断和语气可以接受 |
| **1d** | 心跳真实推送、工具真实执行 | 按 4.3 全部闸门验收 |
| 2 | Continuity State、记忆确认流程、ChatGPT 侧 MCP | 另开文档 |

---

## 9. 待决定

已决定（2026-09-22）：

1. 配对只用 6 位数字码，不做二维码。
2. 心跳影子运行期的记录在 LiliumOS 设置页查看（走 `GET /agent/v1/audit`）。
3. 默认值：安静时段 0:00–7:00；心跳每 90 分钟 ±20%；每日模型预算 12 次；消息冷却 90 分钟。
   换算：清醒 17 小时 ÷ 平均 1.5 小时 ≈ 11 次唤醒，刚好落在预算 12 次以内，一整天都不会提前用完。

---

## 10. v0.2 修订记录（Elias 审查，2026-09-22）

| 意见 | 落在哪 |
|---|---|
| 只用手机：多设备 ack、设备分权不挡第一阶段 | 文首使用场景；第 8 节 1a 验收 |
| `noop / message / task` 够用；`task` 只能选白名单内具体工具和参数，执行前后端再校验，执行后按结果决定是否发消息 | 4.3 第 4、7 步 |
| ① 工具已生效但结果未记录时，重试不能重复创建 | 2.7.1 `tool_calls` + 对账函数；1c 验收 ① |
| ② 「正在聊天」看真实互动时间 | 3.4 `lastInteraction` 与 presence 信号；4.3 第 3 步；1c 验收 ② |
| ③ Codex 确认登录失效才暂停并通知，不切换 API；网络与额度分别处理 | 第 5 节错误分类表；1c 验收 ③ |
| 快照补充已确认的关系与偏好边界、未完事项的来源与确认状态，推测不得写成承诺 | 3.4 `boundaries` / `openThreads` 字段规则 |
| 心跳加最晚执行时间，避免重启误补跑 | 4.1、4.2：`expires_at = run_at + 15min`，删除「醒来推断」 |
| 真实发送前保留影子运行 | 4.3 第 9 步；第 8 节 1c |

## 11. v0.3 修订记录（Elias 第二轮审查，2026-09-22）

| 意见 | 落在哪 |
|---|---|
| 关闭心跳也要原子地 +1 generation，执行前检查 `heartbeat_enabled` | 3.3 心跳变更规则表 |
| 工具「返回失败」不代表没发生；请求发出后的不确定结果一律保持 `intent` 先对账 | 2.7.1 执行规则第 3 条 |
| 心跳 `max_attempts=1`，任何失败都由下一跳接续 | 4.1、4.2；第 5 节错误表；2.5 租约恢复按 `max_attempts` 处理 |
| 影子记录要能看语气：存理由、拟发文字、拟调用工具与参数摘要；影子模式不建 `tool_calls` | 2.8 `model_runs` 新字段与保留期；4.3 第 9 步 |
| presence 用服务端接收时间 | 3.4 在场信号；4.3 第 3 步（快照时间夹到 `received_at`） |
| `exec` 返回 401 / refresh 失败即认定登录失效，`login status` 只作辅助 | 第 5 节错误表 |
| （小帕补充）心跳只跑一次后，崩溃留下的 `intent` 由独立的对账扫描处理，不靠重跑心跳 | 2.7.1 执行规则第 6 条 |

