# LiliumOS Calendar / Shared Life 整合方案

> 状态：产品与架构讨论稿 v0.1，供 Emma、前端实现者和 Agent Backend 实现者共同审阅
>
> 日期：2026-09-22
>
> 相关文档：[`agent-backend-design.md`](./agent-backend-design.md)、[`agent-backend-phase0-audit.md`](./agent-backend-phase0-audit.md)、[`location-awareness.md`](./location-awareness.md)、[`map-system-design.md`](./map-system-design.md)、[`mcp-client.md`](./mcp-client.md)
>
> 本文讨论的是目标设计和分阶段落地方式，不代表其中功能已经完成。当前真实进度仍以 [`roadmap.md`](./roadmap.md) 与 [`../progress.md`](../progress.md) 为准。

## 0. 结论先行

这次改造不应只把旧 Calendar 换一套界面，也不应一开始就实现完整的自主智能体。

真正要解决的是两个相连的问题：

1. **Emma 的现实时间怎样进入 LiliumOS**：课程、预约、截止日期、提醒事项和稳定规律，能够影响角色对“现在适不适合联系、今晚能不能一起吃饭、明早谁要早起”的理解。
2. **角色怎样拥有连续的一天**：角色有自己的工作、朋友、兴趣、独处和临时变化；用户打开聊天只是进入这条正在继续的时间线，不会让角色的一天重新开始。

建议把现有 Calendar 逐步改成一个 **Shared Life / 共同生活时间层**。Apple Calendar 与 Reminders 继续作为 Emma 现实安排的原件；LiliumOS 保存自己的关系语义、角色日程、固定生活规律、可见性设置和实际活动记录。

首个完整版本优先完成（实际开发仍按第 12 节拆成多个可验收阶段）：

- Today / Shared 首页；
- Apple Calendar / Reminders 的只读聚合与更新时间；
- Emma 手动确认的固定规律；
- 角色生活锚点与更独立的每日计划；
- “忙碌时可以回复，但不能离开或瞬移”的运行约束；
- 计划、已发生事实、合理推测和未知状态的明确区分。

后端自治、提醒事项关系跟进和完整 Timeline 都可以接在这套数据结构上，但不应阻塞第一版。

---

## 1. 目标体验

### 1.1 Emma 打开 Calendar 时

首页不再先展示三个彼此割裂的“任务 / 纪念日 / Agenda”入口，而是先回答今天最有用的问题：

```text
今天 · 9 月 22 日 周二

你
08:00–15:30 课程日
16:00 后没有已知安排
2 个临近事项

Elias
办公室 · 会议中
预计 17:30 后可离开
19:30 有晚餐安排

一起
今晚一起吃饭的可能性较低
依据：Elias 19:30 有安排；你的晚间状态未知

接下来
周四早课
下周二 BST631 作业截止
10 月 30 日 生日
```

界面必须告诉 Emma 结论来自哪里：

- **已确认**：Emma 手动保存，或外部数据明确给出；
- **计划中**：角色今天的计划，还没有发生；
- **已发生**：真实工具执行、角色后台活动或用户确认留下的事件；
- **推测**：从规律或空闲窗口算出的可能性；
- **未知**：没有足够信息，不伪装成空闲或在家。

### 1.2 Emma 打开聊天时

角色应该进入已经存在的当天状态：

- 会议中可以短暂回一句，但不能说“我现在就下楼”；
- 决定离开公司后，需要先进入“准备离开 / 路上”，经过合理时间才能到家；
- 几小时没聊，角色仍知道自己的计划进行到了哪里；
- 没有后端或没有实际事件时，只能说“按原计划刚开完会”，不能把模型补写的细节冒充已发生事实；
- 用户的课程、截止日期或提醒事项只在相关且获准时进入上下文，不每轮倾倒整份日历。

### 1.3 App 关闭时

在 Agent Backend 心跳真实上线后，角色可以被唤醒并选择：

- 保持安静；
- 做一件获准的内部或工具动作；
- 记录一条自己的动态；
- 真的有话时才联系 Emma；
- 为未来排一个待执行意图。

“醒来”不等于“必须发消息”。已设计的 `activity_log` 与“查手机 → TA 的动态”正好承接角色做过的事；Calendar 只展示与时间状态相关的摘要，不复制整页动态。

---

## 2. 当前真实基础

截至 `origin/main @ e5341a64`，可以直接复用的能力包括：

| 现有能力 | 当前真实边界 | 本方案怎样使用 |
|---|---|---|
| Schedule App | 本地 `Task`、`Anniversary`、`AgendaItem` 三套数据；界面仍是旧三 Tab | 保留原数据，逐步迁入新入口，不先删库 |
| 角色每日程 | `DailySchedule` 含时段、地点、`regionId`、内心独白、`online / busy / offline`；通常在打开角色聊天后发现当天缺失才生成 | 作为角色“计划层”，扩充生活锚点和运行约束 |
| 日程修改 | 角色能修改当前及未来已有时段 | 保留为计划修订；不能把修改本身当作已经到达新地点 |
| Apple Calendar / Reminders | Mac mini 私有 MCP 已实测；聊天可读，部分写操作需确认；高级重复规则等仍由 Calendar.app 管 | 建立 Calendar 专用只读适配层和缓存，不复制成另一套 Apple 编辑器 |
| 位置感知 | 前台按需读取家 / 学校 / 超市 / 在外面；精确坐标仅留本机；云端无法主动读取 iPhone GPS | 位置只作为带更新时间的证据，不从日历事件反推“已经到家” |
| 主动消息 2.0 | 稳定的定时消息与即时聊天仍在；旧心跳实验已撤回 | 保持不动，不把 Shared Life 再塞回上游 amsg Worker |
| Mac mini Agent Backend | Phase 1a / 1b 已合入：配对、任务、outbox、推送、HA 看门狗；尚无 Codex 运行器和心跳 | 后续承载角色唤醒、活动记录和最小时间快照 |
| Agent Backend 1c 设计 | 已规划心跳影子运行、`activity_log`、角色快照和“TA 的动态” | 直接扩展现有设计，不另建 Calendar 后端 |

一个需要先补的技术缺口：`agenda` 有独立 IndexedDB store，但当前完整备份导出 / 恢复清单需要专项核对。任何数据迁移前，先证明 Task、Anniversary、Agenda 和 DailySchedule 都能完整导出、恢复和兼容旧备份。

---

## 3. 设计原则

### 3.1 Apple 管现实原件，LiliumOS 管关系含义

Apple Calendar 与 Reminders 继续负责现实事件的创建、修改、重复规则、闹钟和完成状态。LiliumOS 不再试图成为另一套完整日历服务，而是负责：

- 规范化只读视图；
- 为每个角色设置可见性；
- 保存“这件事对共同生活意味着什么”；
- 计算忙碌、空闲、冲突和共同窗口；
- 维护角色自己的计划和实际活动；
- 为聊天和后台自治提供小而准确的时间上下文。

### 3.2 计划不等于事实

角色每日程最初只是计划：

```text
09:00 去办公室
11:00 董事会
13:00 桌面工作
19:30 客户晚餐
```

在没有后台执行证据时，系统可以用它计算“预计状态”，但不能自动生成“董事会发生了什么”并当作历史。只有以下来源可以形成“已发生”：

- 后台真实执行过的动作；
- MCP 或其他 App 返回的真实结果；
- 聊天中经校验落库的状态转换；
- Emma 明确确认；
- 其他已有模块产生的可靠事件。

### 3.3 状态由程序保存，表达交给模型

提示词可以告诉角色如何自然说话，但不能承担核心一致性。是否能离开、是否已经到达、是否刚问过作业进度，应由结构化状态和校验器决定。

### 3.4 缺少证据时保持未知

- 日历写着“课到 15:30”不代表 Emma 15:31 已经在家；
- 双方都没有日历事件不代表一定能约会；
- 角色计划 17:30 下班不代表它已经下班；
- GPS 缓存超过有效期后不继续沿用旧地点。

### 3.5 一个事实只设一个主来源

Apple 事件以 Apple 为主；角色计划由当前启用的计划生成器负责；实际事件以追加日志为主。前端与后端不能同时改同一份今日计划而没有版本号。

---

## 4. 最小数据模型

以下是产品概念，不要求第一批一次建完所有字段。实现时应优先复用已有 `DailySchedule`、Agent Backend `char_snapshots` 和 `activity_log`。

### 4.1 通用来源与可信度

```ts
type TemporalTruth = 'confirmed' | 'planned' | 'observed' | 'inferred' | 'unknown';
type TemporalSource =
  | 'apple_calendar'
  | 'apple_reminders'
  | 'lilium_routine'
  | 'character_plan'
  | 'agent_backend'
  | 'chat_action'
  | 'user_confirmed';

interface TemporalProvenance {
  source: TemporalSource;
  sourceId?: string;
  truth: TemporalTruth;
  updatedAt: number;
  staleAfter?: number;
}
```

所有进入 Shared Life 的条目都带来源。UI、提示词和后端据此决定能说多肯定。

### 4.2 Routine：稳定规律

```ts
interface LifeRoutine {
  id: string;
  owner: 'user' | { charId: string };
  label: string;
  weekdays: number[];
  startTime?: string;
  endTime?: string;
  locationLabel?: string;
  activeFrom?: string;
  activeUntil?: string;
  visibility: 'private' | 'all_characters' | { charIds: string[] };
  source: 'manual' | 'apple_suggestion' | 'character_life_model';
  confirmedAt?: number;
}
```

第一版只让 Emma 手动创建或确认。Apple recurring event 可以生成“建议固定为规律”，但不能静默写入。这样课表变化时不会让旧推断长期污染角色认知。

### 4.3 Character Life Model：角色的生活骨架

它比每日程稳定，但不等于每天重复同一套活动：

```ts
interface CharacterLifeModel {
  charId: string;
  workPattern?: string;
  socialAnchors: string[];
  hobbies: string[];
  familyTies: string[];
  preferredAloneTime?: string;
  domainWeights: {
    work: number;
    friends: number;
    family: number;
    hobbies: number;
    solo: number;
    relationship: number;
  };
}
```

这些字段可以由角色设定生成草稿，再由 Emma 调整。固定人名、长期承诺和重要关系不能仅凭日程生成模型自动确认为事实。

### 4.4 Character Plan：今天原本打算怎样过

继续沿用 `DailySchedule`，后续可增加：

- `revision`：前后端防覆盖；
- `generatedBy: 'frontend' | 'backend'`：明确唯一写入者；
- `basisVersion`：这份计划基于哪个 Life Model；
- `planStatus: 'draft' | 'active' | 'superseded'`；
- slot 的 `interruptibility` 和移动约束。

### 4.5 Runtime State：现在能做什么

```ts
interface CharacterRuntimeState {
  charId: string;
  at: number;
  activity?: string;
  location?: string;
  locationTruth: 'observed' | 'planned' | 'unknown';
  presence: 'online' | 'busy' | 'offline';
  interruptibility: 'free' | 'soft' | 'hard' | 'locked';
  mobility: 'stationary' | 'can_depart' | 'preparing' | 'in_transit';
  canReply: boolean;
  canCall: boolean;
  canLeave: boolean;
  stateEndsAt?: number;
  earliestAvailableAt?: number;
  revision: number;
}
```

`online / busy / offline` 可以继续作为聊天表现；`interruptibility` 与 `mobility` 负责行为权限。二者不再混为一个状态。

### 4.6 Character Activity Event：实际发生的事

```ts
interface CharacterActivityEvent {
  id: string;
  charId: string;
  type: 'state_transition' | 'tool_action' | 'social' | 'work' | 'note';
  summary: string;
  startedAt: number;
  endedAt?: number;
  truth: 'observed' | 'user_confirmed';
  source: 'agent_backend' | 'chat_action' | 'tool_result';
  relatedPlanSlot?: string;
  shadow?: boolean;
}
```

Agent Backend 的 `activity_log` 是这类事件的运输通道之一。影子运行数据必须标记 `shadow: true`，只能用于审阅，不能进入角色真实历史。

### 4.7 External Item Overlay：不复制 Apple 原件

LiliumOS 对 Apple 事件和提醒只保存自己的附加信息：

```ts
interface ExternalItemOverlay {
  source: 'apple_calendar' | 'apple_reminders';
  sourceId: string;
  visibility: 'private' | 'auto' | { charIds: string[] };
  pinnedAsRoutineId?: string;
  importance?: 'low' | 'normal' | 'high';
  interactionByChar?: Record<string, {
    state: 'never_mentioned' | 'mentioned' | 'asked' | 'progress_reported' | 'resolved';
    lastAskedAt?: number;
    lastProgressAt?: number;
    progressSummary?: string;
  }>;
}
```

Apple 条目删除或完成后，overlay 先留 tombstone，再按保留规则清理，避免离线设备把旧状态重新带回来。

---

## 5. 哪些是纯前端，哪些需要同步、提示词或后端

| 功能 | 纯前端 | Apple / 数据同步 | 提示词 | Agent Backend | 难度与建议 |
|---|---:|---:|---:|---:|---|
| Today / Shared 首页 | ✅ | 读取现有来源 | 少量 | 否 | 低；第一批做 |
| 手动 Routine | ✅ | 备份 / 恢复 | 注入摘要 | 后续可同步 | 低；第一批做 |
| Important Dates | ✅ | 迁移旧纪念日 | 保留现有感知 | 否 | 低；第一批保留 |
| Apple 事件只读列表 | UI 与缓存 | ✅ MCP | 不需要模型整理 | 后台可刷新 | 中；第一批做手动刷新与缓存 |
| Apple Reminder Open Loops | UI 与 overlay | ✅ 完成状态与删除 | 相关性和自然跟进 | `reminder.followup` | 中高；第二批做 |
| Shared Life 推断 | ✅ 确定性规则 | 依赖输入新鲜度 | 只注入结果 | 后台也复用同一函数 | 中；第一批只做保守结论 |
| 角色独立生活 | Life Model 编辑 | 备份 | ✅ 生成器 | 后台未来生成日计划 | 中；第一批先改模型与结果检查 |
| 忙碌 / 不瞬移 | 状态机与校验器 | 状态版本 | ✅ 表达与修复 | 关闭 App 后需要 | 高；拆成两步落地 |
| 实际 Timeline | 本地展示 | 追加事件同步 | 可生成一句摘要 | ✅ 真实后台事件 | 高；先复用 TA 的动态，不做完整时间线 |
| App 关闭后自主生活 | 设置与审阅 | 后端状态同步 | ✅ 心跳与行动选择 | ✅ | 高；跟 Agent Backend 1c / 1d 走 |

### 5.1 只改提示词能解决的部分

- 日程活动更丰富；
- 不把全部空闲时间留给 Emma；
- 高管出现商务社交，游戏型角色有自己的朋友与独处；
- 说话时正确理解“这是计划还是已经发生”；
- 心跳时默认沉默，只有真有话才发消息。

### 5.2 不能只靠提示词的部分

- 不瞬移；
- 不重复追问同一提醒；
- 外部事件完成 / 删除后的同步；
- 前后端同时修改计划时的冲突；
- 判断位置数据是否过期；
- 后台工具写操作的幂等和对账；
- 影子运行内容不能污染真实世界状态。

---

## 6. Apple Calendar / Reminders 整合方式

### 6.1 前端第一版

新增专用 `appleTemporalAdapter`，通过已配置的 Apple Events MCP：

1. 读取一个有限时间窗，例如过去 1 天到未来 14 天；
2. 规范化为前端只读 `ExternalTemporalItem`；
3. 本地缓存结果与 `lastSuccessfulSyncAt`；
4. Mac mini 离线时展示上一次结果，并明确“更新于……”；
5. 页面提供手动刷新，不在每次聊天时拉完整日历；
6. 写操作继续走现有 MCP 确认边界，不由新 Calendar 页面暗中修改 Apple 数据。

缓存不能冒充原件。重新同步后，以 Apple 返回为准，再把本地 overlay 合并上去。

### 6.2 字段可见性

建议分两层控制：

1. **忙碌可见性**：角色只知道某时间段 Emma 忙，不知道标题和备注；
2. **内容可见性**：指定角色可以看到规范化标题，例如“BST631 作业截止”。

默认规则应保守：

- 课程、工作时段：可自动提供“忙碌窗口”，标题默认不展开；
- 医疗、财务、私密标题：默认 private；
- 普通采购：不常驻注入；
- Emma 手动 Pin：按选择的角色可见；
- 事件备注、参与人、地址等原始字段：第一版不进角色常驻上下文。

### 6.3 后端阶段

Agent Backend 已运行在 Mac mini，未来可以增加一个不调用模型的 `temporal.refresh` 任务：

```text
定时读取 Apple Events MCP
→ 规范化未来忙碌窗口 / 临近提醒
→ 写入最小 user temporal snapshot
→ 变化时让后续 heartbeat 看到
```

不建议让前端和后端各自保存完整 Apple 镜像。后端只需要自治判断所需的最小窗口，前端仍可在页面上直接读取详细内容。

---

## 7. 让角色“生活起来”的实现

### 7.1 先改 Life Model，再调 Schedule Prompt

当前日程提示词已经要求职业、爱好、琐事、社交和独处。继续堆一句“要有朋友”可能效果有限。更有效的做法是先给每个角色一份稳定的生活骨架，再让每日生成器从中抽样。

生成规则应包括：

- 每天至少覆盖若干不同生活领域，但不要求每天都很充实；
- `relationship` 权重不能吞掉其他领域；
- 固定锚点优先，随机活动只能填空档；
- 未确认的朋友、客户或家庭事件使用泛称，不凭空建立长期人物事实；
- 与 Emma 共同发生的事只在真实共享安排或聊天已确认时出现；
- 生成后做一次确定性检查：slot 数量、时间顺序、睡眠窗口、生活领域分布、地点合法性和用户中心化比例。

### 7.2 计划推进不等于补写剧情

没有后台时，可以运行一个纯函数：

```ts
advancePlannedState(plan, now)
```

它只计算当前应该落在哪个 slot、计划地点和预计可用状态，不制造新的已发生事件。

有后台后，真实心跳或工具动作可以追加 `CharacterActivityEvent`。聊天看到的是：

```text
已发生事件 > 当前有效状态 > 今日计划 > 未知
```

### 7.3 不瞬移状态机

最小转换：

```text
office / stationary
→ preparing_to_leave
→ in_transit
→ home / stationary
```

角色想改变地点时输出结构化行动意图，而不是仅在正文里宣布：

```ts
interface MovementIntent {
  from: string;
  to: string;
  requestedAt: number;
  earliestDepartureAt: number;
  estimatedArrivalAt: number;
  reason?: string;
}
```

执行流程：

1. 校验当前是否允许离开；
2. 不允许时保留为 pending intent；
3. 允许时写入 `preparing_to_leave`；
4. 到出发时间进入 `in_transit`；
5. 到 ETA 才改变实际地点；
6. 模型正文若声称了不可能的地点变化，阻止该回复直接成为事实，并要求模型按有效状态修复一次。

第一批可以先加入运行状态块和结构化意图；自动推进与后台 job 在后续实现。

### 7.4 Pending Intentions

“下班给 Emma 打电话”不应立即执行，也不应只存在模型脑中。保存为待执行意图：

```ts
interface PendingIntention {
  id: string;
  charId: string;
  kind: 'contact' | 'movement' | 'schedule_change' | 'tool_action';
  earliestAt: number;
  expiresAt?: number;
  priority: number;
  trigger?: string;
  sourceEventId?: string;
  status: 'pending' | 'executed' | 'cancelled' | 'expired';
}
```

到点后重新检查当前状态，而不是机械执行。它可以映射到 Agent Backend `jobs`，不需要再建另一套云端调度器。

---

## 8. Shared Life 怎样计算

第一版使用确定性规则，不调用模型计算结论。

输入：

- Emma 的 Apple 忙碌窗口；
- Emma 已确认 Routine；
- 新鲜的粗略位置状态，可选；
- 角色今日计划与实际事件；
- 双方睡眠窗口；
- Important Dates 和已确认的 Shared Plan。

输出只做有限几类：

- 当前谁忙、谁可能空闲；
- 下一次双方都没有已知冲突的窗口；
- 是否有明显的早起、晚归或时间冲突；
- 是否存在已确认的共同安排；
- 数据不足时明确未知。

示例：

```text
今晚一起吃饭：不太可能
依据：Elias 19:30–21:00 有计划；你的晚间位置未知

下一个可能都空的窗口：周六 14:00–18:00
这是根据当前日历和规律推算，尚未约定
```

Shared Life 结论不自动创建 Apple 事件，也不自动变成双方承诺。

---

## 9. Calendar 新界面信息架构

保留 `AppID.Schedule` 和底层数据，先换产品结构：

### 9.1 Today

- Emma 当前 / 下一段安排；
- 所选角色当前状态与下一段计划；
- Shared Life 一到两条结论；
- 临近的重要日期和高显著性事项；
- 数据更新时间和来源状态。

### 9.2 Shared

- 双方未来 7 天共同空窗；
- 已确认的共同计划；
- 早起、晚归和时间冲突；
- 从这里创建 Apple Calendar 事件时，仍走明确确认。

### 9.3 Routines

- Emma 的固定课表 / 工作规律；
- 当前角色的生活锚点；
- Apple recurring event 的候选建议；
- 生效日期、暂停和按角色可见性。

### 9.4 Important Dates

- 继续使用现有 `Anniversary`；
- 生日、关系纪念日和一次性重要日期；
- 保留 `charAware` 和 yearly / one-time 语义；
- 后续再统一命名和数据模型，不在第一版破坏兼容。

### 9.5 Open Loops

第二批加入：

- Apple Reminders 中临近、重要或被 Pin 的事项；
- 角色是否知道、是否问过、进度与冷却；
- 完成后停止跟进；
- 私密事项可以完全不进入角色上下文。

### 9.6 旧功能安置

- 旧 Task 的“角色监督 / 完成评价”不是普通 Reminder，可改名为“挑战 / 约定”，保留独立关系玩法；
- 旧 Agenda 的角色口吻提醒可迁为“共同计划”，或提供转存 Apple Calendar；
- 未完成迁移与备份验证前，不删除旧 store，也不静默改变旧数据语义；
- 完整的“TA 的动态”留在 CheckPhone，Calendar 只显示与当天时间线有关的摘要链接。

---

## 10. 与 Agent Backend 的接口边界

### 10.1 不另造第二套后端

Calendar 后台能力全部建立在现有 `server/agent-backend/` 上：

- `char_snapshots.todaySchedule` 继续携带角色今日计划；
- 快照可增加经过隐私裁剪的 `userTemporalState`、`runtimeState` 与 `pendingIntentions`；
- `activity_log` 运输角色后台活动；
- `jobs` 承载到点跟进、移动推进和未来行动；
- Apple Events MCP 提供只读现实时间源；
- 工具写操作继续遵守白名单、幂等 marker 和对账器。

### 10.2 前后端单写者规则

| 数据 | 无后端或后端休眠 | 后端自治启用后 |
|---|---|---|
| Apple 原件 | Apple 是唯一主来源 | 不变 |
| Routine | 前端本地写，备份恢复 | 前端写，后端接收版本化快照 |
| Character Plan | 前端生成和修改 | 每天选定唯一 owner；后端 owner 时前端只提交修改请求 |
| Runtime State | 前端按计划计算预计状态 | 后端保存权威状态，前端只显示和提交用户事件 |
| Activity Event | 前端追加本地事件 | 后端事件经 outbox 同步到本地，按 event id 去重 |
| External Overlay | 前端保存 | 后续增量同步，不用整包最后写入覆盖 |

### 10.3 快照只带最小信息

后端心跳不需要完整 Apple 事件正文。建议每个角色的快照只带它获准看到的内容：

```json
{
  "userTemporalState": {
    "busyNow": true,
    "nextAvailableAt": "2026-09-22T21:00:00-05:00",
    "visibleUpcoming": [
      { "label": "作业截止", "at": "2026-09-24T23:59:00-05:00", "truth": "confirmed" }
    ],
    "builtAt": "2026-09-22T15:00:00-05:00",
    "staleAfter": "2026-09-22T17:00:00-05:00"
  }
}
```

快照过期后，角色不能继续把 `busyNow` 当作当前事实。

### 10.4 建议的新 job kind

这些是后续候选，不要求与 1c 同时完成：

| kind | 是否调用模型 | 用途 |
|---|---:|---|
| `temporal.refresh` | 否 | 读取 Apple MCP，刷新最小时间快照 |
| `character.day_plan` | 是 | 每日生成角色计划；失败时沿用安全的规律模板 |
| `character.transition` | 否 | 推进 preparing / transit / arrived 状态 |
| `reminder.followup` | 是 | 已在后端设计中预留；按冷却和进度跟进 |
| `shared.plan.recheck` | 可选 | 共同计划到点前复核双方状态，不默认发消息 |

---

## 11. 提示词改动清单

### 11.1 每日计划生成器

输入增加：

- Character Life Model；
- 已确认的 recurring anchors；
- 当天已知的真实约束；
- 生活领域权重；
- 昨天遗留但仍有效的 intention。

输出要求：

- 独立生活不围绕 Emma；
- 未确认的人物与承诺不固化；
- 时间、地点、availability 和 interruptibility 一致；
- 不生成无法解释的瞬时跨城或跨地点跳转。

### 11.2 聊天运行状态块

每轮只注入：

```text
当前有效状态：办公室会议中（已确认到 16:30）
可以：简短文字回复
不可以：离开、打电话、声称已经在路上或到家
如想下班后去找 Emma：提出待执行意图，最早 16:30 后重新检查
```

不要把整天所有 Apple 事件和提醒事项塞进高权重尾部。

### 11.3 Open Loop 显著性

第二批再做。显著性由确定性信号产生候选：到期时间、重要性、Emma 是否 Pin、是否提过、最近是否已问。模型只决定怎样自然表达，不能自己修改 `lastAskedAt` 或完成状态。

### 11.4 Heartbeat

沿用 Agent Backend v0.4 的输出：`noop | message | task`，并保留 `activity`。额外加入：

- 当前 Runtime State；
- 可见的用户时间摘要；
- pending intentions；
- 允许后台使用的工具；
- 沉默默认、消息需有真实缘由；
- 不能把 shadow、planned 或 inferred 写成 observed。

---

## 12. 分阶段实施

### Phase A：数据安全与诚实的 Today 首页

1. 核对 Task / Anniversary / Agenda / DailySchedule 的完整备份和旧数据恢复；补齐缺口。
2. 建 Routine、External Overlay 和来源 / 可信度基础类型。
3. 建 Apple Calendar / Reminders 只读适配层、有限时间窗缓存和更新时间。
4. 重做 Calendar 首页：Today / Shared / Routines / Important Dates；旧功能保留迁移入口。
5. Shared Life 只输出保守的确定性结论。

**这一步不依赖 Agent Backend 心跳，可以先独立完成。**

### Phase B：角色生活骨架与行为一致性

1. 增加 Character Life Model 编辑与默认草稿。
2. 改日程生成器输入，并增加确定性结果检查。
3. 扩展 Runtime State：interruptibility、mobility、location truth。
4. 聊天注入行为权限；加入 Movement Intent 和无效状态修复。
5. 计划推进保持“预计”，不自动伪造实际事件。

### Phase C：接入 Agent Backend 1c / 1d

1. 把角色计划、运行状态和裁剪后的 Emma 时间摘要上传到 `char_snapshots`。
2. 接收 `activity_log`，保存为本地活动事件；shadow 永不进入真实历史。
3. 完成“TA 的动态”页，Calendar 只引用时间相关摘要。
4. 心跳先影子运行一周，检查角色是否过度联系、误读计划或越过行动权限。
5. 通过验收后再开启真实工具和推送。

### Phase D：Open Loops 与关系连续性

1. 接入 Apple Reminder overlay；
2. 实现 per-character interaction state；
3. 加显著性、冷却和完成同步；
4. 对应 `reminder.followup` job；
5. 验证不会每天重复追问，也不会追问已完成或私密事项。

### Phase E：长期自主生活

- 后端生成或修订角色日计划；
- Pending Intention 到点复核；
- 工作、社交、休息等有限 action space；
- 真实 Activity Event 和长期 Timeline；
- 根据实际使用再评估 urge-to-contact，不提前做复杂分数系统。

---

## 13. 暂时不做

以下项目容易把第一版拖成另一个大型系统：

- 自动从所有 Apple recurring events 静默学习长期规律；
- 在 LiliumOS 里复刻完整 Apple Calendar 编辑能力；
- 24 小时连续 GPS；
- 为每次计划 slot 自动生成详细“已发生剧情”；
- 一开始就做 Tier 0–3 的完整通用行动政策引擎；
- 把 Forum、工作本本、地图、Calendar 各自建立一套后台世界状态；
- 用一个未经校准的 `urgeToContactUser` 数字决定所有主动联系；
- 把角色每次后台 noop 都显示成值得关注的生活事件。

---

## 14. 验收场景

### 14.1 Emma 的现实时间

1. 周二有课程时，Calendar 显示忙碌窗口；获准角色知道 Emma 在上课，但看不到私密备注。
2. Mac mini 离线时，页面显示上次同步结果与时间，不把旧结果写成最新事实。
3. Apple 中完成或删除 Reminder 后，下一次同步停止角色跟进；本地 overlay 不复活原事项。

### 14.2 角色的一天

1. 高管角色的一周能自然出现工作、商务社交、个人生活和独处，不是“会议 + 签文件 + Emma”。
2. 游戏型角色会自己玩、和朋友玩或独处，和 Emma 的互动占比符合 Life Model。
3. 几小时没聊天后，角色能衔接当前计划；没有后台证据时不会编造具体已发生细节。

### 14.3 行为一致性

1. 角色在 hard meeting 中可以短回复，但不能声称已经离开。
2. 从办公室到家必须经过出发和通勤；状态未完成前不能显示已到家。
3. 角色计划变化、位置状态和地图 pin 使用同一份 Runtime State，不出现三套答案。

### 14.4 后台自治

1. 影子运行不执行工具、不发消息、不污染真实 Timeline。
2. 真正醒来后可以 noop 或只写动态；没有话时不会硬发问候。
3. 过期心跳消息不会几天后作为刚说的话进入聊天。
4. 写 Apple Reminder / Calendar 时断电重启，不会重复创建。

### 14.5 数据安全

1. 旧 Calendar 数据升级后仍可读、可导出、可恢复。
2. Apple 原件、本地 overlay、角色计划和实际事件各有稳定 ID 和来源。
3. 后端关闭时，本地 Calendar、聊天和现有 amsg 继续工作。

---

## 15. 开工前需要 Emma 决定的产品问题

这些决定会改变数据模型，适合在实现前逐项确认：

1. Calendar 对用户显示的正式名称保留“日程”，还是改成“共同生活 / Shared Life”？
2. Apple 事件默认只暴露忙碌窗口，还是课程标题也默认对全部角色可见？
3. 角色 Life Model 由 Emma 手动编辑为主，还是先由 AI 生成草稿再确认？
4. 旧 Task 的“监督人验收”迁到 Calendar 的“挑战”，还是以后放入单独的关系玩法入口？
5. 旧 Agenda 是否保留 Lilium 本地共同计划，还是提供一键转 Apple 后逐步退役？
6. Calendar 是否只展示当前选择角色，还是允许在 Today 首页快速切换多个角色？
7. Agent Backend 开始运行后，角色实际活动保留多久；Calendar 展示摘要，CheckPhone 展示完整记录，这个分工是否接受？

---

## 16. 推荐的第一批开发边界

第一批只承诺完成以下闭环：

```text
Apple 现实时间只读聚合
+ 手动确认 Routine
+ 角色现有 DailySchedule
+ 来源 / 新鲜度 / 可信度
→ Today 与 Shared Life 保守计算
→ 聊天获得简短时间状态
→ 旧数据完整迁移与备份
```

同时为 Runtime State 和 Agent Backend 快照预留接口，但不在这一批开启后台自主行动。

这批完成后，Emma 应该已经能看到一个真正有用的“共同生活时间页”；下一批再集中解决角色行动约束与后台活动，避免 UI、同步、提示词和自治四条线一次全部开工。
