# LiliumOS 私人 Agent 后端 · Phase 0 现状审计

> 状态：只读审计，未改功能代码
>
> 日期：2026-09-22（main @ `2513d55d`）
>
> 对应企划：[`personal-agent-backend-proposal.md`](./personal-agent-backend-proposal.md) 第 14 节 Phase 0、第 16 节审查问题

## 0. 结论先行

1. **主动消息 2.0 Worker 已经是一个成熟的「云端调度 + 推送」内核**：D1 任务表带租约领取、续租心跳、分组串行、重试退避、时区循环、推送 + 收件箱双通道送达、按角色的加密凭据引用、后台非聊天任务注册表。企划里 Cloud Coordinator 要的东西，大约七成已经存在。
2. **但它的主体是上游代码**（`worker/amsg/src/index.ts` 3140 行，57 次提交来自上游作者 Tosd0，EM 零哨兵）。直接往里长 Coordinator 功能，会重演 2026-08-18 心跳版「加进去当天整体撤回」的局面，并让每次上游合并都痛苦。
3. **云端 Worker 今天就能在后台直连 Mac mini 上的 MCP**（Apple Calendar / Reminders 经 Tailscale Funnel），不需要 Runner。所以 Mac Runner 的真实价值收窄为：**订阅模型（Codex）、超过 Worker 时限的长任务、只能在本机跑的东西（浏览器自动化、本地文件、钥匙串凭据）**。
4. **Codex 非交互调用在技术上可行**：Codex.app 自带 CLI 0.142.5，已用 ChatGPT 账号登录，`codex exec` 支持 `--json`、`--output-schema`、`--ephemeral`、`--ignore-user-config`、只读沙箱。剩下的是额度、条款和人设一致性问题，不是能不能调的问题。
5. **推荐形状**：不扩上游 Worker，另起一个 EM 独有的小 Worker（绑定同一个 D1，只管 Runner 任务队列），Mac Runner 出站轮询领任务，结果要通知手机时反过来调用 amsg 已有的 `/schedule-message` 建一条立即到期的任务，白拿推送与收件箱。详见第 4 节。

## 1. 当前真实数据流

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

### 1.1 D1 表

| 表 | 作用 | 可否复用给 Runner |
|---|---|---|
| `scheduled_messages` | 加密任务行；`lease_until` / `retry_after` / `serialize_group` / `retry_count` / `last_error`；`uuid` 唯一索引做幂等 | **模式可照抄**，行本身不适合：到点会被 amsg cron 直接消费并调 LLM，Mac 没有插手的位置 |
| `client_state` | (user, namespace, key) → 加密值，可按 namespace 配 TTL | 可放 Runner 需要读的角色快照；无租约，不能当队列 |
| `message_outbox` | 推送的持久副本，客户端补收后 ack | 直接复用（经 amsg 建任务间接写入） |
| `llm_credentials` | 每角色 API 凭据密文 | Runner 若走普通 API 可复用；Codex 通道不需要 |
| `push_subscriptions` | 单条浏览器订阅 | 经 amsg 间接复用 |

### 1.2 已经有的可靠性机制（Runner 队列直接照抄）

- **领取**：`UPDATE … SET lease_until=? WHERE id=? AND status='pending' AND next_send_at=<读到的原值> AND (lease_until IS NULL OR lease_until<=now)`，靠 `changes > 0` 判定是否领到。排期被改过、别人拿着、已结束都会自然领取失败。
- **续租**：执行中每 30s 续一次，租期 90s；进程死掉 90s 后可被重新领取。
- **分组串行**：`serialize_group` + `NOT EXISTS` 子查询，同组同时只跑一条（EM 已用 `charId#kind`，后台任务不挡聊天）。
- **幂等**：任务 `uuid` 唯一索引；outbox `(user_id, message_id)` 唯一。
- **重试**：`retry_after` 与租约分开存，失败退避，`last_error` 有脱敏明文摘要。

## 2. 已经做完、企划里还写着「待做」的部分

| 企划中的需求 | 现状 |
|---|---|
| 页面关着也能按时唤醒 | ✅ cron 每分钟 |
| 每角色独立 API | ✅ `chatApiPresetId` + credRefs 上云 |
| 后台调用获准 MCP | ✅ Worker 直连公网 MCP（含 mini 的 Apple Events 桥） |
| 后台工具的危险操作拦截 | ⚠️ 部分：后台只剔除 `destructiveHint: true` 的工具（`utils/mcpClient.ts:254`）；**新建/修改类**（如新建日历事件、提醒）若服务器没标注为 destructive，后台可无人确认执行 |
| 推送 + 离线补收 | ✅ Web Push / FCM + outbox |
| 「唤醒不等于发消息」 | ✅ 后台任务 `skip-push`、`notification.show=false` 只落账本 |
| 心跳 | ❌ 8-18 做过完整一版（滚动一次性任务、代次控制、睡眠硬闸、NOOP 静默、确定性抖动），同日 `25399fad` 整体撤回。原因不是心跳逻辑本身，而是它牵连了共用链路（见 2.1） |

### 2.1 8-18 心跳撤回的根因（2026-09-22 与 GPT 侧记录核对）

心跳调度算法本身没有被证实有问题。撤回是因为它接进 amsg 共用后端之后，暴露出两处会影响正常聊天的链路问题：

1. **前端与 Worker 版本对不上。** 心跳用的是新版 `fire_pack v8`，但一键部署（`utils/cfProvision.ts:25`）和 Worker 自更新（`worker/amsg/src/selfUpdate.ts:26`）都从上游 `Tosd0/sullyos-workers` 拉代码。界面显示「更新成功」，云端实际跑的仍是不认识 v8 的上游版本，于是所有依赖 fire_pack 的云端生成都失败。**这两处至今仍指向上游。**
2. **推送只能到一台设备。** `push_subscriptions` 以 `user_id` 为主键，单用户只有一条订阅，桌面端后登记就会覆盖手机。手机把即时聊天交给云端后，只看到任务结束，拿不到回复正文。当时补过「发送前重新登记当前设备」，但整条链路已经不够可信。**表结构至今未变。**

回滚撤掉了心跳、`fire_pack v8` 和相关设置，并清理了云端残留的隐藏心跳任务；普通主动消息和即时聊天保留。

**对本方案的约束：**

- 任何需要 EM 版本 amsg Worker 才能工作的功能，都会被自更新或一键部署静默换回上游版本。这是 Q1 选择「旁挂」的第三条理由，而且是最硬的一条。
- Runner 和心跳要通知手机时，不能假设 `push_subscriptions` 里那一条就是手机。要么在旁挂 Worker 里另存多设备订阅，要么只把 outbox 当作送达保证、推送只作提醒。
- 云端协议要升级时，旁挂 Worker 必须自己报告版本，前端按实际运行的能力判断，不看「更新成功」的提示。
| Mac Runner / 任务队列 | ❌ 无 |
| 连续性状态 / ChatGPT 侧 MCP | ❌ 无（fire_pack 是 amsg 专用的聊天快照，不是跨入口状态） |
| 设备级凭据 | ❌ 只有一个可选的全局 `AMSG_SERVER_TOKEN` |

## 3. 第 16 节九问的回答

### Q1 amsg2 扩成 Coordinator，还是旁挂独立服务？

**旁挂。** 理由：

- `index.ts` 是上游高频改动文件，EM 哨兵为零；心跳那次的 diff 在它和 `activeMsgClient.ts` 上各加了 200+ 行。按架构原则第 2、3 条，这类改动应该落在独立文件。
- 调度内核本身在 npm 包 `@rei-standard/amsg-server` 里，EM 改不了；只能通过 hook 插业务。而 hook 的形状是「到点 → 在 Worker 里调 LLM → 出结果」，没有「到点 → 交给外部执行器 → 等回执」这一步。
- 旁挂服务可以**绑定同一个 D1**（表名加 `em_` 前缀），需要推送时调用 amsg 现成的 `/schedule-message`，不需要自己管 VAPID 或订阅。

- 最硬的一条：amsg 的一键部署和自更新都从上游仓库拉 bundle（见 2.1）。放进 amsg 的 EM 功能随时可能被静默换掉，8-18 心跳正是这样出的事。

~~例外：纯云端心跳放回 amsg 用 fireKinds 加一种 kind~~——不再推荐，理由同上。心跳也放进旁挂 Worker，由它的 cron 驱动。

### Q2 D1 够不够？要不要 Queue / DO / Workflows？

**D1 够。** 单用户、三台设备、预期每天几百到几千次任务读写，远低于免费额度（每日 500 万次读、10 万次写）。租约、幂等、串行三件事 amsg 已经用 D1 条件 UPDATE 验证过。amsg 已经为即时对话用了一个 Durable Object（15 分钟墙钟），Runner 队列不需要。Queues 和 Workflows 不引入。

### Q3 Mac Runner 用轮询、长连接还是 Tunnel？

**任务领取用出站轮询**（空闲 30s 一次，有活时立刻再领）。每天约 2900 次请求，在免费额度内；mini 离线时任务留在 D1，回来接着领，天然满足验收第 1、2 条。

注意：mini **已经**通过 Tailscale Funnel 对公网暴露了一个带 Bearer 的 HTTPS 服务，云端 → mini 的路其实是通的（Worker 后台调 Apple MCP 就走这条）。所以「工具调用」继续走 Funnel 直连，「任务领取」走轮询，两条路各司其职，不需要再加 Cloudflare Tunnel。

### Q4 订阅认证运行器有没有稳定的调用入口？

**有，技术上已确认**（在 MacBook 上检查，mini 待复核）：

- `/Applications/Codex.app/Contents/Resources/codex`，`codex-cli 0.142.5`，`codex login status` → 已用 ChatGPT 登录。
- `codex exec` 非交互；`--output-schema <FILE>` 可以强制结构化输出，`-o` 写最后一条消息，`--json` 输出事件流，`--ephemeral` 不留会话，`--ignore-user-config` 隔离个人配置，`-s read-only` 沙箱。
- 另有 `codex mcp-server`（stdio）和实验性的 `app-server`。

**仍待验证**（Phase 1 做一次真实调用即可回答）：

1. 消耗的是不是和阿萌自己用 Codex 共享的同一份额度，高峰期会不会被限流；
2. OpenAI 的条款是否允许把订阅账号用于持续的自动化角色运行（官方把 `exec` 定位为脚本 / CI 用途，但没有明说角色陪伴类常驻）；
3. mini 无人登录图形界面时，ChatGPT 登录凭据能否自动刷新、过期后怎么告警。

### Q5 Codex 环境里的 Elias 会不会人设偏移？

**会有风险，需要实测。** `codex exec` 会带上 Codex 自己的「编程 Agent」基础指令，并读取工作目录里的 `AGENTS.md`。缓解办法：

- 在专用空目录运行（不放 `AGENTS.md`），加 `--ignore-user-config` 和 `--ephemeral`；
- 用 `--output-schema` 把输出收成 `{ action: noop|message|task, text, reason }`，减少「汇报工作」式的口吻；
- 用自定义指令文件覆盖基础指令（具体配置键要在当前版本上确认，未验证前不写进契约）；
- 验收用盲测：同一组情境分别让 ChatGPT Elias 和 Codex Elias 回复，阿萌不看来源打分。

### Q6 Continuity State 字段够不够？哪些绝不能自动写成「已确认」？

企划列的字段够用于第一版。补两条：

- **fire_pack 不等于 Continuity State**。fire_pack 是 amsg 专用的聊天快照，格式带版本（v7/v8）并且跟上游契约耦合。Continuity State 应该单独存（`em_continuity`），由前端从 fire_pack 同源数据派生，不反向依赖 fire_pack 的格式。
- **后台产出的一律不能自动升级为 `user_confirmed` / `verified_transcript`**：心跳或 Runner 生成的对阿萌状态的判断、从 MCP / 网页读到的内容、健康和位置推断，默认只能是 `inference` 或 `summary`；只有阿萌在界面上点了确认才升级。

### Q7 怎么防止角色在后台误执行现实操作？

现有防线只有一层：后台剔除 `destructiveHint: true` 的工具。这依赖 MCP 服务器自己标注，而新建、修改类操作通常不会被标成 destructive。

建议加一层 **EM 自己的工具级白名单**，按「角色 × 工具」三档存：`foreground-only`（默认）/ `background-read` / `background-write`。Worker 和 Runner 都只认白名单，不认服务器的自我声明。新接入的工具一律默认为 `foreground-only`。智能家居、发帖、转账类永远不开放 `background-write`。

### Q8 鉴权、租约、幂等有没有攻击面或竞态？

- **需要确认**：amsg 的鉴权是一个可选的全局口令。**如果没配 `AMSG_SERVER_TOKEN`，所有端点都不设防**，包括 `GET /get-user-key`，它会返回解密 D1 数据用的用户密钥。一键部署（`utils/cfProvision.ts`）会自动生成这个口令，所以正式部署大概率是有保护的，但需要到 Cloudflare 面板确认 Secret 存在，并且类型是 Secret 而不是 Text。
- Runner 不应复用这个全局口令去领任务：单独给 Runner 发一个可吊销的凭据，存在 mini 的钥匙串里。
- 租约和幂等照抄 amsg 的模式即可（见 1.2）。有副作用的 Runner 任务必须带 `idempotency_key`，完成回执要求携带领取时的 `lease_token`，防止超时后被重领、两份结果先后落地。
- 已知竞态：amsg 文档里记录过「提交到落地之间数据被本地改动」的问题（门牌整理的三张对照表）。Runner 回写前端数据时会遇到同样的问题，结果落地必须复用 `mutatePlate` 那种按对象加锁、按快照时刻比对的做法。

### Q9 哪些能做成 EM 独立模块？

| 模块 | 位置 | 侵入上游 |
|---|---|---|
| Runner 任务队列 Worker | `worker/em-runner-hub/`（新） | 无 |
| Mac Runner 本体 | `server/agent-runner/`（新，与 apple-events-bridge 并列） | 无 |
| 任务契约、白名单纯逻辑 | `utils/emRunnerCore.ts`（新，环境无关叶子） | 无 |
| 前端设置面板 | `apps/` 下 EM 独立页面或 Settings 一个入口 | 1 行入口 |
| 心跳 | 放进 `worker/em-runner-hub/`，不放 amsg（见 2.1） | 无 |

## 4. 建议的 Phase 1 形状（待细化）

```text
手机 / 电脑 ──建 Runner 任务──▶ em-runner-hub Worker ──D1: em_runner_jobs──┐
                                                                         │
Mac mini Runner（launchd 常驻）◀── 出站轮询 claim / renew / complete ───────┘
   │  codex exec（仅 Elias）或 角色普通 API
   │  本地 MCP / 浏览器 / 钥匙串
   │
   └── 需要通知手机 ──▶ amsg POST /schedule-message（fixed，立即到期）
                         └─▶ 现有 Web Push + outbox，一分钟内送达
```

Phase 1 验收只跑通这一条最小链路：建测试任务 → mini 领取 → 执行一个无副作用动作（例如读一次日历）→ 回写 → 手机收到一条测试通知。另外单独做一次 `codex exec` 真实调用，回答 Q4 的三个未知。

## 5. 成本

目前实际花费约为 0：amsg 已经在跑，D1 和 Workers 都在免费额度内。Runner Hub 每天增加约 3000 次请求，仍在免费额度内。只有需要 Durable Object 以外的付费能力、或者请求量上涨时，才需要 $5/月的付费计划。Codex 走订阅，没有额外费用；风险在于额度，不在于账单。

## 6. 阿萌的决定与待办

已决定（2026-09-22）：

- **Elias 后台走 Codex 订阅额度**，与阿萌自用 Codex 共享额度可以接受。
- **后台低风险写入允许**：新建提醒、日历事件这类操作，角色可在后台不经确认执行。Q7 的白名单据此把它们归入 `background-write`；删除、智能家居、发帖、转账类仍不开放。

仍待办：

1. ~~8-18 心跳撤回的根因~~ → 已查明，见 2.1。由此得出的硬性要求：**心跳或 Runner 失败不能拖垮普通聊天和本地主动消息的生成**（与 home-assistant-mac-mini-plan P4「心跳旁路化」一致）；**新功能不能依赖一份会被自更新换回上游的 Worker**。
2. **Cloudflare 面板里 `AMSG_SERVER_TOKEN` 是否存在，并且是 Secret 类型。**
3. **本次审计在 MacBook 上完成**；Runner 部署、`codex exec` 实测和 mini 上的登录状态需要在 mini 上复核。
4. **多设备推送怎么做**（见 2.1 第 2 条），细化方案时决定。
