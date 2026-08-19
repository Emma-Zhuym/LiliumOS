# LiliumOS - 手抓糯米机

Emma（阿萌）的 SullyOS 个人 fork。基于上游 [SullyOS](https://github.com/qegj567-cloud/SullyOS) 添加个人功能。

## Engram 跨 Agent 交接

本机通过 Piia Engram MCP 在 Claude Code 与 Codex 之间共享经过审核的工作记忆。

1. 每个新任务开始时，若 Engram 工具可用，先调用 `get_resume_brief` 读取 LiliumOS 最近一次交接；首次或上下文不足时再调用 `get_user_context`。
2. 完成实质性工作或准备切换 Agent 时，调用 `wrap_up_session`，记录完成内容、改动文件、验证结果、未解决问题和下一步。不得把它当作完成用户未授权操作的理由。
3. 重要经验和决策分别用 `add_lesson`、`add_decision` 提议保存。当前为 strict 模式；出现待审核内容时，向 Emma 展示摘要并等待明确批准。
4. 不存储密码、API key、token、个人敏感数据、论文受限原文或未经确认的推测。Git、仓库文档、原始数据和文献引用仍是事实来源；Engram 只做交接与检索层。
5. Engram 不可用时继续工作，并在任务末尾明确说明本次交接未写入。

## ⚠️ UI 铁律（写任何界面代码前必须遵守——这是规则，不是建议）

规则全文：`../design_prototype/design-system/`（`DESIGN_SYSTEM.md` + `APP_CONVENTIONS.md`）。
**动 UI 前必须完整读过 APP_CONVENTIONS.md 的 §0 页面骨架硬规格**，并且：

1. **样式取值只能来自 `utils/clayTokens.ts` 常量（F/S/R/HUE/STATUS/MOTION）**。
   UI 代码里出现裸 hex 颜色、手写 boxShadow 字符串、自造 borderRadius = 违规，必须返工。
   tokens 里没有需要的值 → **停下来问阿萌**，不许自己发明阴影/颜色/圆角。
2. **顶栏/返回钮/标题逐字抄 §0.2/0.3/0.4 配方**：新 App 进 `utils/safeAreaApps.ts` 自理名单、
   让位只写 `var(--chrome-top)`（禁止手拼 safe-top 算式）、返回钮 = 44px 凸起圆钮
   （CaretLeft 20px bold textSecondary，子页/表单页同样，禁止裸文字"‹ 返回"）、
   居中标题 16px/600、顶栏放滚动容器外 shrink-0。
3. **每屏彩色预算**：1 Product 主色 + ≤1 辅助色 + 状态色；大面积只许 Tint；
   全系统禁止渐变填充；界面 chrome 禁止 emoji（用 2px 描边 icon）。
4. **完工自查**：新页面与 Health/Bank 截图摆一起对比顶栏——不像同一个系统 = 抄漏了，回 §0 重对。
5. 遇到公约没覆盖的新模式 → 按通用公约推导 → **把结果补录进 APP_CONVENTIONS.md 第二部分模式库**。

## 上游合并策略

SullyOS 会持续更新，需要定期合并上游改动。**建议两周一合，别攒**（上游一周能出几十个提交，攒久了很痛）。

### 合并前审批闸门（最高优先级）

**先汇报上游更新，再由阿萌决定要哪些，最后才允许执行合并。** 上游没有 Git 冲突，不代表阿萌接受它新增的产品功能。

1. 调研阶段可以 `git fetch`、查看 log/diff、读取代码和测试，但不得创建或切换合并分支，不得 merge、rebase、cherry-pick、commit 或 push。
2. 必须先汇报：提交范围和规模、所有用户可见新功能、行为变化、修复与工程改动、和 EM 功能的重叠或冲突，以及逐项建议保留/排除/改造的方案。
3. 汇报后等待阿萌明确批准。`看看`、`研究一下`、`合并看看`、`看看怎么合`只表示先调研，不是执行授权；只有“按这份清单开始合并”“这些全部要”“把 A/B/C 合进去”等明确答复才算批准。
4. 即使 Git 自动合并成功，只要是用户可见功能或行为变化，也必须事先列出供阿萌选择。不得把“技术上无冲突”等同于“产品上默认接受”。
5. 获批后才建立 `merge-upstream-YYYY-MM-DD` 分支。机械冲突按下方策略和 EM 哨兵处理；涉及产品行为、UI、数据语义或两套功能取舍的冲突必须再次询问。
6. 验收分支完成后先汇报。推进或 push `main` 需要单独、明确批准，不能从“同意合并到验收分支”自行推断。
7. 如果误操作，立即停止并准确报告 main、工作分支和远端状态；未经阿萌允许，不得删除分支、reset 或 force push 来掩盖。

这条规则高于代理默认的主动执行习惯。

- **上游大改的文件** → 用 SullyOS 版本作为基础，把 EM 个人功能加回去
- **上游小改的文件** → 保留 EM 版本，把上游改进 cherry-pick 进来
- **EM 独有的文件** → 不受合并影响，直接保留

合并前先 `_em_backup/` 备份 EM 版本以便参考旧逻辑。

### 哨兵注释约定（2026-07 起）

所有留在上游文件里的 EM 改动都用统一标记包裹：

- 多行块：`// [EM-START: 功能名]` ... `// [EM-END: 功能名]`（JSX 里用 `{/* [EM-START: xxx] */}`）
- 单行改动：行尾 `// [EM: 功能名]`

merge 时 `grep -rn "EM-START\|\[EM:" --include="*.ts" --include="*.tsx"` 就能找到全部个人补丁。

### merge 后必跑自检

```bash
bash scripts/check-em-patches.sh   # 当前 79 项锚点检查，红了就是功能被冲掉
pnpm vitest run                    # 单元测试
```

### 提示词个人化 → utils/emPromptAddons.ts

EM 的大段提示词（发照片教学、引用教学、Notion日记/飞书/笔记/小红书压缩版）**全部在
`utils/emPromptAddons.ts`**，`chatPrompts.ts` 里只有 import + 一行函数调用。
改措辞直接改 emPromptAddons.ts；merge 冲突时保住 chatPrompts.ts 里的调用行即可。

## EM 个人功能清单

以下功能是 EM 独有的，上游没有，合并时必须保留：

### 1. 通讯录 (ContactsList / messageSubView)
- `components/chat/ContactsList.tsx` — 独立文件，不冲突
- `context/OSContext.tsx` 里的 `messageSubView` state (`'contacts' | 'chat'`)
- `components/PhoneShell.tsx` 里 `case AppID.Chat` 根据 `messageSubView` 切换显示
- `components/chat/ChatHeaderShell.tsx` 里的 `onOpenContacts` prop + 小房子按钮

### 2. Token 面板 (contextComposition)
- `hooks/useChatAI.ts` 里的 `ContextComposition` interface + state
- `utils/chatRequestPayload.ts` 里的 `contextBreakdown` 返回值（coreContextChars 等）
  - 必须 `import { ContextBuilder } from './context'` 并在 payload 里计算 `coreContextChars`
  - 返回值必须保留 `coreContextChars`、`systemCharsBeforeBilingual`、`bilingualAddonChars`、`recalledMemories`
- `components/chat/ChatHeaderShell.tsx` 里点击 ⚡ 数字展开详细面板，同时展示本轮实际召回的记忆简报（0 条也显示）

### 3. 写 Notion 快捷操作
- `components/chat/ChatInputArea.tsx` 工具栏第二页的"写 Notion"按钮（NotePencil 图标，amber 色）
- `apps/Chat.tsx` 里的 `handleNotionDiaryQuick` + action case `'notion-diary-quick'`
- `utils/chatPrompts.ts` buildMessageHistory 里 `notion_diary_nudge` 特殊处理
  - 必须在 `m.type === 'interaction'` 判断**之前**检查 `m.metadata?.kind === 'notion_diary_nudge'`
  - 替换为系统指令让 AI 用 `[[DIARY_START: 标题 | 心情]]...[[DIARY_END]]` 格式写日记
- `hooks/useChatAI.ts` 里 `createDiaryPage` 调用必须传第四个参数 `realtimeConfig.notionDiaryExtraProperties`
  - 这个参数控制 Notion 额外列（如 character 角色标签列），不传的话日记不会自动选角色

### 4. Notion 扩展数据库 (notionExtraConfig)
- `utils/notionExtraConfig.ts` — TAG 系统、多库管理
- `apps/Settings.tsx` 里 Notion 额外数据库配置 UI
- `types.ts` 里 `NotionExtraDatabase` 类型（字段：`id`, `name`, `tag`, `databaseId`）
  - 注意是 `name` 不是 `displayName`
  - 新建时必须包含 `id: crypto.randomUUID()`

### 5. CheckPhone 固定联系人
- `apps/CheckPhone.tsx` — 固定联系人 + 角色关联

### 6. ScheduleApp 分钟精度
- `apps/ScheduleApp.tsx` — `dateTime` 字段精确到分钟
- `types.ts` 里 `AgendaItem` 的 `dateTime?`, `charId?`, `reminderMinutes?`, `createdAt?`
  - `dateTime` 是 optional，代码中访问时必须用 `item.dateTime ?? ''` 防 undefined

### 7. 桌面图标排序
- `context/OSContext.tsx` 里的 `appOrder` / `setAppOrder` state
- `apps/Launcher.tsx` 里长按拖拽排序逻辑
- 第一页固定 12 个图标

### 8. 默认壁纸
- `context/OSContext.tsx` 里 `export const DEFAULT_WALLPAPER = 'linear-gradient(...)'`

### 13. 地图×日程 Clay 版（2026-07-10 重写）
- `apps/MapApp.tsx` — EM 独有文件，按 `Design_prototype/mapsystem/mapnew` handoff 重写为暖白 Clay + 紫主题
- 三屏：彼此的世界（hero 卡）/ 地图（凹陷井画布 + 角色头像 pin）/ 编辑世界；地图页底部日程上拉 sheet（时间线 + 内心独白）
- `utils/mapWorlds.ts` — EM 独有：地图世界 IndexedDB 存储 + `matchRegionForSlot`（regionId → 地点名 → 关键词三级匹配）
- **regionId 数据链**：`utils/scheduleGenerator.ts` 生成日程时把地图地点清单注入 lifestyle prompt，slot 直出
  `location`/`regionId`/`innerThought`（哨兵 `[EM-START: map-region-id]`）；`types.ts` ScheduleSlot 加 `regionId?`（行尾哨兵）。
  解析时校验 regionId 必须存在于清单，防幻觉。mindful 风格不注入（AI 存在体无物理位置）
- `utils/safeAreaApps.ts` 加了 `AppID.Map`（哨兵 `[EM: map-schedule-clay]`，check 脚本有锚点）
- MapWorld.cityName / MapRegion.description 为可选新字段，旧 IndexedDB 数据零迁移
- 日程生成入口在聊天工具栏「日程/情绪」，地图 sheet 不放生成按钮（去找 TA 即达）
- **日程密度**：`CharacterProfile.scheduleSlotCount?` 按角色保存，取值钳制为 5–12、缺省为 8；聊天日程/情绪弹窗的滑块在松手/键盘提交后才重生成，避免拖动时连续调 API。`utils/scheduleGenerator.ts` 的生活系和意识系 prompt 必须严格使用该数量，不能重新写死 5–7 或 8–10。

### 14. Finance 重设计 + 备份
- `apps/BankApp.tsx` / `utils/financeDb.ts` — 多账户、多币种、层级分类、流水、周期规则、趋势和“TA 怎么看”
- `context/OSContext.tsx` — Finance 账户/分类/交易/设置/周期规则的全量备份与恢复
- 不得在恢复时只还原基础交易而遗漏 `emFinanceRecurringRules`

### 15. Health 核心 + 备份（外部同步仍未完成）
- `apps/HealthApp.tsx` / `utils/healthDb.ts` / `utils/cycleCalc.ts` — 训练、睡眠、饮食、经期、症状、体重与周期推算
- `utils/healthContextBuilder.ts` → `hooks/useChatAI.ts` → `chatRequestPayload.ts` — 每轮聊天重新读取轻量健康摘要
- `context/OSContext.tsx` — Health 事件和个人目标配置随全量备份导出/恢复
- Apple Health 真导入、Notion 同步和 Health 内角色周评仍是 roadmap 待办，不能写成已完成

### 16. Shopping 投喂站 + 备份
- `apps/ShoppingApp.tsx` — 网购/外卖；整页、店铺目录与折叠店内商品列表都必须可滚动
- `context/OSContext.tsx` — 商品、店铺、订单、Wish 等 Shopping 数据随全量备份
- `constants.tsx` 中 Shopping 使用 `Storefront` 图标，不得回退为齿轮

### 17. EM 角色代记
- `utils/emScribe.ts` — 代记指令执行与去重
- `utils/chatPrompts.ts` / `utils/chatParser.ts` / `apps/Chat.tsx` / `MessageItem.tsx` — 提示、解析、卡片分流和展示
- 健康/花销摘要由各自 ContextBuilder 注入，代记提示词不要重复灌入

### 18. Launcher、App 图标与引用气泡
- `utils/launcherPagination.ts`：首页 12 个（三行）、第二页 pinwheel 8 个、普通页 20 个（五行）
- Health / Shopping / Map 图标分别为 `Heartbeat` / `Storefront` / `MapPin`
- `MessageItem.tsx` 的 `sully-message-stack` 保证引用和正文独立宽度；整组方向只看当前消息（用户右、角色左），不能按被引用者决定；`.sully-quote-bubble` 是引用专用 CSS 钩子

### 19. 文字语音条与上游主题设置
- `m.metadata.voice === true` 是 EM 的用户文字语音标记：只改变用户消息的展示形态和聊天历史语义，不调用 TTS，也不得影响角色是否能发语音。
- 角色能否输出 `<语音>` 仅取决于 `char.chatVoiceEnabled`；即使没有 MiniMax / Fish 音色或 API，提示词仍允许角色发送 `<语音>`，`MessageItem.tsx` 必须保留可“转文字”的占位语音条。
- 真实自动合成额外要求 `characterHasVoice(char, apiConfig)`；未配置时只跳过合成，不能阻断标签输出或改成普通文本。
- `apps/ThemeMaker.tsx` 与 `MessageItem.tsx` 的 `voiceBarBg`、`voiceBarActiveBg`、`voiceBarBtnColor`、`voiceBarWaveColor`、`voiceBarTextColor` 是上游主题契约。EM 用户文字语音也必须复用它们；不得删除面板或用普通气泡颜色替代。

### 20. 角色聊天 API 独立绑定
- `CharacterProfile.chatApiPresetId` 只引用「设置 → API」中已有的命名预设；未设置或预设删除时必须回退主 API。
- Chat 快捷栏切换 API 只更新当前角色，不能调用 `updateApiConfig` 改动全局主 API；角色设定页与 Chat 共用同一字段。
- `utils/characterApi.ts` 是私聊、本地主动消息、QQ Bridge 与 Active Message 2.0 的统一解析入口；主动消息专用 `secondaryApi` 仍保持更高优先级。
- 分享角色卡必须剥离本机 `chatApiPresetId`，完整备份则保留角色和预设引用。

### 21. Smart Home「共栖舱」App + 备份
- `apps/SmartHomeApp.tsx` / `utils/smartHome.ts` — Home Assistant 灯光、风扇/空气净化器和场景控制；演示模式与真实 REST 模式必须并存
- RGB 控制必须依据灯实体的 `supported_color_modes`（或已有 `rgb_color`）按能力显示，通过 `light.turn_on` 的 `rgb_color` 写入；普通白光灯不得显示无效取色器
- `utils/smartHome.ts` 的角色控制复用通用 MCP 客户端，将 Home Assistant `/api/mcp/assist` 保存为 MCP server；不得另造聊天工具链
- `context/OSContext.tsx` / `utils/db.ts` — `smartHomeLocal` 随完整备份导出/恢复，不得遗漏连接配置
- `utils/safeAreaApps.ts` 必须保留 `AppID.SmartHome`，确保顶栏和内容区遵循安全区约定
- 真实 Tapo / Levoit 实体字段尚待 Home Assistant 主机验收，不能写成已完成硬件联调

### 22. Active Message 2.0 心跳醒来
- `utils/amsgHeartbeat.ts` 是浏览器与 Worker 共用的纯协议层；不得引入 DOM、IndexedDB 或 localStorage
- 心跳是一串隐藏的一次性任务：`worker/amsg/src/index.ts` 每次 fire 必须先幂等续排下一跳，再判断热聊让路、连发上限、生成或 NOOP
- `heartbeat_control.generation` 是关停与改频率的竞态锁；旧链代次不一致时必须直接结束，不得续排
- 心跳间隔默认带确定性时间波动（约 10%，最少 ±5 分钟、最多 ±20 分钟）；禁止在 fire 里直接用 `Math.random()`，同一次重试必须得到相同 next time 与 uuid
- 心跳睡眠闸必须发生在模型、副 API 与工具调用之前：`fire_pack v8.sleepWindow` 的明确跨午夜区间优先，同时可识别当天 `scene.schedule` 的明确睡眠时段；按角色 `tzId` 计算，只拦心跳，不得误伤用户明确排下的普通消息或即时对话
- 心跳撞上同角色活跃会话时遵守角色级 `heartbeatActiveChatPolicy`：缺省 / 非法值为 `skip`（API 前跳过）；`merge` 才允许继续生成，并必须临时换成“顺着当前话题、尽量一条短消息、无内容 NOOP”的指令。策略写入 `heartbeat_control.activeChatPolicy`，切换时原位更新，不得为此重建心跳链
- 日常节律、睡眠区间或日程重生成完成后必须再次 `markAmsgStateDirty`；只在修改角色字段时同步会把生成前的旧 schedule 上传到云端
- `[[HEARTBEAT_NOOP]]` 只表示本次安静，Worker 必须剥掉并 `skip-push`，不得把标记送进聊天或写成失败记录
- 心跳默认使用角色自己的主动消息 API 路由，也可按角色选择复用 `emotionConfig.api` 作为省钱通道；该选择只影响心跳，不得改写普通聊天、即时对话或普通排程路由
- 情绪副 API 三件套不完整时必须安全回落；新版 Worker 使用 `credRefs.chat → char:<id>/emotion`，不得把 Key 复制进心跳 metadata 或推送
- 只有 Elias 的未来 Codex bridge 是专属通道
- 即时聊天建任务前必须按当前运行端重新登记推送目标：原生端走 FCM、Web/PWA 走当前 PushSubscription；登记失败时不得创建任务或调用模型。云端调用结果以 task uuid 幂等写入本机 API 调用记录，pending 只保存 baseUrl / model，禁止保存 API key
- 上游推送订阅仍是每用户单行；当前保证“发送即时聊天的设备拿回这一轮回复”，不代表多设备同时广播。真正多端推送需独立 device subscription 与按设备 ACK 设计
- 心跳不进入普通任务清单，但 `hasActiveAiTask` 必须把它算作需要持续同步 fire_pack 的 AI 任务
- 发布该功能时前端与 `worker/amsg/worker.bundle.js` 必须成对更新；详细契约见 `docs/amsg2-heartbeat.md`

### 23. 七夕「星月梦境童话」
- `components/ValentineEvent.tsx` 必须用 `resolveCharacterApiConfig` 为所选角色解析 API；不得退回直接把全局 `apiConfig` 传给七夕会话
- 新旅程实际调用 4 次模型 API，活动卡和生成前确认文案必须一致；重看旧记录不得调用模型或重复写入私聊
- `qixi_event_card` 与角色返回消息以 `qixiRunId` 幂等写入，完整活动内容通过 `utils/qixiChatCard.ts` 进入后续聊天上下文
- `qixi_2026_dual_layer_v7` 是稳定存储键；内部快照版本升级时不得顺手改键导致旧记录失联
- 七夕专用召回上限 20 条只通过 `injectMemoryPalace` 的可选参数生效，不得改变普通聊天召回上限
- 详细契约见 `docs/qixi-special-moment.md`

## 合并时常见坑（踩过的 bug）

### PhoneShell.tsx — messageSubView 必须解构
`useOS()` 解构时**必须**包含 `messageSubView`，否则 Chat 页面直接白屏（只剩背景图）。
```
const { ..., messageSubView } = useOS();
```

### ChatHeaderShell.tsx — 头像栏排版
标准布局 (`renderStandardInfo`) 的正确排版：
- **第一行**：名字 + online + ⚡token + 情绪分析中（flex-wrap 自动换行）
- **第二行**：心情状态 buff 标签（仅在有 buff 时显示）
- 头像尺寸 `w-10 h-10`，行间距 `gap-0.5`

### chatPrompts.ts — 日程注入
上游 `chatPrompts.ts` 的 `buildSystemPrompt` 会调用 `ContextBuilder.buildScheduleInjection()` 注入角色日程。如果用旧版 EM 的 chatPrompts 会导致角色聊天时完全不知道自己的日程（比如该开会的角色说去床上等你）。合并时优先用上游版本。

### chatPrompts.ts — notion_diary_nudge
上游的 chatPrompts 没有 `notion_diary_nudge` 处理。合并后必须在 `buildMessageHistory` 的 interaction 类型判断处手动加回：
```typescript
if (m.type === 'interaction' && m.metadata?.kind === 'notion_diary_nudge') {
    content = `${timeStr} [系统: 用户通过快捷操作希望你立刻写一篇 Notion 私人日记...]`;
} else if (m.type === 'interaction') content = `${timeStr} [系统: 用户戳了你一下]`;
```

### useChatAI.ts — contextComposition 不能硬编码 0
合并上游 useChatAI 后，`setContextComposition` 里的值不能写死为 0，必须从 `payload.contextBreakdown` 读取实际值。

### useChatAI.ts — notionDiaryExtraProperties
`NotionManager.createDiaryPage()` 必须传第四个参数 `realtimeConfig.notionDiaryExtraProperties`，否则 Notion 日记不会自动填充角色标签等额外列。

### types.ts — NotionExtraDatabase
字段名是 `name`（不是 `displayName`），合并时注意不要搞混。

### ValentineEvent.tsx — 520 等活动入口
特别时光 App 的活动入口在 `ValentineEvent.tsx` 的 `SpecialMomentsApp` 组件里。上游新增活动时需要更新此文件（如 Like520Event 的 import 和卡片入口）。

### Like520Event.tsx — 自动存档
已加 `useEffect` 在 callA + callB + chibis 齐全时自动存档，防止闪退丢失活动进度。上游版本只在用户手动点"下一步"时才存档。

## 架构原则

0. **上游文件的纯类型瑕疵不修**（阿萌 2026-07-10 定）：上游 build 只跑 vite 不跑 tsc，他们看不见自己的类型错误（MemoryPalace 的 char 断言、vite.config 隐式 any 等 ~60 个）。修了只会给未来 merge 埋散点冲突。tsc 错误数只修 EM 自己文件的，数字跟自己比。真影响运行时行为的 bug（如 healthDb openDB 笔误）不在此限。

1. **个人新功能尽量做成独立文件**（新 App、新 util），减少对上游文件的侵入
2. **必须改上游文件时**，改动越小越好——加一行 import、加一个 case、加一个 hook 调用
3. **不要大面积重写上游文件**，否则每次合并都痛苦
4. **未来新功能**（如 Notion 高级管理）建议做成独立 App（`apps/NotionApp.tsx`），配置和逻辑放自己的文件里，跟上游 Settings 里的基础 Notion 配置互不干扰

### 9. 天气 Open-Meteo（免 key）
- `utils/openMeteo.ts` — 独立模块：WMO code 中文映射、geocoding 城市搜索、坐标解析（geo/city 双模式）
- `utils/realtimeContext.ts` — `fetchWeather` 改走 Open-Meteo，`RealtimeConfig` 的 `weatherApiKey/weatherCity` → `weatherMode/weatherLocation`（存坐标，城市名仅显示）
- `context/OSContext.tsx` — 旧 OpenWeatherMap 配置迁移（转 city 模式但留空，**不要自动 geocoding 选第一个**）
- `apps/Settings.tsx` — 模式切换 + 城市搜索候选（三段显示根治 Birmingham 重名）
- `types.ts` — RealtimeConfig 天气字段（与 realtimeContext.ts 那份**双份定义要同步改**）
- 哨兵：`[EM-START/END: weather-openmeteo]`

### 10. 照片收藏 + 查手机轮播
- `types.ts` — `GalleryImage.favorited?: boolean`（undefined 视为 false，零迁移）
- `utils/db.ts` — `updateGalleryImageFavorite`
- `apps/Gallery.tsx` — 详情页星标钮 + 缩略图星角标 + 全部/收藏筛选
- `apps/CheckPhone.tsx` — `PhotoCarouselWidget`（收藏优先池上限 12、无收藏回退最近 4 张、5s crossfade、visibilitychange 清 timer）
- 哨兵：`[EM-START/END: photo-favorites]`

### 11. Token 面板召回展示
- `utils/memoryPalace/recallBrief.ts` — 独立模块：模块级缓存 charId → RecalledMemoryBrief[]（与 recallReceipts **平行**，别耦合）
- `utils/memoryPalace/formatter.ts` — expandAndFormat 在写回执同一位置落简报（RenderItem 的 briefId/briefSnippet/briefSource）
- `utils/chatRequestPayload.ts` — inject 前 `clearLastRecallBriefs`，contextBreakdown 加 `recalledMemories`
- `hooks/useChatAI.ts` / `components/chat/ChatHeaderShell.tsx` — ContextComposition 穿透 + ⚡ 面板「🧠 本轮召回记忆」小节（0 条显示"未触发"，不隐藏）
- 哨兵：`[EM-START/END: token-panel-recall]`

### 12. Online/Busy/Offline 状态系统
- `utils/charStatus.ts` — 核心逻辑：根据日程 slot 计算状态，关键词 fallback
- `hooks/useCharStatus.ts` — React hook，精确 setTimeout + visibilitychange
- `utils/scheduleGenerator.ts` — 生成日程时 LLM 直接标注 `availability` 字段
- `types.ts` 里 `ScheduleSlot.availability?: 'online' | 'busy' | 'offline'`
- `ChatHeaderShell.tsx` — 状态 badge 颜色 + 文字
- `Chat.tsx` — offline 时插入🌙提示气泡 + 延迟 AI 回复到 slot 结束
- `chatRequestPayload.ts` — busy 时注入简短回复提示
- `ScheduleCard.tsx` — 编辑时可手动覆盖状态
- 三层判断优先级：手动覆盖 > LLM 生成 > 关键词 fallback

## 未来功能计划

当前优先级和完成记录统一维护在 `docs/roadmap.md`；这里仅保留会影响架构边界的摘要，避免两份清单再次漂移。

1. **Health 外部数据链收尾**：Apple Health 真导入、Notion 同步、角色周评。
2. **Notion 高级管理 App**：独立 `apps/NotionApp.tsx`，不重写 Settings；整合多库权限、模板和标签。
3. **位置感知聊天**：`utils/locationService.ts` + Google Places + 显式权限/隐私开关。
4. **日记系统整理**：独立 `apps/DiaryApp.tsx`，统一交换日记与 Notion 日记。
5. **共读增强**：批注回信支路、文字高亮、PDF。
6. **角色时区/多人日程尾项**：先按 `docs/character-timezone.md` 的产品决策处理，不要把角色时间和设备时间混用。

已完成、不要重复立项：地图×日程、Intiface、Finance 重设计、照片收藏、Token 召回面板、Offline 状态系统。

## 文件说明

- `_em_backup/` — 合并前的 EM 旧版备份，供参考旧逻辑用
- `.claude/launch.json` — Vite dev/preview server 配置
- 部署：Vercel（绑 GitHub main 分支自动部署）+ GitHub Pages

## UI 设计系统 — Emma Soft Clay UI

**所有 UI 改动必须遵循 [`design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) 的规则。**

- 颜色、圆角、阴影、间距、字体、动画的值只从 `design-system/tokens.json` / `tokens.css` 取，不许自己编 hex 值
- 基底色是 V2 cooler-neutral（`#F7F6F2`），不是纯白也不是暖黄
- 核心质感：**凹凸并存** — 凹陷区（输入框、segmented、进度条）+ 凸起区（按钮、卡片、sheet）
- 色彩比例硬性规定：暖中性底 ~75%、模块 Tint ~18%、高饱和 Main ~7%
- 每屏最多 1 主色 + 1 辅色 + 1 状态色
- 参考 HTML 样例：`design-system/Emma Soft Clay UI v2.dc.html`

## 技术栈

React + TypeScript + Vite + Tailwind CSS + IndexedDB（Dexie）
