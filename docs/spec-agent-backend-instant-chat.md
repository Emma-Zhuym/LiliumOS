# Mac mini 后端接手即时回复与主动消息排程 spec

> 2026-09-29 起草（Claude（小帕）），阿萌同日拍板（三个问题都按推荐）。**阶段一已实现**，阶段二、三待做。
> 目标：**PWA 被杀后台也能当场收到回复**；主动消息的排程搬到 mini，**以后不再需要 amsg（Cloudflare Worker）**。
> 设计参考：amsg 的即时对话 [`plans/amsg2-instant-chat.md`](../plans/amsg2-instant-chat.md) 与契约 [`plans/amsg2-instant-chat-contract.md`](../plans/amsg2-instant-chat-contract.md)。
> 我们照搬它「发完就自由、云端跑、推送回来、本地后处理」的形状，但不搬它的加密信封、D1、Durable Object。

## 现状（2026-09-29 查过）

- **后端已经能推送**：`server/agent-backend/push.mjs` 用与站点同一对 VAPID，阿萌的 iPhone 已登记（`devices.push_status = active`），
  最近两天心跳的 46 条消息都经 Apple 推送成功（201）。推送丢了有 `/outbox` 信箱兜底。
- **Service Worker 对所有推送一视同仁**：`@rei-standard/amsg-sw` 收到任何推送都交给 `worker/sw-keep-alive.ts` 的
  `saveIncomingActiveMessage`，按 `messageKind` 分流；`content` 且带 `metadata.charId` 的会写进 ActiveMsg 收件箱，
  页面上 `flushInboxToChat`（`utils/activeMsgRuntime.ts`）跑完整的后处理（拆气泡、表情、SEND_PHOTO、引用、记忆宫殿、打字节奏）。
  **所以后端只要按 amsg 的推送形状发，手机端收回复这一半几乎不用写。**
- 现在后端心跳的推送是 `{title, body, url}`，没有 `charId`，SW 只弹通知、不进收件箱；正文靠打开 App 时拉 `/outbox`（`utils/emAgentInbox.ts`）直接存成纯文本消息，不走后处理。

## 阶段一：即时回复（核心）

### 手机端（`hooks/useChatAI.ts` + 新文件 `utils/emAgentChat.ts`）

- 设置里加开关「聊天交给 Mac mini 回复」（放在「Mac mini 后端」面板，EM 独有文件），配对过才可开。
- 路由优先级：**mini 即时回复 > amsg 即时对话 > 本地生成**。沿用 amsg 那几道否决：瑞幸点单、需要本机工具的这一轮（位置工具等）照旧本地生成。
- 发送前做一次 3 秒内的健康探测（有 30 秒冷却，照 `resolveInstantChatReadiness`）；mini 不在（4–7 点休眠、断网）→ 这一轮回落本地生成，不报错。
- 请求体 = 本地生成**那一轮原本要发的全部内容**：`messages`（fullMessages，含 system）、`temperature`、`max_tokens`、`extraBody`（思考链三件套），
  外加 `charId`、`turnId`（uuid，幂等键）、`supersedes`（连发时顶掉上一条还没开跑的）。
  时间、天气等时效段本地已经烤进去了——生成是立刻开始的，不需要像 amsg 定时任务那样到点再填。
- API 凭据：**每轮随请求带**（`baseUrl` / `model` / `apiKey`，走 Funnel HTTPS + 设备 token），后端只在内存里用，**不落库、不进日志**。
  理由：聊天可能用角色专属预设（`chatApiPresetId`），跟心跳那份 credRef 不一定是同一个。
- 「正在输入…」：本地记一条待收（charId → turnId，存 localStorage，重开 App 还在）；推送到了或信箱里拉到了就熄灭。
  每 60 秒问一次 `GET /chat/turns/:turnId`，只有后端明确说失败才熄灯 + 落系统消息 + 可重发（照 `failInstantChatPending` 的口径）。
- 回复落地：推送经 SW 进收件箱，走现成后处理。推送丢了：打开 App / 回前台时拉 `/outbox`，把 `chat_reply` 按 `outboxPushToInbox` 同款映射塞进收件箱，按 `messageId` 去重。
- 「API 调用记录」照 `recordCloudApiCall` 记一笔，路线标「mini」。

### 后端（`server/agent-backend/`）

- `POST /agent/v1/chat/turns`：校验设备 token → **先落 `jobs`（kind `chat_turn`，`max_attempts` 2）再回 202** → 立刻执行。
  进程被杀、mini 重启：jobs 表的 lease 过期后重跑（现有调度器已有这套）。凭据只在内存，重跑时拿不到 → 该轮标失败，让手机重发。
- 执行：`runner` 新增「原样透传」模式——messages / temperature / max_tokens / extraBody 一字不改地发 `/chat/completions`，不套心跳的 JSON schema。
- 结果：写 outbox（kind `chat_reply`，payload 为 **amsg content 推送形状**：`messageKind:'content'`、`messageId`、`message`（模型原文）、
  `contactName`、`messageType:'instant'`、`timestamp`、`metadata:{charId, charName, source:'agent-backend', turnId, usage}`、
  `notification:{title, body, tag}`），然后推送。
- 推送正文上限约 4KB：超了就只推一个「去取」的短载荷（`messageKind:'content'` 但 `message` 为空 + `metadata.pullOutbox:true`），手机收到后立刻拉 `/outbox`。
  不照搬 rei 的 multipart 分片——多一套重组状态机不值得。
- 通知：同一角色同一个 `tag` 折叠；页面可见时静音（照 amsg `silent:'when-visible'` 的写法，施工时对照 `worker/amsg/src/agentic.ts` 的 `buildScheduledPush`）。
- 失败：写 outbox 一条 `messageKind:'error'`（带 `turnId`、`reason`）并推送，手机端当场收尾。
- **和心跳对账**：`unreadFromUser` / `lastChatMessageAt` / `unansweredProactive` 把 `chat_reply` 也算作「TA 回过」；
  这一轮正在跑时心跳不插话（`speakBlock` 加一道 `chat_turn_running`）。
- 情绪评估：阶段一**不上 mini**——回复落地后本地后处理里照常跑（页面活着时）。被杀后台的那一轮会漏评估一次，可接受；阶段三再搬。

## 阶段二：主动消息排程搬到 mini

amsg 的排程有两个来源，都要接：

1. **面板排的**（用户在主动消息面板给角色定时 / 重复）：`ActiveMsgClient.scheduleCharacterTask`。
2. **角色自己排的**：fire 里的排程工具（`AMSG_FIRE_SCHEDULE_TOOL` / 取消 / 续期）。

做法：

- 后端 `jobs` 加 kind `scheduled_message`，支持一次性与重复（复用 amsg 的 `ActiveMsg2Recurrence` 语义）；到点生成，结果同样写 `chat_reply` 推送（`messageType:'auto'`）。
- **fire_pack 复用前端现成的**：前端已经会给每个角色烤 fire_pack（`syncCharFirePacks`，含提示词模板与时效槽位）。
  加一个目标 `PUT /agent/v1/fire-packs/:charId`，后端到点用 `utils/amsgFirePack.ts` 的填槽逻辑（用 esbuild 打进后端，**不手抄一份**）填时间、对方时钟、场景。
  天气 / 热搜这些 amsg 在 worker 里现取的（`realtimeWorld.ts`），第一版不做，槽位留空。
- 角色自排工具：给 `scheduled_message` 的生成开一个最小工具循环，只开「排 / 取消 / 续期」三个工具，额度照 `MAX_FIRE_SCHEDULES`。
- 面板：主动消息面板在开了「交给 mini」时读写后端的任务列表（新接口 `GET/POST/DELETE /agent/v1/schedules`），不再连 amsg。
- 迁移：打开开关时列出 amsg 上还挂着的任务，**阿萌确认后**在 mini 重建、在 amsg 取消；不静默搬。
- 和心跳的关系：排程消息算「主动发出的一条」，心跳的冷却、连发没回退避照常算它。

## 阶段三：退役 amsg

- 设置里 amsg 相关配置在「交给 mini」开着时整块收起（不删上游代码，合并友好）。
- 情绪评估、后台 MCP 工具循环（mini 本机就能连 Home Assistant、Apple 日历桥、小红书）按需搬过来。

## 本次不做

- 流式输出（和 amsg 一样：没有逐字吐出，只有「正在输入…」）。
- 群聊、见面、通话、七夕等活动的生成路径——只接私聊。
- 改 amsg worker 或 `@rei-standard/*` 包。
- 多用户：mini 只服务阿萌自己的设备。

## 已拍板（2026-09-29）

1. mini 不在时回落本地生成。
2. API Key 随每轮请求带，mini 只在内存里用。
3. 阶段二的天气 / 热搜槽位第一版留空。

## 阶段一实现备注

- 聊天任务的 `jobs.char_id` 留空：那一列外键要求角色在后端登记过（只有开了心跳的才登记），角色 id 放 `input.charId`，串行靠 `serializeGroup`。
- 信箱表加了 `chat_reply` / `chat_error` 两种（迁移 10，重建表时先挪开 deliveries 防级联删除）。
- 即时回复不受 0–7 点安静时段限制（`QUIET_EXEMPT_KINDS`）。
- 请求体上限只对 `/chat/turns` 放到 16MB（带图）。

## EM 惯例

- 前端新逻辑放 EM 独有文件（`utils/emAgentChat.ts`、`utils/emAgentSchedules.ts`），`useChatAI.ts` 只加一处路由判断 + 哨兵 `[EM-START: agent-instant-chat]`。
- 后端新文件 `server/agent-backend/chatTurns.mjs`、`schedules.mjs`；测试用内存库 + 假 fetch。
- `scripts/check-em-patches.sh` 加锚点；做完写 changelog、roadmap「做了，等验收」。
- 凭据、聊天正文不进后端日志；`model_runs` 只记用量与耗时。

## 验收

- 发一句话后立刻锁屏 / 杀掉 PWA，十几秒到一分钟内收到通知，点开时回复已按打字节奏在聊天里（表情、发图、引用正常）。
- 开着页面发，体感和本地生成一样，只是没有逐字吐出。
- 连发两句，只回一次、两句都接住。
- mini 停掉时发消息，自动回落本地生成，不报错。
- 推送故意丢掉（关通知权限），重开 App 能补收，不重复。
- 心跳不会在这一轮进行中插话，也不会把刚回过的消息再回一遍。
- （阶段二）面板排的定时消息、角色自己说「明早八点叫你」，到点都由 mini 发出；amsg 关掉后照常。
