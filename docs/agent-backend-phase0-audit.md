# LiliumOS 私人 Agent 后端 · Phase 0 现状审计

> 状态：只读审计，未改功能代码；架构方向已定为「纯 Mac mini 后端」（2026-09-22）
>
> 日期：2026-09-22（main @ `2513d55d`）
>
> 对应企划：[`personal-agent-backend-proposal.md`](./personal-agent-backend-proposal.md) 第 14 节 Phase 0、第 16 节审查问题。本文第 4 节起的架构结论**取代**企划第 4 节「Cloud Coordinator + Mac Runner」的双层设计。

## 0. 结论先行

1. **主动消息 2.0 Worker（amsg）是成熟的调度 + 推送内核**：D1 任务表带租约领取、续租心跳、分组串行、重试退避、时区循环、推送 + 收件箱双通道送达、按角色的加密凭据引用。它的这些**模式**值得照抄。
2. **但新后端不能长在 amsg 里**。`worker/amsg/src/index.ts` 是上游文件（57 次提交来自上游作者 Tosd0，EM 零哨兵），而且一键部署和自更新都从上游仓库拉 bundle。放进 amsg 的 EM 功能会被静默换回上游版本，8-18 心跳正是这样出的事（见 2.1）。
3. **既然不扩 amsg，Cloudflare 对新后端就只剩「Mac mini 离线时替它收任务」这一个价值**。阿萌的使用场景里这个价值很低：Mac mini 每天只在 4–7 点定时休眠，而那段时间本来就不需要角色主动联系。
4. **决定：纯 Mac mini 后端。** 一个 Node 服务 + 本地 SQLite + LaunchAgent 常驻 + 已有的 Tailscale Funnel 入口 + 自己发 Web Push。现有 Cloudflare 上的 amsg 原样保留、不改一行，继续负责它已经在做的定时主动消息和即时聊天。
5. **Codex 非交互调用在技术上可行**：Codex.app 自带 CLI 0.142.5，已用 ChatGPT 账号登录，`codex exec` 支持 `--json`、`--output-schema`、`--ephemeral`、`--ignore-user-config`、只读沙箱。剩下的是额度、条款和人设一致性问题。

## 1. 当前真实数据流（amsg，保持不动）

```text
LiliumOS PWA（浏览器 IndexedDB 为唯一事实来源）
  │  X-Client-Token + 客户端加密（userKey）
  │
  ├─ PUT /client-state          fire_pack（角色身份/近期聊天快照/自述日志/睡眠等）
  │                             tool_pack、tool_config（MCP 服务器清单，含 token）
  │                             amsg:job（后台任务一次性输入，TTL 3 天）
  ├─ PUT /llm-credentials       每角色三行凭据（chat / emotion / memory），任务只带 credRefs
  ├─ PUT /push-subscription     Web Push 订阅（单用户一条）
  ├─ POST /schedule-message     建任务（fixed / prompted / auto / instant）
  ├─ POST /instant-chat         即时对话：一次请求传状态 + 建任务，DO alarm 立刻起跳
  └─ GET /outbox + POST /outbox/ack   上线补收推送没送到的消息与后台结果
            │
            ▼
Cloudflare Worker（amsg，单用户）+ D1
  cron 每分钟 → runScheduledTick → 取 50 条到期 → claimTask 领租约
     → onBeforeFire：
          有 metadata.amsgKind → fireKinds 注册表（目前只有「门牌整理」）
          否则 → 聊天主干（热聊让路 / 过期作废 / 连发闸 / 拼 fire_pack）
     → 调角色 API（按 credRefs 解密凭据）→ agentic 工具循环
          （MCP 直连用户配置的公网 URL，单次 25s，单次 fire 共 120s）
     → Web Push（VAPID，或原生 FCM）+ message_outbox 落账
```

### 1.1 D1 表（供新后端设计 SQLite 表时参照）

| 表 | 作用 | 新后端的对应物 |
|---|---|---|
| `scheduled_messages` | 加密任务行；`lease_until` / `retry_after` / `serialize_group` / `retry_count` / `last_error`；`uuid` 唯一索引做幂等 | `jobs` 表，字段照抄 |
| `client_state` | (user, namespace, key) → 加密值，可按 namespace 配 TTL | 角色快照 / Continuity State |
| `message_outbox` | 推送的持久副本，客户端补收后 ack | `outbox` 表，照抄 |
| `llm_credentials` | 每角色 API 凭据密文 | 凭据改存 mini 的钥匙串，不进 SQLite |
| `push_subscriptions` | **以 user_id 为主键，只能存一台设备** | `devices` 表，每台设备一行（见 2.1） |

### 1.2 值得照抄的可靠性机制

- **领取**：`UPDATE … SET lease_until=? WHERE id=? AND status='pending' AND next_send_at=<读到的原值> AND (lease_until IS NULL OR lease_until<=now)`，靠 `changes > 0` 判定是否领到。排期被改过、别人拿着、已结束都会自然领取失败。单进程也要这样做：进程崩溃重启后，靠租约过期把卡住的任务放出来。
- **续租**：执行中每 30s 续一次，租期 90s。
- **分组串行**：`serialize_group`，同组同时只跑一条（EM 在 amsg 里用 `charId#kind`，后台任务不挡聊天）。
- **幂等**：任务 `uuid` 唯一索引；outbox `(user_id, message_id)` 唯一。
- **重试**：`retry_after` 与租约分开存，失败退避，`last_error` 存脱敏摘要。

## 2. 已有能力与缺口

| 企划中的需求 | 现状 |
|---|---|
| 页面关着也能按时唤醒 | ✅ amsg cron 每分钟（仅限 amsg 自己的任务） |
| 每角色独立 API | ✅ `chatApiPresetId` + credRefs 上云 |
| 后台调用获准 MCP | ✅ amsg Worker 直连公网 MCP（含 mini 的 Apple Events 桥） |
| 后台工具的危险操作拦截 | ⚠️ 部分：后台只剔除 `destructiveHint: true` 的工具（`utils/mcpClient.ts:254`）；新建/修改类若服务器没标注为 destructive，后台可无人确认执行 |
| 推送 + 离线补收 | ✅ Web Push / FCM + outbox；⚠️ 只能推到一台设备 |
| 「唤醒不等于发消息」 | ✅ 后台任务 `skip-push`、`notification.show=false` 只落账本 |
| 心跳 | ❌ 8-18 做过完整一版，同日 `25399fad` 整体撤回（见 2.1） |
| Mac 常驻后端 / 任务队列 | ❌ 无（mini 上只有 Apple Events 桥和 HA 虚拟机） |
| 连续性状态 / ChatGPT 侧 MCP | ❌ 无（fire_pack 是 amsg 专用的聊天快照，不是跨入口状态） |
| 设备级凭据 | ❌ amsg 只有一个可选的全局 `AMSG_SERVER_TOKEN` |

### 2.1 8-18 心跳撤回的根因（2026-09-22 与 GPT 侧记录核对）

心跳调度算法本身没有被证实有问题。撤回是因为它接进 amsg 共用后端之后，暴露出两处会影响正常聊天的链路问题：

1. **前端与 Worker 版本对不上。** 心跳用的是新版 `fire_pack v8`，但一键部署（`utils/cfProvision.ts:25`）和 Worker 自更新（`worker/amsg/src/selfUpdate.ts:26`）都从上游 `Tosd0/sullyos-workers` 拉代码。界面显示「更新成功」，云端实际跑的仍是不认识 v8 的上游版本，于是依赖 fire_pack 的云端生成都失败。**这两处至今仍指向上游。**
2. **推送只能到一台设备。** `push_subscriptions` 以 `user_id` 为主键，桌面端后登记就会覆盖手机。手机把即时聊天交给云端后，只看到任务结束，拿不到回复正文。当时补过「发送前重新登记当前设备」，但整条链路已经不够可信。**表结构至今未变。**

回滚撤掉了心跳、`fire_pack v8` 和相关设置，并清理了云端残留的隐藏心跳任务；普通主动消息和即时聊天保留。

**由此得出的硬性约束：**

- 新后端**不依赖任何会被自更新换回上游的代码**。它是 EM 独有的独立服务，版本由自己上报，前端按实际运行的能力判断，不看「更新成功」的提示。
- 新后端**自己管多设备推送**，每台设备一行订阅；outbox 是送达保证，推送只作提醒。
- 新后端**故障不能拖垮普通聊天和 amsg 主动消息**：它和 amsg 之间不共享任何状态或协议版本。

## 3. 第 16 节九问的回答

### Q1 amsg2 扩成 Coordinator，还是旁挂独立服务？

**独立服务，而且不在 Cloudflare 上。** 理由：

- 最硬的一条：amsg 的一键部署和自更新都从上游仓库拉 bundle（见 2.1），放进去的 EM 功能随时可能被静默换掉。
- `index.ts` 是上游高频改动文件，心跳那次在它和 `activeMsgClient.ts` 上各加了 200+ 行；按架构原则第 2、3 条，这类改动应该落在独立文件。
- 调度内核在 npm 包 `@rei-standard/amsg-server` 里，EM 改不了；hook 的形状是「到点 → 在 Worker 里调 LLM」，没有「交给外部执行器」这一步。
- 既然要另起一个服务，放在 mini 上比放在 Cloudflare 上少一整层：Codex、本地 MCP、钥匙串本来就只能在 mini 上跑。

### Q2 D1 够不够？要不要 Queue / DO / Workflows？

**都不用。** 纯 Mac mini 方案用本地 SQLite（Node 22+ 自带 `node:sqlite`，或 `better-sqlite3`）。单用户的量完全不是问题；租约、幂等、串行照抄 1.2 的模式即可。SQLite 文件纳入 mini 的备份（见第 4.6 节）。

### Q3 Mac Runner 用轮询、长连接还是 Tunnel？

**都不需要了。** 后端就在 mini 上，任务就在本地 SQLite 里，没有「领取」这一跳。对外入口复用已有的 Tailscale Funnel（HTTPS，Bearer 鉴权），与 Apple Events 桥共用同一个私有代理。

### Q4 订阅认证运行器有没有稳定的调用入口？

**有，技术上已确认**（在 MacBook 上检查，mini 待复核）：

- `/Applications/Codex.app/Contents/Resources/codex`，`codex-cli 0.142.5`，`codex login status` → 已用 ChatGPT 登录。
- `codex exec` 非交互；`--output-schema <FILE>` 强制结构化输出，`-o` 写最后一条消息，`--json` 输出事件流，`--ephemeral` 不留会话，`--ignore-user-config` 隔离个人配置，`-s read-only` 沙箱。
- 另有 `codex mcp-server`（stdio）和实验性的 `app-server`。

阿萌已决定使用订阅额度，并接受与自用 Codex 共享。**仍待验证**（Phase 1 做一次真实调用即可回答）：

1. 高峰期会不会被限流、被限流时怎么降级；
2. OpenAI 条款对持续自动化角色运行的态度（官方把 `exec` 定位为脚本 / CI 用途，没有明说陪伴类常驻）；
3. mini 在 LaunchAgent 环境下，ChatGPT 登录凭据能否自动刷新、过期后怎么告警。

### Q5 Codex 环境里的 Elias 会不会人设偏移？

**会有风险，需要实测。** `codex exec` 会带上 Codex 自己的「编程 Agent」基础指令，并读取工作目录里的 `AGENTS.md`。缓解办法：

- 在专用空目录运行（不放 `AGENTS.md`），加 `--ignore-user-config` 和 `--ephemeral`；
- 用 `--output-schema` 把输出收成 `{ action: noop|message|task, text, reason }`，减少「汇报工作」式的口吻；
- 用自定义指令文件覆盖基础指令（具体配置键要在当前版本上确认，未验证前不写进契约）；
- 验收用盲测：同一组情境分别让 ChatGPT Elias 和 Codex Elias 回复，阿萌不看来源打分。

### Q6 Continuity State 字段够不够？哪些绝不能自动写成「已确认」？

企划列的字段够用于第一版。补两条：

- **fire_pack 不等于 Continuity State**。fire_pack 是 amsg 专用快照，格式带版本且跟上游契约耦合。Continuity State 单独存在 mini 的 SQLite，由前端从同源数据派生上传，不依赖 fire_pack 的格式。
- **后台产出的一律不能自动升级为 `user_confirmed` / `verified_transcript`**：心跳或后端生成的对阿萌状态的判断、从 MCP / 网页读到的内容、健康和位置推断，默认只能是 `inference` 或 `summary`；只有阿萌在界面上点了确认才升级。

### Q7 怎么防止角色在后台误执行现实操作？

现有防线只有一层：后台剔除 `destructiveHint: true` 的工具，这依赖 MCP 服务器自己标注。

新后端加一层 **EM 自己的工具级白名单**，按「角色 × 工具」三档：`foreground-only` / `background-read` / `background-write`。后端只认白名单，不认服务器的自我声明；新接入的工具默认 `foreground-only`。按阿萌的决定，新建提醒、日历事件归入 `background-write`；删除、智能家居、发帖、转账类永远不开放后台写。

### Q8 鉴权、租约、幂等有没有攻击面或竞态？

- **amsg 现存的待确认项**：amsg 的鉴权是一个可选的全局口令。**如果没配 `AMSG_SERVER_TOKEN`，所有端点都不设防**，包括会返回用户解密密钥的 `GET /get-user-key`。一键部署会自动生成这个口令，所以大概率是有保护的，但需要到 Cloudflare 面板确认它存在且类型是 Secret。
- **新后端**：每台设备一个可吊销的 Bearer 凭据（配对时发放），服务端只存哈希；管理接口与普通接口分权；凭据和 VAPID 私钥放 mini 的钥匙串或权限受限文件，不进仓库、日志、Engram、备份。
- 有副作用的任务必须带 `idempotency_key`；结果回写前端数据时，沿用 amsg 门牌整理那套「按对象加锁、按快照时刻比对」的做法（`mutatePlate`），防止覆盖阿萌在等待期间的本地修改。

### Q9 哪些能做成 EM 独立模块？

| 模块 | 位置 | 侵入上游 |
|---|---|---|
| 后端服务本体 | `server/agent-backend/`（新，与 `apple-events-bridge` 并列） | 无 |
| 任务契约、白名单等纯逻辑 | `utils/emAgentCore.ts`（新，环境无关叶子，前后端共用） | 无 |
| 前端连接与设置 | EM 独立页面，Settings 里一个入口 | 1 行入口 |
| 前端推送登记 | Service Worker 已有订阅，额外向新后端登记一份 | 需评估，尽量只加 1 处调用 |

## 4. 架构：纯 Mac mini 后端

```text
┌──────────────── 手机 / 电脑 / 平板（LiliumOS PWA）────────────────┐
│  聊天、IndexedDB（事实来源）、amsg 主动消息与即时聊天（不变）        │
└────────┬──────────────────────────────────────────────▲──────────┘
         │ HTTPS + 设备凭据                              │ Web Push（提醒）
         │ 同步 Continuity / 建任务 / 补收 outbox          │ outbox（送达保证）
         ▼                                              │
  Tailscale Funnel（已有，同一个私有代理入口）               │
         │                                              │
┌────────▼──────────────── Mac mini ─────────────────────┴──────────┐
│  agent-backend（Node，LaunchAgent 常驻，崩溃自动重启）              │
│   ├─ 调度器：jobs 表 + 租约 + 安静时段 + 醒后补课规则                  │
│   ├─ 心跳：每角色间隔、预算、冷却；可 NOOP                             │
│   ├─ 模型：Elias → codex exec；其他角色 → 各自 API（钥匙串取 Key）     │
│   ├─ 工具：白名单 → 本机 MCP（Apple Events 桥、HA MCP）              │
│   ├─ 推送：web-push（与站点同一对 VAPID），devices 表多设备           │
│   └─ 看门狗：HA 虚拟机健康检查 → utmctl 重启 → 失败推送通知阿萌        │
│  SQLite：jobs / outbox / devices / continuity / tool_audit        │
│                                                                   │
│  apple-events-bridge（已有）      UTM → HAOS 虚拟机（已有）          │
└───────────────────────────────────────────────────────────────────┘
```

### 4.1 故障边界

- 后端直接作为 macOS 进程运行，**不放进 UTM 虚拟机**。HA 起不来时后端照常工作，只是 HA 相关工具报告离线。
- 后端挂了或 mini 休眠时，LiliumOS 聊天和 amsg 主动消息完全不受影响；前端显示「后台休息中」，不当成报错。
- 后端不和 amsg 共享任何表、协议或版本号。

### 4.2 每日休眠（4:00–7:00）

- 这段时间设为全局安静时段，调度器不在其中安排任何唤醒。
- 醒来后按任务类型处理积压：心跳过期即丢，不补跑；阿萌交代的任务若仍在有效期内则补做；绝不连续弹出一串消息。
- 需要确认 LaunchAgent、Funnel 和 UTM 虚拟机在唤醒后都能自动恢复（见 4.5）。

### 4.3 推送

- 用 Node `web-push`，**必须使用与站点现有订阅同一对 VAPID 密钥**，否则 Apple / Google 推送服务会拒收（403）。
- 每台设备在新后端单独登记一行订阅，发送时发给所有有效设备；某台返回 404/410 就标记失效。
- outbox 是送达保证：推送丢了，前端下次打开时补收。

### 4.4 Home Assistant 与 UTM

- 在 macOS 上，HA 基本只能跑在虚拟机里。官方的 macOS 路线就是虚拟机里装 HAOS；而灯泡要用的 Matter 集成依赖 Matter Server，官方只在 HAOS 里支持。改用 Docker 也逃不掉：Docker 在 Mac 上本身就跑在一个 Linux 虚拟机里，还会丢掉 Matter 的官方支持。
- 真想彻底摆脱虚拟机，唯一干净的办法是换一台专用的小主机（如 Home Assistant Green），把 HAOS 备份恢复过去。LiliumOS 只需换地址和令牌（见 `home-assistant-mac-mini-plan.md` 第 4 节）。
- **与每日休眠有关的怀疑**：HA 方案文档要求「macOS 系统本身不要自动睡眠」，而 mini 现在每天 4–7 点休眠。宿主机休眠会把虚拟机挂起，唤醒后虚拟网络、时钟或磁盘状态恢复失败，是「有时能重启有时不行」的常见原因。**尚未验证**，要在 mini 上看 UTM 与 HAOS 日志确认。
- 看门狗：后端定期检查 HA 的 `/api/` 健康状态；连续失败时用 `utmctl` 尝试重启虚拟机；重启后仍失败就推送通知阿萌，不无限重试。

### 4.5 常驻与恢复

- LaunchAgent：`RunAtLoad` + `KeepAlive`，与 `apple-events-bridge` 的部署方式一致。
- 启动时：先把过期租约放回队列，再按 4.2 的补课规则处理积压。
- 自报健康：`GET /health` 返回版本、各依赖（Codex 登录、HA、Apple 桥、推送）状态，前端设置页据此显示，不靠「更新成功」判断。

### 4.6 备份

- SQLite 文件定期做一致性快照（`VACUUM INTO`），纳入 mini 的备份。
- 钥匙串中的凭据、VAPID 私钥、设备凭据不进入 LiliumOS 完整备份。

## 5. Phase 1 最小链路与成本

**Phase 1 只跑通一条链**：前端建一个测试任务 → mini 后端到点执行一个无副作用动作（读一次日历）→ 写入 outbox → 手机和电脑**都**收到测试通知 → 前端补收并 ack。另外在 mini 上做一次 `codex exec` 真实调用，回答 Q4 的三个未知。

**成本**：新增固定月费为 0。Mac mini 是已有硬件，只多一点电费；Tailscale 个人版免费；Codex 走订阅，风险在额度不在账单。现有 amsg 继续在 Cloudflare 免费额度内运行。

## 6. 阿萌的决定与待办

已决定（2026-09-22）：

- **纯 Mac mini 后端**，Cloudflare 上的 amsg 原样保留、不改动。
- **Elias 后台走 Codex 订阅额度**，与阿萌自用 Codex 共享额度可以接受。
- **后台低风险写入允许**：新建提醒、日历事件可在后台不经确认执行；删除、智能家居、发帖、转账类仍不开放。
- **每天 4–7 点 mini 休眠**，作为全局安静时段；本来就不需要角色在这段时间主动联系。

仍待办：

1. **Cloudflare 面板里 `AMSG_SERVER_TOKEN` 是否存在，并且是 Secret 类型。**
2. **在 mini 上排查 UTM 虚拟机重启不稳**，重点看是否与每日休眠有关（4.4）。
3. **在 mini 上复核**：Codex 登录状态、`codex exec` 实测、LaunchAgent 环境下的凭据刷新。
4. 细化接口与数据表设计（下一份文档）。
