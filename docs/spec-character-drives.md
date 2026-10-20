# 角色更「活」· 契机池与心思系统 spec

> **叫法**：2026-10-20 起界面和文档统一叫「心思」（阿萌嫌「劲儿」难听），之前的提交和改动日志里叫「劲儿」；代码里一直是 `drives`（`drives.mjs`、`drive_ledger`、`drives_trial`），没改名。

> **实施状态（2026-10-14）：第一阶段已做并上线（第 4 节 + 第 6 节的草稿箱和屏幕时间）；第二阶段（契机池）在分支 `feat/char-drives-cue-pool` 上做，未合并（2026-10-20 修：抽中的念头只拼进这一轮的那一份提示词，本机主动消息、小小窝、彼方再拼同一个角色时不带）；第三、四阶段未开始。** 本文档是交接用的执行规格。
> 第一阶段落地要点：话兜在 `server/agent-backend/pocket.mjs`（迁移 11，同时给 `model_runs` 加了 `reach_reason`）；
> 开口缘由、读回生活、她那边的事在 `reachOut.mjs`；`runner.mjs` 的 `parseLife` / `parseEpisode` 保留 `tellLater`（礼物不留）；
> 手机端 `utils/emAgentPocket.ts`（缓存）、`components/checkphone/DraftsWidget.tsx`、`utils/emScreenTime.ts`，查手机里三处哨兵。
> 没有工具判断不了的那条「缘由用没用上」第一阶段不记，只记抽了什么。
> **第二阶段（本分支，未合并）落地要点**：`utils/emCuePool.ts`（纯逻辑：掷不掷、按权重抽、冷却、本机记账 `em_cue_state_v1`、这一轮的念头）、
> `utils/emCueProviders.ts`（四个来源：账本 / 冰箱 / 日历 / 他自己的生活，各一个纯函数 + 读数据；`rollChatCue` 每轮发送前调一次）。
> 接线三处：`useChatAI.ts` 路由算完后 `await rollChatCue(...)`、查账工具执行后 `noteCueToolUse`；`chatPrompts.ts` volatileState 一行。
> 朋友圈、天气、约定本来就每轮在提示词里，不另做来源；健康按第 9 节未定，不接。
> 第一版另加了「两个念头至少隔 30 分钟」，免得连着两轮都在闪。worker 打包不含这段改动（已核对 amsg bundle 只有路径注释差异），合并后不用重打 worker。
> **验收**：合并后在手机上聊二三十轮，控制台看 `💭 [Cue]`；`localStorage.em_cue_state_v1` 里各来源都应出现过，同一件事 3 天内不重复。
> 来源：`docs/ideas.md`「角色更「活」」一节，阿萌与小帕 2026-10-14 当面讨论。
> 那一节记的是讨论过程和取舍理由，这份只写「怎么搭」；两边冲突时以这份为准。

## 0. 要解决的两件事

1. **聊天里不会灵光一现**：角色不会突然想到「我来看看你这个月的账本」。工具按关键词递进来，没命中就不存在；
   就算递了，模型也几乎不会无缘无故去用。
2. **心跳只接上一轮对话**：发来的消息不分享自己的日常。原因见下面第 4 节开头，**不是角色没有日常，是日常没递到开口的那一跳**。

阿萌的约束：**不加人工规定**。区分清楚——
- **规定**：「聊到钱就查账」。这类不要
- **契机**：「你刚好想起她这个月好像买了挺多东西」。说、做、不理都由角色定
- **心思**：程序里会涨会落的数值，只决定「抽到什么契机的概率」，模型永远看不到数字，只看到一句感受

贯穿全项目的那条规律照旧：**凡是交给模型判断「要不要做 X」的，它都会选不做**。所以「做不做、做哪类」由程序抽，模型只负责写得像这个人。

---

## 1. 名词

| 词 | 意思 |
|---|---|
| **契机**（cue） | 一条「此刻闪过的东西」：一句已经读好的只读摘录 + 来源 + 可选的工具组。程序抽，模型可以不理 |
| **契机来源**（provider） | 能产出契机的地方：她的账本、冰箱、日历、他自己的生活、旧记忆…… |
| **话兜**（pocket） | 他攒着、还没跟她说的话。过日子那一跳顺手写一句，开口那一跳拿出来 |
| **心思**（drive） | 0–1 的内在数值，9 种，见第 5 节 |
| **事件标签**（label） | 副 API 给一轮聊天打的标签（冷淡、示弱、失约……），只说她做了什么，不带数字 |
| **脾气读数**（temperament） | 每个角色一张：各种心思的基线、敏感度、回落快慢、压力出口、哪几种不适用。三档，不用小数 |
| **心思账**（ledger） | 每次心思变化一行：何时、哪种、变多少、来源、一句人话理由。**验收全靠它** |

---

## 2. 总图

```
┌──────────────── 手机（浏览器）────────────────┐          ┌──────────── Mac mini 后端 ────────────┐
│                                               │          │                                       │
│ 聊天一轮 ─→ 副 API 情绪评估                    │ 事件标签  │  drives.mjs 心思引擎（唯一真相）        │
│             └ 顺风车段：事件标签 + 原话依据 ───┼─────────→│   drive_state / drive_ledger          │
│                                               │ POST     │        │ 权重                          │
│ 契机池（本地抽）←── 心思摘要缓存 ←─────────────┼──────────┤        ▼                               │
│   │  来源：账本 / 冰箱 / 健康 / 天气 / 朋友圈   │ GET      │  heartbeat.mjs                        │
│   ▼                                           │ /drives  │   开不开口 × 心思                      │
│ 一行「你脑子里闪过…」+（本地生成时）工具组      │          │   做哪类生活小事 × 心思 × 饥饿度        │
│                                               │          │   开口时抽「为什么想起 ta」（契机）      │
│ 查手机：状态小组件 / 草稿箱 / 屏幕使用时间 ←────┼──────────┤   话兜 pocket ← 过日子那跳的 tellLater  │
│                                               │          │   做完了 → 满足 → 心思回落              │
│ 脾气读数（神经链接里确认）── 随快照上传 ───────┼─────────→│                                       │
└───────────────────────────────────────────────┘          └───────────────────────────────────────┘
```

**数值只在 mini 上算**。手机只做两件事：把事件标签送上去，把摘要拿回来缓存。
mini 不在线时：聊天的契机池退回固定权重，查手机组件显示上次缓存（标注时间），别的照常。

---

## 3. 契机池

### 3.1 来源清单

每个来源实现同一个接口（手机端 TS、mini 端 mjs 各自实现，契约相同）：

```ts
interface CueProvider {
  id: string;                     // 'finance' | 'kitchen' | 'calendar' | ...
  drive: DriveKey;                // 主要喂哪种心思（抽签加权用）
  available(char): boolean;       // 角色开了这项、数据存在、可见性允许
  glimpse(char, now): Promise<Cue | null>;
}
interface Cue {
  source: string;
  dedupeKey: string;              // 同一件事不重复闪（如「2026-10 账本」「冰箱·牛奶快过期」）
  text: string;                   // ≤120 字的现成摘录，已经按可见性裁过
  toolGroup?: 'finance' | 'health' | 'kitchen' | ...;  // 本地生成时可顺带递的工具组
}
```

| 来源 | 在哪读 | 喂哪种 | 隐私边界（沿用现有规矩） |
|---|---|---|---|
| 她的账本 | 手机 FinanceDB；mini 读快照里的 7 天摘录 | 好奇 / 挂心 | 不猜用途，转账不算消费（`financeChatTools.ts` 已有口径） |
| 她的冰箱 | 手机 `LiliumOS_Kitchen` | 挂心 / 好奇 | 只读，「故事里的饭 ≠ 现实冰箱」（ideas 厨房一节） |
| 她的健康 | 手机，只用常驻的轻量摘要 | 挂心 | 生命体征不进，跟 `healthContextBuilder` 同口径 |
| 她的日历 | mini `temporal_items` | 挂心 | 按可见性裁，`busy` 档只剩「有安排」 |
| 她的朋友圈 | 两边都有 | 想你 / 好奇 | 已有 `buildMomentsChatInjection`，契机只挑一条 |
| 天气 | 手机 `realtimeContext` | 好奇 | 无 |
| 他自己的生活 | mini `model_runs.episode`、`life_threads` | 社交 / 想你 | 手机端要读得经 GET 拿 |
| 旧记忆 | 手机记忆宫殿 | 回味 | **上游已经有反刍**：`priming.ts` 的 `checkRumination` 按反刍倾向 ×0.2 把阁楼记忆混进召回。契机这边不重复做，第一版不接这个来源 |
| 刷到的东西 | mini 小红书首页 | 好奇 | 已有，心跳那边才有 |

**定位永远不当来源**。写操作（开灯、记账、建提醒）永远不进契机。

### 3.2 抽签（纯函数）

```
pickCue({ providers, weights, cooldowns, now, rng }) → Cue | null
```

- 权重 = 来源对应那种心思的当前值（没有心思数据时用固定值）
- 同一来源冷却：聊天里 6 小时内不重复，同一 `dedupeKey` 3 天内不重复
- 先掷「这一轮有没有契机」，再在可用来源里按权重抽一个
- rng 可注入，测试钉死

### 3.3 聊天里怎么用

- **频率**：初始约每 10 轮一次（`CHAT_CUE_CHANCE = 0.1`），按心思总张力上下浮动，封顶 0.2。阿萌还没最后定，先按这个
- **不抽的时候**：点单流程（瑞幸 / 麦当劳）进行中、这一轮已经命中了某个工具话题（她自己在聊钱，不需要再闪）
- **摆法**：放进 volatileState，一行。措辞是感受，不是指令：
  > （你脑子里闪过：她这个月外卖好像点得比平时多，光上周就五单。想不想提、怎么提，看你此刻的心情和你们在聊什么；不想提就当没看见。）
- **摘录是预先读好的**，所以不需要工具循环，交给 mini 即时回复那条路也能用。
  **契机不拦即时对话**（不加进 `instantChatVeto`），这一轮该去哪还去哪
- **本地生成时**，契机带的 `toolGroup` 一并递进去，他想细看可以真去查
- **记账**：每次抽中记一行（来源、dedupeKey、时刻、走的哪条路）。有工具组且真调用了的，记「用了」。
  没有工具的契机判断不了用没用，只记抽中

### 3.4 心跳里怎么用

心跳的契机就是**「这次为什么想起 ta」**，只在 `reach_out` 那一跳抽（见 4.3）。

---

## 4. 心跳改动（第一阶段，不依赖心思）

### 4.1 现在为什么只接上一轮（读代码查到的）

`server/agent-backend/heartbeat.mjs`：
- 生活小事只在 `live` 跳写，提示词还要求「不要提到对方」；`reach_out` 跳不生成新事（`buildPrompt` 里 `intent !== 'reach_out'`）
- `reach_out` 能回看的只有 `recentThoughts`：12 小时、最多 4 条、只有 40 字 activity + reason。`model_runs.episode` 里完整的生活片段没被读回
- 最近对话是提示词里最详细的一块，规则又写「贴着你们之间还没了结的话头」
- 手头的事、约定、早些时候的念头前面都标着「对方并不知道」，读起来像私事

### 4.2 话兜

- `HEARTBEAT_SCHEMA` 的 `life` 和 `episode` 各加一个可选字段 `tellLater`：「这件事里你想跟 ta 说的一句话，没有就留空」
- 新表 `pocket_items`：`id, char_id, text, source_run_id, kind('share'|'grievance'), created_at, said_at, expires_at`
  - 保质期分三档（2026-10-19 返工）：`tellLaterFresh` = soon 3 小时 / today 到角色那边今天结束（至少 3 小时、最多 18 小时）/ days 48 小时，与字面（等会儿、今晚……）取更短；`grievance` 是别扭时想说的（第 5 节之后才有）
  - 不收写给自己的备忘、跟别人说的话、用「她」称呼对方且没有「你」的、跟没说的某句差不多的（两字组覆盖 ≥ 0.5）
  - 快照里 TA 攒下之后说过的话盖住某句 ≥ 0.45 就算说过了（心跳开头、`GET /pocket`、心跳发消息后各对一次）
- `reach_out` 那一跳取最早一条没说过、没过期的；发出去了就标 `said_at`
- 同一时刻最多 5 条没说的，多了丢最旧的

### 4.3 开口时抽「为什么想起 ta」

`reach_out` 跳由程序抽一个缘由，写进提示词当作「你想起 ta 是因为……」：

| 缘由 | 初始权重 | 内容 |
|---|---|---|
| 话兜里的一句 | 0.35 | 4.2 |
| 自己刚过的日子 | 0.20 | 最近 24 小时的生活片段里挑一件 |
| 她那边的东西 | 0.15 | mini 侧可用的契机来源（日历、朋友圈、账本摘录） |
| 接上次的话头 | 0.30 | 现在的行为 |

没有对应内容的缘由权重归零重新分。约定照旧是「很自然的话头」那句，不另算。

### 4.3.1 攒着的话一起说（2026-10-19 阿萌）

兑现「等会儿」的那一跳不抽缘由（缘由就是那个念头），但同样摆出攒着的话：`reachOut.mjs` 的 `buildCatchUp`
取最多 3 句没说的话兜（去掉已经当缘由的那句）和最多 3 件上次说话之后的生活片段，`formatCatchUp` 写进提示词。
隔了 ≥ 1 小时且东西 ≥ 2 件时明说「挑两三件一起说了，一件一行」；连发没回时只挑一件。说出口的按字面划掉。

### 4.4 读回完整的生活片段

新查询 `recentLife(db, charId, { since: 24h, limit: 6 })`：读 `model_runs.episode` 里的 `life` / `work`，压成一行一件（谁、做了什么、一句细节）。`reach_out` 和 `live` 两种跳都带上。

### 4.5 措辞

- 「对方并不知道」改成「ta 还不知道，想说就说」
- `reach_out` 规则里「贴着……还没了结的话头」改成「贴着上面那个想起 ta 的缘由」
- `live` 跳的「不要提到对方」保留（那是生活小事本身），但话兜那句明确允许想着 ta

---

## 5. 心思系统（第三阶段）

> **第三阶段进度（2026-10-19，分支 `feat/char-drives-engine`，未合并）**
> - **已做**：mini 心思引擎 `server/agent-backend/drives.mjs`（迁移 12：`drive_state` / `drive_ledger`）——九种心思按半衰期往基线回、久不说话「想你」基线上爬、深夜「累」高、别扭距最后作证满 24 小时强制回基线；
>   事件标签表 `LABEL_EFFECTS`（她这边 11 个 + 心跳自我经历 4 个 `selfEvents`），负面标签无原话不收、15 分钟内同标签 ×0.7、单次封顶 0.15、按剩余空间缩放；真做完才落（`SATISFY`）。
>   心跳里：开口概率 × `chanceFactor`（0.5–1.6，封顶 0.75，欠着回复 / 兑现「等会儿」不受影响）、生活小事权重 × `lifeWeightFactors`、最强一两种写成感受进提示词、别扭有原话作证时缘由可以是「把不满说出来」（`grievance`）、
>   念想最强时推送预览改成「X 给你发来一条消息」（阿萌 2026-10-19 定：预览里藏起来）。接口 `POST /drives/events`、`GET /drives`（只给最强一两种 + 档位）。
>   手机端 `utils/emDriveEvents.ts`：情绪评估顺风车段（配对了才加）、整理、送去 mini（不在线排队 6 小时）；接线 `useChatAI.ts` 两处、`emotionApply.ts` 三处
> - **脾气读数（2026-10-19 做了）**：手机 `utils/emTemperament.ts`（副 API 读人设 + 反刍倾向 → 九种各自「平时 / 多容易触动」三档、别扭压力消得快慢、压力出口、不适用的几种）、
>   心跳面板里每个角色下面的「脾气」可展开逐项改（`components/settings/TemperamentEditor.tsx`，改过标 confirmed），字段 `CharacterProfile.emDriveTemperament` 随快照（`driveTemperament`）给 mini；
>   mini `drives.mjs` 的 `applyTemperament` 把档位翻成数：基线 / 敏感度 低 ×0.6、中 ×1、高 ×1.5；回落 快 ×0.7、慢 ×1.5（只管别扭和压力）；不适用的固定 0；
>   压力出口写进感受，「找朋友」偏抽签去聊天、「找你说」偏开口。**还没有的**：没读过的角色不会自动读（要在面板里点「读一下」）
> - **性欲（念想）细则（同日）**：分开时被撩往上冲、4 小时半衰；在一块的亲密算满足（落到四成）+ 3 小时不应期；早上 6–9 点 +0.1；累和上班时往下压
> - **两个人的时间（2026-10-19 阿萌）**：亲密拆成三个标签——flirt（调情升温，念想涨）/ getting_intimate（说去洗澡、在床上等着；进入「两个人的时间」2 小时）/ intimacy_done（事后的话；才算满足：念想落到四成、3 小时不应期、想你落、提前结束两个人的时间）。
>   两个人的时间里心跳整个跳过、连模型都不叫，记成 `private_moment`（手动补跑也一样）；旧的 `intimate` 当调情算
> - **查手机状态小组件（同日）**：`components/checkphone/StatusWidget.tsx`（读 `GET /drives`，最强一两种 × 档位一句话，`utils/emDriveStatus.ts`），放在草稿箱上面，都在平常水平时不占位置，mini 不在线显示缓存
> - **接上时自动读脾气（同日）**：心跳面板「接到后端 / 重新同步」时，还没读过的角色顺手读一次，失败不拦
> - **曲线回放（同日）**：`server/agent-backend/scripts/simulate-drives.mjs`，五个场景（同居一天、异国一天、失约后安抚、失约没提到第二天、加班）。回放后调了两处：想你半衰期 10 → 6 小时、好几天见不到每小时 +0.045 → +0.06（最多 0.4）
> - **核实了**：交给 mini 即时回复的那一轮，情绪评估在手机上交完那一轮时就跑（`useChatAI.ts` 的 `fireLocalEmotionEval`），看得到她刚发的那句，事件标签照常送；只有页面被杀后台那一轮会漏
> - **没做（下一步）**：契机池按心思加权（契机池本身还在 `feat/char-drives-cue-pool`）；
>   `scripts/simulate-drives.mjs` 曲线回放；「交给 mini 即时回复的那一轮情绪评估跑不跑」仍待核实
> - **在不在一块（2026-10-19 阿萌）**：不加设置标签（她上课他上班也算分开，但只有几个小时），改成心跳每跳判断 `together`：
>   together（就在一块）/ today（各忙各的、今天会见到）/ far（好几天见不到）/ unknown，存进状态 6 小时有效。
>   不说话时「想你」：together 往下回、today 每小时 +0.015（最多 0.2）、far +0.045（最多 0.35）、unknown +0.03；撒娇亲密时 together 是满足（−0.10）、分开是更想见（today +0.03、far +0.08）
> - **别扭门槛（同日）**：失约 / 吵架一次（+0.2）就够主动提（`grievanceOf` 门槛 0.15）；冷淡 +0.06、不当回事 +0.07 单独一次只进感受（别扭的感受门槛 0.08），不够主动提
> - **试运行 + 贴贴按钮 + 审查修复（2026-10-20 阿萌）**：
>   - **心思试运行**（设置 `drives_trial`，默认开）：数值照常算、心思账照常记，但开口概率、过日子抽什么、提示词里的感受、别扭时主动提、念想藏预览全按没有心思时那样；两个人的时间照样生效。
>     心跳面板顶上的说明里显示在不在试运行；关掉在 mini 上 `node server/agent-backend/cli.mjs drives-trial off`（不用重启）。打算拉一周心思账画曲线、一起看过再关
>   - **贴贴按钮**：聊天工具栏第二页（`components/chat/PrivateMomentButton.tsx`，`POST /drives/private`）。点一下开始（心跳闭嘴 2 小时），再点一下结束（按事后算）；
>     她自己开的只认她自己结束，副 API 猜到的「事后」不替她关；自动判断照旧兜底。`GET /drives` 多返回 `private`
>   - 修了：不应期里第二次「说要开始了」被丢（数值不动时整条事件不存）；心跳等模型时聊天送来的标签被心跳写回时盖掉（改成写回前重新读）；
>     Gemini 不写选填的 `together` / `selfEvents`（改成必填，套 `heartbeatSchemaFor`）；`GET /drives` 没带多久没说话和当地时间，查手机看到的跟心跳感觉到的对不上；
>     手机排队补送的事件按补送时刻算（现在每条带 `at`，6 小时内按真发生的时刻）；两次评估挨着落地会把排队的那批送两遍（改成一次只跑一趟），没带原话的标签 mini 也不再按「标签名」去重
> - **数值出处**：15 分钟 ×0.7 是 Drivesoid 原数；做完按比例落是照 PDF 回落表的量级（×0.45–0.7）；其余基线、半衰期、标签增减、系数公式都是小帕拍的第一版，合并后要拉一周心思账再调。
>   PDF 的探索位 15%、不应期、习惯层、疲惫 0.72 歇着闸**都还没做**

### 5.1 九种心思（阿萌 2026-10-14 定）

| key | 名字 | 主要来源 | 主要出口 / 落 |
|---|---|---|---|
| `miss` | 想你 | 久不说话慢升（吸收原「分离慌」）、亲昵 | 开口、买礼物 → 落 |
| `curious` | 好奇 | 时间慢升、她分享新东西 | 刷小红书 / B 站、翻她的 App → 落 |
| `reminisce` | 回味 | 时间慢升、反刍倾向 | 提旧事 → 落 |
| `social` | 社交 | 时间慢升 | 找朋友、约人、发朋友圈 → 落 |
| `stress` | 压力 | 心跳工作往来里自己编的头疼事、日程过满、被催 | 吐槽（朋友或她）、她安慰 → 落；也会自然回落 |
| `sulk` | 别扭 | **只认她真说过 / 做过的事**（失约、冷淡、敷衍、久不理却在发朋友圈） | 和好 → 大幅落；**距最后一次依据满 24 小时强制回基线** |
| `concern` | 挂心 | 只认事实：她说不舒服、经期、考试、大额支出 | 问一句、翻她的 App → 落 |
| `desire` | 性欲 | 亲密事件留尾迹、晨间小脉冲 | 满足后不应期；疲惫和上班时段压它 |
| `tired` | 疲惫 | 忙了一天、睡得少 | 不是欲望，是刹车：高时倾向歇着 |

不做：占有、嫉妒（1v1，角色彼此不知道）。**责任未定**，第一版不做（见第 9 节）。

### 5.2 怎么涨：事件标签，不是数字

- **聊天**：副 API 情绪评估顺风车多出一段 `driveEvents`（照 `utils/roomAmbient.ts` 的 `ambientSection` 先例：
  提示词末尾追加一段可选输出，`applyEmotionEvalRaw` 里一行调用落地）。它只给标签和原话：
  ```json
  "driveEvents": [{ "label": "broken_promise", "quote": "啊我忘了，下次一定" }]
  ```
- **标签表 v1**（参考 Drivesoid 的 16 类改写）：`affectionate` 亲昵、`intimate` 亲密、`vulnerable` 示弱 / 难受、
  `reassuring` 安抚 / 和好、`sharing` 分享好事、`cold` 冷淡、`dismissive` 敷衍、`conflict` 冲突、
  `broken_promise` 失约、`pressing` 催、`concern_fact` 提到生病 / 考试等、`neutral`
- **负面标签必须带 `quote`**，没有原话的直接丢
- **映射在代码里**（`server/agent-backend/driveLabels.mjs`）：标签 → 各种增减 × 这个角色的敏感度
- 涨幅按剩余空间缩放；15 分钟内同一标签每重复一次 ×0.7；每轮每种增减封顶 ±0.15
- **心跳自己的经历**：`HEARTBEAT_SCHEMA` 加 `selfEvents`（同样只给标签：`work_trouble`、`work_win`、`friend_fun`、`tired_day`），代码映射
- **时间**：心思值是时间的纯函数，读的时候按经过的时间算回落 / 慢升，不需要单独的定时器

### 5.3 怎么落：只有真做完才落

「做完」看程序有没有证据，不看模型说：心跳真写出了那条生活记录、真发出了消息、小红书真刷到了首页；聊天里真调用了工具。按表乘性回落，然后进 2 跳不应期。

### 5.4 怎么决定做什么（心跳）

- `decideIntent`：`messageChance` 的基数再乘心思系数（想你、挂心推高；别扭、疲惫压低；别扭时有一定概率反而开口去提）。闸门、上限、连发没回的退避**全部保留**
- `pickLifeKind`：固定权重表 × 对应心思 × 饥饿度（多久没满足过），不应期内的归零；留 15% 探索位从今天还没做过的里均匀抽。没有心思数据时退回原表
- 别扭超过中档、话兜里有 `grievance`：`reach_out` 的缘由里加一项「把不满说出来」

### 5.5 给模型看的样子

只给感受，一到两句，**不出现数字，不写该做什么**：
> 你心里还有点堵：她昨天说好晚上视频，后来说忘了。
> 今天被那个客户折腾了一下午，有点想找人说说。

感受和嘴上说什么可以不一样：冷淡型的角色「想你」很高，照样可以嘴硬。感受写进 reason，人设管 text。
**社会责任那条（`DUTY_RULE` / `emDutySection`）优先于任何心思**：别扭再重也不会为吵架丢下工作。

### 5.6 脾气读数

- 字段：`CharacterProfile.emDriveTemperament?`（types.ts 行尾哨兵）
  ```ts
  { baseline: Record<DriveKey, 'low'|'mid'|'high'>,
    sensitivity: Record<DriveKey, 'low'|'mid'|'high'>,
    recovery: 'fast'|'mid'|'slow',          // 主要影响别扭和压力，别扭仍封顶 24 小时
    stressOutlet: 'friends'|'user'|'work'|'alone',
    disabled: DriveKey[],                   // 如意识系角色没有出门社交
    source: 'auto'|'confirmed', generatedAt: number }
  ```
- 生成：副 API 读人设，照记忆宫殿「性格检测」的模式（`utils/memoryPalace/digestion.ts`）写一份 EM 自己的（`utils/emTemperament.ts`），
  已有的 `ruminationTendency` 作为输入（高 → 回味基线高、别扭消得慢）
- 缺省时第一次需要就自动生成（阿萌很少点记忆宫殿那个检测）；在**神经链接**角色设定里给一个 EM 小块：看一眼、改档、重读
- 随快照上传，mini 用它算

### 5.7 存储与接口（mini）

- 表 `drive_state(char_id PK, state_json, updated_at)`、`drive_ledger(id, char_id, at, drive, delta, value_after, source, label, reason)`
- `POST /drives/events`：手机送事件标签（带 turn id 去重）
- `GET /drives?charId=`：返回给手机的摘要——最强的一两种 + 档位、话兜里没说的、数据时刻。**不返回精确数值**
- 心思账保留 90 天

---

## 6. 查手机可视化（阿萌定：三个都要）

全部放查手机首页，不放聊天页能直达的地方，不显示数字。

1. **状态小组件**：最强的一两种，按「种 × 档」从短语池取一句（「有点想你 · 工作上憋着气」）。第三阶段才有数据
2. **草稿箱**：话兜里还没发出去的；`grievance` 显示成打了又删的样子。第一阶段有话兜之后就能做
3. **屏幕使用时间**：**现在是假的**——`apps/CheckPhone.tsx` 里「Today's Activity」的时长是
   `64 + 记录条数 × 11 + 名字哈希 % 40`，气温也是名字哈希。改成按今天真实的查手机记录每类给合理时长
   （按记录 id 定种子，刷新不跳），加总并按 App 拆开；没记录就显示很少。**不依赖任何别的，随时可做**

UI 照 `design-system/DESIGN_SYSTEM.md` + `APP_CONVENTIONS.md`，取值只从 `utils/clayTokens.ts`。

---

## 7. 分阶段

| 阶段 | 内容 | 依赖 | 改哪 |
|---|---|---|---|
| **一** | 话兜、读回 24 小时生活、开口缘由、措辞；草稿箱；屏幕使用时间改真 | 无 | 后端 `heartbeat.mjs` + 新 `pocket.mjs`；前端查手机 |
| **二** | 聊天契机池（固定权重）、各来源、契机记账 | 无 | 前端新文件为主，`useChatAI` / volatileState 一处接线 |
| **三** | 心思引擎、事件标签顺风车、脾气读数、心跳按心思抽签、心思账、状态小组件；契机池改按心思加权 | 一、二 | 后端 `drives.mjs` / `driveLabels.mjs`；前端情绪评估一处、神经链接一块 |
| **四**（待定） | 念头池 / 执念、责任、跨角色总闸 | 三跑出数据 | — |

每个阶段单独可验收，单独上线。

---

## 8. 本次不做（记录想法，别自由发挥）

- 不做占有、嫉妒
- 不让契机或心思触发任何**写操作**（记账、开灯、建提醒、下单之外的现实动作）；心跳买东西照旧走现有购物抽签
- 不把心思数值显示给阿萌，也不写进任何给模型的文本
- 不改记忆宫殿的反刍，不另做「旧记忆」契机来源
- 不改情绪 buff 本身的语义：buff 是心情，心思是想做什么，两层并存
- 不把契机加进 `instantChatVeto`
- 群聊、见面、通话不接（只管私聊和心跳）

---

## 9. 还没定（阿萌拍板）

- **责任**要不要成为心思。现状：`DUTY_RULE` / `emDutySection` 写的是「你是什么样的人」，约定已有 `due_at` 推着。小帕倾向第一版不做
- **跨角色总闸**：几个角色同时很想你时会一起发消息，要不要限制一晚上的总条数
- **性欲推出的心跳消息**会出现在锁屏推送预览上：心跳里是否只到暧昧程度，露骨内容只留在聊天里
- 聊天契机频率（暂定约 1/10 轮）
- 健康要不要当契机来源（倾向只用常驻轻量摘要，或干脆不用）

---

## 10. EM 惯例

- `server/agent-backend/` 整个目录是 EM 独有，不需要哨兵
- 前端新逻辑尽量放 EM 自己的新文件：`utils/emCuePool.ts`、`utils/emCueProviders.ts`、`utils/emDriveEvents.ts`、`utils/emTemperament.ts`、`utils/emScreenTime.ts`
- 碰上游文件只接线，带哨兵：
  - `hooks/useChatAI.ts`：情绪评估末尾追加段（复用 `ambientSection` 参数拼接，不改函数签名）、volatileState 一行契机 → `[EM: char-drives]`
  - `utils/emotionApply.ts`：`applyEmotionEvalRaw` 里一行落地 driveEvents（紧挨 `landAmbientEventFromEval`）→ `[EM: char-drives]`
  - `types.ts`：`emDriveTemperament?` 行尾哨兵
  - `apps/CheckPhone.tsx`：三个组件 → `[EM-START/END: char-drives-checkphone]`
- `scripts/check-em-patches.sh` 补对应锚点
- 情绪评估在 worker 路径（instant-push / amsg）用占位符还原同一份提示词，追加段会跟着走；
  落地都在 `applyEmotionEvalRaw`。**待核实**：交给 mini 即时回复的那一轮，情绪评估是否照常跑（`post-push-emotion-eval`）——不跑的话那一轮没有事件标签
- 改完 worker 相关的要 `node scripts/build-workers.mjs`；改后端要重启：
  `launchctl kickstart -k gui/$(id -u)/cc.liliumos.agent-backend`

---

## 11. 验收

**原则（PDF 的教训）：读了代码说通了不等于通了，验收只有拉账一种。** 每条线都要能答三个问题：
过去一周真实触发几次？触发后数值 / 行为真的动了吗？有没有一条线零账？零账就是断的。

```bash
cd server/agent-backend && node --test
pnpm vitest run
bash scripts/check-em-patches.sh
```

- 后端测试用内存库或临时文件，**跟真账本物理隔离**（PDF 吃过「测试写进生产账本」的亏）
- 新增 `server/agent-backend/scripts/simulate-drives.mjs`：虚拟时钟 + 固定种子，回放几个场景（冷落一天、吵架后和好、加班一周、正常一周），打印曲线，人看形状
- 第一阶段人工验：mini 上看一周 `model_runs`，`reach_out` 消息里分享自己日常的占比明显上升；话兜有写入、有取出
- 第二阶段：契机账里各来源都抽中过；同一 dedupeKey 没有 3 天内重复
- 第三阶段：心思账里每种都有涨有落；别扭没有一次超过 24 小时；没有一种长期贴着 0 或 1

---

## 12. 出处

心思系统的思路来自阿萌给的 PDF《给 AI 装一套「欲望」：跑了三个多月之后的攻略》（小红书版 v2，2026-09-17，朝灯 & 哥哥），
以及它致谢链里的项目（链接、许可证和各自借了什么见 `docs/ideas.md` 那一节的表）：
獭獭的欲望系统、[LMC-5](https://github.com/wuxuyun0606-collab/lmc-5)、[chord-affect-anchors](https://github.com/CyberSealNull/chord-affect-anchors)、
[Drivesoid](https://github.com/A1batr055/Drivesoid)、[Ombre-Brain](https://github.com/P0luz/Ombre-Brain)。
**只借思路，自己写实现，不搬代码**（Drivesoid 2.1.0 起 CC BY-NC-SA，LMC-5 v0.3.0 起 AGPL）。
原文是单个 AI、人设很薄的构造；LiliumOS 人设很厚，所以心思只是身体里的状态，性格由人设决定（第 5.5、5.6 节）。
