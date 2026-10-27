# LiliumOS - 手抓糯米机

Emma（阿萌）的 SullyOS 个人 fork。基于上游 [SullyOS](https://github.com/qegj567-cloud/SullyOS) 添加个人功能。

## MacBook / Mac mini 代码同步

Emma 会在 MacBook 和 Mac mini 上交替修改 LiliumOS。日常开发以自己的 `origin` 仓库作为代码交接点（2026-09-12 用户明确要求）。

1. 开工前检查当前分支、远端跟踪关系和未提交改动；确认目标分支后先 `git pull --ff-only`，读完远端新增改动再开始编辑。
2. 若有未提交改动、分支分叉或冲突，先保留现场并说明情况；不得自动丢弃改动、覆盖文件、stash、reset 或强推。需要取舍的冲突交给 Emma 决定。
3. 完成已授权改动并通过相应验证后，检查 diff，只提交本次任务的文件，再 push 到 `origin` 的对应分支；普通开发的 commit / push 已获得此项长期授权，无需每次重复询问。
4. 推送前再次检查远端是否前进。若推送被拒绝，先取回并检查另一台电脑的改动，解决并重新验证后再推送；不得使用 force push。
5. 收尾说明当前分支、提交号、pull / push 结果及未提交内容。未推送的代码不能称为已经跨电脑同步；换电脑后仍需先 pull，避免两台同时修改同一分支。
6. 本约定仅适用于自己的 `origin` 日常协作；SullyOS 上游同步、验收分支推进 `main` 和相应 push 仍遵循下方独立审批闸门。

## 仓库文档跨 Agent 交接

LiliumOS 默认只用 Git 跟踪的仓库文档在 Claude Code、Codex、两台电脑和 cloud session 之间交接。Engram 不再是本项目的开工或收尾步骤；不要自动调用 `get_resume_brief`、`wrap_up_session`、`add_lesson` 或 `add_decision`，也不用在收尾时报告“Engram 未写入”。只有阿萌当次明确要求使用 Engram 时才调用，并继续遵守其 strict 审核。

1. 开工先 pull，再按任务读取 `docs/changelog.md`、`docs/roadmap.md`、`docs/ideas.md`、相关 `docs/spec-*.md` 和 `notes/todo.md`；Git 中的当前文件与提交历史是事实来源。
2. 新点子只进 `docs/ideas.md`；决定做或待验收的进 `docs/roadmap.md`；完成项进 `docs/changelog.md`；跨 session 的完整实施契约进对应 `docs/spec-<功能名>.md`；纯代码层欠账进 `notes/todo.md`。
3. 一项工作没做完就要换 Agent 时，在已有相关 spec 或 todo 中补“已完成 / 已验证 / 未解决 / 下一步”，不要另开同类交接清单；更新后随代码一起 commit / push。
4. 密码、API key、token、cookie、个人敏感数据、论文受限原文和未经确认的推测不得写入仓库文档。

## ⚠️ UI 铁律（写任何界面代码前必须遵守——这是规则，不是建议）

规则全文在仓库内：`design-system/DESIGN_SYSTEM.md` + `APP_CONVENTIONS.md`（v1.0「F」，2026-09-25 定稿）。
**动 UI 前必须读过这两份**，并且：

1. **样式取值只能来自 `utils/clayTokens.ts` 常量（F/S/R/HUE/STATUS/FONT/OVERLAY/MOTION）**。
   UI 代码里出现裸 hex 颜色、手写 boxShadow 字符串、自造 borderRadius = 违规，必须返工。
   v1.0 是全平：`S.*` 全为 none，不许用手写阴影把「凸起感」加回来。
   tokens 里没有需要的值 → **停下来问阿萌**，不许自己发明阴影/颜色/圆角。
2. **顶栏**：新 App 进 `utils/safeAreaApps.ts` 自理名单、让位只写 `var(--chrome-top)`（禁止手拼 safe-top 算式）、
   返回钮 = **裸 icon**（CaretLeft 22px bold textPrimary，无底无描边无阴影，**触控区 44×44**；
   子页/表单页同样，禁止裸文字"‹ 返回"）、居中标题 = 衬线 `FONT.heading` + `FONT.navTitle`（17/700）、
   顶栏放滚动容器外 shrink-0。
3. **每屏彩色预算**：1 Product 主色 + ≤1 辅助色 + 状态色；大面积只许 Tint；
   全系统禁止渐变填充；界面 chrome 禁止 emoji（用 2px 描边 icon）。
4. **完工自查**：新页面与 Health/Bank 截图摆一起对比顶栏——不像同一个系统 = 抄漏了，回 §0 重对。
5. 遇到公约没覆盖的新模式 → 按通用公约推导 → **把结果补录进 APP_CONVENTIONS.md 第二部分模式库**。

## 吸收上游功能

LiliumOS 和 SullyOS 早就各走各的了（git 认的合并基线停在 2026-08-11，之后两边各自几百个提交、核心文件都改了几百行）。
**没有「合并上游」这件事了**：隔一阵看看上游出了什么，挑真正不错的小功能吸收进来，没有固定节奏（2026-10-21 阿萌定）。

### 吸收前审批闸门（最高优先级）

**先汇报上游有什么，再由阿萌挑要哪些，最后才动手。** 能干净套上，不代表阿萌想要这个功能。

1. 调研阶段可以 `git fetch`、查看 log/diff、读取代码和测试，但不得创建或切换验收分支，不得 merge、rebase、cherry-pick、commit 或 push。
2. 必须先汇报：提交范围和规模、所有用户可见新功能、行为变化、修复与工程改动、和 EM 功能的重叠或冲突，以及逐项建议要 / 不要 / 改了再要。
3. 汇报后等待阿萌明确批准。`看看`、`研究一下`、`看看上游有啥`、`合并看看`、`看看怎么合`只表示先调研，不是执行授权；只有“按这份清单开始”“这些全部要”“把 A/B/C 拿进来”等明确答复才算批准。
4. 即使 cherry-pick 能干净套上，只要是用户可见功能或行为变化，也必须事先列出供阿萌选择。不得把“技术上套得上”等同于“产品上默认接受”。
5. 获批后才建立验收分支 `upstream-picks-YYYY-MM-DD`（2026-10-15 及以前叫 `merge-upstream-YYYY-MM-DD`，旧分支不改名）。机械冲突按下方做法和 EM 哨兵处理；涉及产品行为、UI、数据语义或两套功能取舍的冲突必须再次询问。
6. 验收分支完成后先汇报。推进或 push `main` 需要单独、明确批准，不能从“同意吸收到验收分支”自行推断。
7. 如果误操作，立即停止并准确报告 main、工作分支和远端状态；未经阿萌允许，不得删除分支、reset 或 force push 来掩盖。

这条规则高于代理默认的主动执行习惯。

### 怎么吸收

- 每轮从上次看到的上游提交往后读（记在最新的 `docs/upstream-sync-YYYY-MM-DD.md` 的「看到哪里」），列清单给阿萌挑
- 选中的功能逐个进验收分支：能干净套上的 `git cherry-pick -x`；套不上的手工移植，提交写 `port(upstream <hash>): …`
- 跟 EM 结构差太多的，只参考思路、按 EM 结构自己写，提交里注明参考的上游提交
- **许可证**：上游 2026-10-02（`daf99a19`）起改为「源码可见许可」，改了自用需 Discord 社区授权（阿萌有），对外分发修改版要另拿书面许可；LiliumOS 仓库是公开的，10/02 之后的上游代码不直接搬进仓库，只读思路自己写
- 两边不会再有新的共同基线，别用 `git merge-base` 判断「看到哪了」，以同步记录文件为准

### 哨兵注释约定（2026-07 起）

所有留在上游文件里的 EM 改动都用统一标记包裹：

- 多行块：`// [EM-START: 功能名]` ... `// [EM-END: 功能名]`（JSX 里用 `{/* [EM-START: xxx] */}`）
- 单行改动：行尾 `// [EM: 功能名]`

`grep -rn "EM-START\|\[EM:" --include="*.ts" --include="*.tsx"` 就能找到全部个人补丁；往上游文件里移植改动前先看一眼，别把它们冲掉。

### 吸收后必跑自检

```bash
bash scripts/check-em-patches.sh   # 当前 346 项锚点检查，红了就是功能被冲掉
pnpm vitest run                    # 单元测试
```

### 提示词个人化 → utils/emPromptAddons.ts

EM 的大段提示词（发照片教学、引用教学、Notion日记/飞书/笔记/小红书压缩版）**全部在
`utils/emPromptAddons.ts`**，`chatPrompts.ts` 里只有 import + 一行函数调用。
改措辞直接改 emPromptAddons.ts；移植上游 chatPrompts 改动时保住里面的调用行即可。

## EM 个人功能清单

以下功能是 EM 独有的，上游没有，吸收上游功能时不得冲掉：

### 1. 通讯录 (ContactsList / messageSubView)
- `components/chat/ContactsList.tsx` — 独立文件，不冲突
- `context/OSContext.tsx` 里的 `messageSubView` state (`'contacts' | 'chat'`)
- `components/PhoneShell.tsx` 里 `case AppID.Chat` 根据 `messageSubView` 切换显示
- `components/chat/ChatHeaderShell.tsx` 里的 `onOpenContacts` prop + 小房子按钮
- 通讯录备注存 localStorage `em_contact_remark_<角色id>`（`utils/contactRemarks.ts`），随备份走 `emContactRemarks`；恢复只覆盖备份里有的角色

### 2. Token 面板 (contextComposition)
- `hooks/useChatAI.ts` 里的 `ContextComposition` interface + state
- `utils/chatRequestPayload.ts` 里的 `contextBreakdown` 返回值（coreContextChars 等）
  - 必须 `import { ContextBuilder } from './context'` 并在 payload 里计算 `coreContextChars`
  - 返回值必须保留 `coreContextChars`、`systemCharsBeforeBilingual`、`bilingualAddonChars`、`recalledMemories`
- `components/chat/ChatHeaderShell.tsx` 里点击 ⚡ 数字展开详细面板，同时展示本轮实际召回的记忆简报（0 条也显示）

### 3. 写 Notion 快捷操作
- `components/chat/ChatInputArea.tsx` 工具栏第二页的"写 Notion"按钮（NotePencil 图标，amber 色；2026-10-22 起第一页给了烛下、收藏夹、贴贴）
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
- `agenda` 表随全量/文字备份走（`agendaItems`，哨兵 `em-backup-gaps`）：导出清单、导入的 `availableStores` 和 `runSection` 三处都要在
  - `dateTime` 是 optional，代码中访问时必须用 `item.dateTime ?? ''` 防 undefined

### 7. 桌面图标与组件布局
- `context/OSContext.tsx` 里的 `appOrder` / `setAppOrder` 保留软件顺序；`theme.launcherDesktopLayout` 保存每个桌面项的页、行、列
- `apps/Launcher.tsx` 里长按进入编辑模式；时钟页恢复固定排版，其余页面的软件、文件夹、小组件在 4×6 网格中拖动；尺寸和冲突处理见 `utils/launcherDesktopLayout.ts`
- 默认打开中间的固定时钟页，保留 12 个图标；左侧是合并的月历与近期事件页。自由网格不占用时钟页

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

### 15. Health 核心、Apple Health + 备份
- `apps/HealthApp.tsx` / `utils/healthDb.ts` / `utils/cycleCalc.ts` — 训练、睡眠、饮食、经期、症状、体重与周期推算
- `utils/healthContextBuilder.ts` → `hooks/useChatAI.ts` → `chatRequestPayload.ts` — 每轮聊天重新读取轻量健康摘要；Apple Health 常驻只含活动/睡眠和七日极简节律，血氧等生命体征不得重新灌入
- `utils/externalHealth.ts` / `utils/externalHealthRoleSummary.ts` — HealthSync 当前快照、按日归档缓存与角色极简摘要；原始生命体征只留在 Health/HA 按需查看
- `context/OSContext.tsx` — Health 事件（`emHealthEvents`）和健康档案（身高体重、目标，`emHealthProfile`，存 localStorage）随全量/文字备份导出/恢复
- Apple Health 真导入已验收；Notion 同步、完整历史角色工具和 Health 内角色周评仍是 roadmap 待办

### 16. Shopping 投喂站 + 备份
- `apps/ShoppingApp.tsx` — 网购/外卖；整页、店铺目录与折叠店内商品列表都必须可滚动
- `context/OSContext.tsx` — 商品、店铺、订单、Wish 等 Shopping 数据随全量备份
- `constants.tsx` 中 Shopping 使用 `Storefront` 图标，不得回退为齿轮
- `utils/shoppingFamily.ts` — 四种订单互通：我给 TA 自动进 TA 查手机的淘宝和外卖（只读映射）；TA 给我只由心跳 `gift` 下单（惊喜由 TA 定），投喂站不再手动录；「给自己」与家属关联角色心跳下的单只在关联后互相可见
- **惊喜礼物三处都要藏住**：投喂站、TA 查手机里那条（查手机就是阿萌在翻，所以礼物单一律由 `shopOrdersAsPhoneRecords` 实时映射、`emLife` 不写记录）、起居注那一句（后端 `veilSurprise` 换成不点破的说法，买了什么留在 `model_runs.episode.life`）。送到即揭晓
- 网购是直接填单（名称/价格/规格），不走商品目录和购物车；外卖保留店铺目录 + 购物车
- **送达时间由后端定**（`server/agent-backend/shopping.mjs`）：心跳抽中买东西先抽送达时刻写进提示词（网购分当天达 / 次日达 / 普通快递三档，**选哪档由模型按买的东西定（`ship`），几点到由程序定**），`life.eta` 带去前端（查手机记录 `PhoneEvidence.eta`、礼物单 `etaTimestamp`）；没有 `eta` 的旧数据退回写死估计，别删这条退路。同一处把最近 7 天买过的列给 TA，防重复下单
- 外卖和网购都由 `sweepDeliveries` 到点自动签收；**退单不删单**：状态 `cancelled` + `cancelledAt`，TA 自己的心跳单退款标在查手机那条记录上（`refundedAt` + 「（已退款）」），跟 TA 有关的退单在私聊留一条系统消息（`refundNotice`）

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

### 22. 七夕「星月梦境童话」
- `components/ValentineEvent.tsx` 必须用 `resolveCharacterApiConfig` 为所选角色解析 API；不得退回直接把全局 `apiConfig` 传给七夕会话
- 新旅程实际调用 4 次模型 API，活动卡和生成前确认文案必须一致；重看旧记录不得调用模型或重复写入私聊
- `qixi_event_card` 与角色返回消息以 `qixiRunId` 幂等写入，完整活动内容通过 `utils/qixiChatCard.ts` 进入后续聊天上下文
- `qixi_2026_dual_layer_v7` 是稳定存储键；内部快照版本升级时不得顺手改键导致旧记录失联
- 七夕专用召回上限 20 条只通过 `injectMemoryPalace` 的可选参数生效，不得改变普通聊天召回上限
- 详细契约见 `docs/qixi-special-moment.md`

### 23. 位置感知聊天
- `utils/locationService.ts` — 家/学校/多个常去超市的本机地理围栏、地图链接/坐标解析；未命中统一为`在外面`
- `components/RealLocationPicker.tsx` / `apps/MapApp.tsx` — OpenStreetMap 选点、范围管理、现实范围到每个角色虚拟地图的绑定与双人标记
- `utils/locationChatTool.ts` / `hooks/useChatAI.ts` — 角色仅在本地聊天中按需调用粗略位置工具；禁止把经纬度写进提示词或工具结果
- 精确围栏只存当前浏览器 `localStorage`，不得进入 API 日志、Engram 或完整备份；PWA 后台定位仍未实现
- 详细契约见 `docs/location-awareness.md`

### 24. Apple Calendar / Reminders 私有 MCP 桥接
- `server/apple-events-bridge/` — 把 macOS 专用 `mcp-server-apple-events` stdio 传输转换为 LiliumOS 通用客户端支持的 Streamable HTTP；不得另造聊天工具链
- Mac mini 参考部署只监听 `127.0.0.1:8765`，由 LaunchAgent 常驻，并用 Tailscale Funnel 暴露单个 HTTPS 服务；不得开放家庭路由器端口
- Bearer Token 只存 mini 的 `~/Library/Application Support/LiliumOS/agent-tools/secrets/` 权限受限文件；严禁写入仓库、plist、日志、文档、Engram 或备份
- CORS 只允许 localhost 与正式 Pages origin；`Mcp-Session-Id` 必须暴露给浏览器，未带 Token 的 MCP 请求必须返回 401
- 已验收五项工具：提醒事项任务/列表/子任务、日历事件、日历列表；日历事件可读写，日历集合及闹钟/重复规则等高级字段保持只读
- `utils/mcpFireCore.ts` 的模型 schema 归一化必须同时供前台和 amsg worker 使用：非字符串 enum 只从模型声明副本移除，原始 MCP schema 与真实调用参数不得改写
- 该能力依赖 mini 在线且用户已登录；不能写成完整 Agent Backend、主动心跳或 Apple Health 已完成
- 详细部署与边界见 `server/apple-events-bridge/README.md`、`docs/mcp-client.md`
### 25. 朋友圈 App
- `apps/MomentsApp.tsx` / `utils/moments.ts` / `utils/momentsDb.ts` / `utils/momentsLook.ts` — 所有人的动态汇总：角色动态直接读查手机 `type: 'social'` 记录，用户动态、点赞评论存 `LiliumOS_Moments`
- 亲友评论（3–5 条）、虚拟赞数、屏蔽分组与动态**同一次生成**，存在 `PhoneEvidence.moment`（查手机刷新和心跳 `life.moment` 两处都写）；npc 不接话
- 用户动态可选「谁可以看」；「让大家看看」用各角色自己的 API 立即刷一遍（带图识图、带最近 30 条私聊）
- **心跳刷朋友圈**：快照 `userMoments` 带阿萌 48 小时内、TA 没回应过的动态（只有文字和配图张数）；后端 `moments.mjs` 记「看过了」（`moments_seen:<charId>`），醒来顺手点赞 / 评论，`moment_reaction` 静默送回、`utils/emMomentsContext.ts` 写进 `LiliumOS_Moments`；回消息的那一跳不刷
- **聊天看得到朋友圈**：`buildMomentsChatInjection` 把 48 小时内阿萌发的和 TA 自己发的（含评论）放进 volatileState
- `context/OSContext.tsx` 的 `emMoments` 随备份导出/恢复，文字备份不带图且恢复时保留本机图片

### 26. 日历（现实时间接入）
- `apps/CalendarApp.tsx` / `utils/emTemporal.ts` / `components/settings/AgentTemporalPanel.tsx` — 阿萌真实的 Apple 日历与提醒，mini 每天同步一次到后端缓存，手机只读缓存
- **手机端永远不直连桥接**：列日历（`calendar_calendars`）在 EventKit 那边就要三十秒，只有设置页那一下允许等，聊天和 App 路径一律读缓存
- 可见性默认**全部不给看**，逐个日历 / 提醒清单选 不给看 / 只知道我在忙 / 能看到标题；`busy` 档进角色上下文时只剩「有安排」，地点一律不进
- 重复事件按 `occurrence_key`（事件 ID + 开始时间）存，别退回拿事件 ID 当主键——那样一门课只剩第一次
- 写回苹果（建提醒 / 勾完成）走同步接口、不排队；写完只把那一条塞进缓存，整表重写留给每天那次同步
- 桥接建不了重复规则，事件的重复只能在苹果日历里建
- 日历内容和桥接 Token 一样不得进日志、文档、Engram 或备份
- **角色的约定**（心跳里 TA 跟亲友约下的事，后端 `life_threads.due_at`）经 `GET /plans` 拉到本机 `utils/emAgentPlans.ts` 缓存：日历 App 摆在对应那天（中性灰 + 角色头像），聊天提示词告诉 TA 自己两周内约了什么

### 27. 换皮「F」（2026-09-25）
- `utils/clayTokens.ts` 是唯一取值来源：全平（`S.*` = none）、中性底、圆角 12、OKLCH 16 色、`FONT` 衬线标题、`OVERLAY` 雾面浮层、`MOTION` 三条曲线
- `utils/clayMotion.css` 由 clayTokens 顶部 `import './clayMotion.css';` 引入；删掉这行所有动效（sheet 滑入、提示条、圆环画出、选中日弹出）都会失效
- **两处上游文件补丁**：`components/PhoneShell.tsx` 的提示条改为渲染 `components/os/ClayToast`（`[EM: skin-f-toast]`，一行 import + 一处替换）；`index.html` 字体链接末尾追加 `Noto+Serif+SC:wght@400;600;700`（上一行有 `[EM: skin-f]` 注释；400 是 2026-10-22 给烛下信笺正文加的）。吸收上游功能时保住这两处
- 其余 22 个引用 clayTokens 的上游文件不改代码、被动跟着换皮；其中 VRWorld / 记忆宫殿 / Launcher / Chat / CallApp 有上游手写阴影，暂时新旧混搭，按约定不改
- sheet 打开时自动聚焦必须 `focus({ preventScroll: true })`：sheet 从屏幕外滑入，普通 focus 会把整页外层滚上去（日历「记一件事」踩过）
- 日历与健康是样板：以后其他 App 迁移照这两个改
- `scripts/check-em-patches.sh` 的「换皮 F」一节有 8 个锚点

### 28. 小红书 MCP 常驻 mini
- `server/xhs-mcp/` — 上游 `xiaohongshu-mcp` 的 LaunchAgent 部署：只听 `127.0.0.1:18060`，用上游自带 `AUTH_TOKEN`（令牌文件 `agent-tools/secrets/xhs-mcp-token`），登录态由 `COOKIES_PATH` 存在私有目录；在 LiliumOS 设置里扫码登录，不再手抄 cookie
- `scripts/home-assistant-proxy.mjs` — Funnel 网关多一条 `/xhs/*`（去前缀转发），**只放行** `/xhs/mcp` 与 `/xhs/health`，上游 `/api/v1/*` REST 不从公网开
- `utils/xhsMcpClient.ts` — 请求带 Bearer（`xhsMcpConfig.authToken`）；新版上游是无状态服务器、不发 `Mcp-Session-Id`，握手后用 `tools/list` 验证即可，不得再一律报 CORS；`get_login_qrcode` 的图片内容转成 data URL 给设置页
- `utils/amsgToolPack.ts` / `worker/amsg/src/index.ts` — 令牌随工具配置上云，worker 直连 Funnel 时同样带上；改完要重跑 `node scripts/build-workers.mjs`
- 令牌和登录 cookie 不得进仓库、plist、日志、Engram 或备份；部署与排查见 `server/xhs-mcp/README.md`
- **心跳逛小红书**（`server/agent-backend/xhsFeed.mjs`）：生活小事里 `xhs` 占 0.08（从朋友圈分出）。程序先经本机直连 `list_feeds` 刷真实首页，模型只挑编号写感想，标题作者一律用首页真值；程序替 TA 点开第一条多看两眼的（`get_feed_detail`，第二次调模型）；点赞 / 收藏一跳最多两次；`share` 转发给阿萌时算开口（不能开口的那一跳丢弃），消息 payload 带 `xhsNote`，`utils/emAgentInbox.ts` 在话后接 xhs_card。心跳只准调 `XHS_BACKEND_TOOLS` 四个。角色没开小红书（快照 `xhsEnabled`）、后端没有 `xhs-mcp-token`、首页刷不到时退回发朋友圈。前端 `utils/emLifeXhs.ts` 落进小红书 App 活动记录 + 私聊一条自由活动系统消息
- **小红书只看不发**（阿萌 2026-09-26 定）：网关 `XHS_BLOCKED_TOOLS` 停用发帖 / 发视频 / 评论 / 回复评论 / 回复通知 / 删登录（tools/call 拒绝、tools/list 隐藏）；`emXhsSection` 不再教发帖评论；手动自由活动的 post 决策改为刷首页。不得把这几项加回来

### 29. 聊天交给 Mac mini 回复（即时回复）
- 规格 `docs/spec-agent-backend-instant-chat.md`；阶段一已做，阶段二（主动消息排程搬到 mini）、阶段三（退役 amsg）待做
- 手机端 `utils/emAgentChat.ts`（开关、探活、提交、60 秒点名、信箱回复→收件箱）；`useChatAI.ts` 的 `[EM-START: agent-instant-chat]` 路由优先于 amsg 即时对话，mini 不在就本地生成
- 复用 amsg 即时对话：待收记录 `via:'mini'`（`amsgInstantChat.ts`），`activeMsgRuntime.ts` 的状态点名把 mini 轮次分走（否则会去 amsg 查无此行被判死）；回复推送是 amsg content 形状，SW 直接进收件箱走后处理
- 后端 `server/agent-backend/chatTurns.mjs`：`POST/GET /chat/turns`，凭据只在内存，重启后未跑的那轮判失败让手机重发；>3.5KB 只推 `agent-pull` 信号（`amsgResults.ts`）
- 心跳：`lastChatMessageAt` 把 `chat_reply` 算作回过；即时回复在跑时 `chat_turn_running` 不开口

### 30. 角色是活在社会里的人（社会责任）
- 阿萌 2026-10-01 定：她受伤、出事，角色可以放下工作赶来；她想逛超市角色就早退、她生气角色就推掉工作跨国飞来，不行。**她明确说不是日程规则的问题**（改日程可以），是角色整个没有社会责任——所以写的是「你是什么样的人」，不要改成条款或去动日程块
- 聊天：`utils/emPromptAddons.ts` 的 `emDutySection`（行为规范 2.1，主动消息打包也带）；`chatPrompts.ts` 只有一处调用
- 心跳：`server/agent-backend/heartbeat.mjs` 的 `DUTY_RULE`（心跳不读世界书，只读角色设定，所以不能靠世界书）；**改措辞两边一起改**
- 某个角色要例外（设定就是不上班的人）写进那个角色自己的设定，聊天和心跳都读设定

### 31. B 站 MCP 常驻 mini（只读）
- `server/bilibili-mcp/` — `@xzxzzx/bilibili-mcp@1.14.2`（stdio）外套 `server/apple-events-bridge/index.mjs` 同一份转接代码，单独实例只听 `127.0.0.1:8768`，Bearer 令牌在 `agent-tools/secrets/bilibili-mcp-token`；网关 `/bili/mcp`、`/bili/health` 去前缀转发
- 12 个工具全只读（视频信息 / 字幕 / 章节 / 评论 / 搜视频 / 搜 UP 主 / 收藏夹），不需要停用名单；阿萌 2026-10-08 定「只读，不需要输出」，不得加发评论 / 弹幕 / 动态类工具
- **启动必须 `node <真实路径>/dist/cli.js`**，`npx` / `.bin` 软链接在 Node 23/24 上静默退出；**必须 `USER_AGENT=bilibili-mcp/1.14.2`**，默认浏览器 UA 读视频被 B 站 412。两条都在 `run-macos.sh`
- 登录 Cookie 在 mini 的 `~/.bilibili-mcp/config.json`，扫码要在 mini 本人的大终端窗口里做；没装 ASR，无字幕视频读不到正文
- **聊天里发 B 站链接读字幕**（2026-10-14）：`apps/Chat.tsx` 建 webpage_card 前，`utils/emBiliTranscript.ts` 从已发现的 MCP 工具清单里找 B 站那台的字幕工具（不写死工具名 / 参数名）读字幕，存 `webpage.transcript`；`utils/messageFormat.ts` 视频分支经 `utils/emBiliTranscriptPrompt.ts`（不带依赖，messageFormat 会进 worker）把字幕喂给角色。两处哨兵 `[EM: bili-transcript]`。**私聊历史要经 `chatPrompts.ts` 的 `[EM: webpage-card-history]` 分支走 `normalizeMessageContent`**——2026-10-22 之前没有这一支，网页卡片只把标题给了角色，字幕和网页正文都白读。全文只带分享后五轮（`WEBPAGE_CARD_FULL_ROUNDS`，按阿萌说话次数算），更早的走 `normalizeMessageContent(..., { brief: true })` 只留开头
- 心跳自己逛 B 站还没做（`docs/ideas.md`）

### 32. 断网可打开（离线 app shell）+ 云端自动备份
- 起因 2026-10-12：飞机上连了没登录的 Southwest Wi-Fi，之后每次打开 PWA 都被带去登录页，清 Safari 缓存才好；同一次差点丢两天数据
- `utils/swAppShell.ts`（逻辑 + 单测）由 `worker/sw-keep-alive.ts` 的 `[EM-START: sw-offline-shell]` 接线，改完必须 `node scripts/build-workers.mjs` 重打 `public/sw-keep-alive.js`
- 只拦三类：打开 App 的导航（scope 根 / index.html，网络优先 3 秒超时，响应要同源 basic + 200 + 没跳转 + 在 scope 内 + text/html 才算数并入缓存，否则用缓存的 shell）、本站 `assets/` `icons/` manifest（缓存优先）、开机三个 CDN（Tailwind / Google Fonts CSS / KaTeX CSS，缓存优先）。**其余跨域请求一律不拦**，别把 API / Worker 加进来
- 缓存名带 `SW_VERSION`，activate 只清自己前缀的旧缓存；不碰 IndexedDB / localStorage
- **全部代码块都要预缓存**：各 App 是点开才下载的独立代码块，`index.html` 里看不到。`vite.config.ts` 的 `em-sw-precache-list` 插件（`[EM-START: sw-offline-shell]`）构建时写出 `sw-precache-manifest.json`（`{ files }`，约 92 个、12 MB），SW 安装和每次联网打开时按它补齐。别换回 `build.manifest`：它不列 Web Worker 的文件（如 `vectorSearchWorker`）。1.19.0 漏了这步，断网时只有桌面能进
- 自动备份：`utils/autoCloudBackup.ts` + `hooks/useAutoCloudBackup.ts`，OSContext 的 `[EM-START: auto-cloud-backup]` 挂 hook、`exportSystem(mode, { silent })` 静默打包。启动 / 回前台 30 秒后，超 24 小时没成功就备份纯文字，失败隔 1 小时再试，超 3 天一天提醒一次
- 自动备份文件名带 `_auto_`，清理时与手动备份**分开数**（自动留 7、手动留 5），手动备份的清理也走 `pruneCloudBackups`，不要改回 `cleanupOldBackups`（那会让每天的自动备份挤掉手点的完整备份）
- GitHub 备份 401 的报错直接写怎么修（`utils/githubClient.ts` 的 `GITHUB_TOKEN_FIX_HINT`，`[EM: github-401-hint]`）：token 创建页默认 90 天过期，阿萌踩过「老是 401」
- 根目录 `manifest.json`（`start_url: "/"`）没有被引用；实际生效的是 `public/manifest.webmanifest`（`./` 相对路径，在 `/LiliumOS/` 下解析正确）

### 33. GitHub 备份网页直连走 Git 数据接口
- 根因（2026-10-12 实测）：`uploads.github.com` 不回浏览器跨域预检（OPTIONS 400、无 CORS 头），Release 附件**网页直连永远传不上**；`api.github.com` 放行。2026-09-12 上游把中转改成默认关闭后，网页 GitHub 备份一直失败。Cloudflare 中转到 GitHub 实测约 4 成 522，也不可靠
- `utils/githubGitBackup.ts`：每片 24 MB 建 blob → 一棵树 + `manifest.json` → **无父提交**的孤立提交 → 最后建分支 `refs/heads/sully-backups/<文件名>`。中途失败不建分支、不留半截；删分支即删备份，不会堆进历史
- `utils/githubClient.ts` 只有 `[EM-START/EM: github-git-backup]` 几处接线：网页 + 没开中转时上传改走它（`shouldUseGitDataUpload`）；列表合并两种备份；`href` 以 `git:` 开头的恢复 / 删除走它。原生 App、开中转仍走 Release；旧 Release 备份照样能列、能恢复
- 请求统一借 `ghRequest`（`gitBackupContext`），所以三种线路都能列 / 恢复 / 删这种备份；报错沿用 `describeGithubHttpError`
- 测试里「GitHub 事务式上传」那组用 `vi.spyOn(gitBackup, 'shouldUseGitDataUpload')` 固定在 Release 路径，别删

## 吸收上游时常见坑（踩过的 bug）

下面多是以前整体合并时踩的；往同一个文件移植上游改动时照样会踩。

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
上游 `chatPrompts.ts` 的 `buildSystemPrompt` 会调用 `ContextBuilder.buildScheduleInjection()` 注入角色日程。如果用旧版 EM 的 chatPrompts 会导致角色聊天时完全不知道自己的日程（比如该开会的角色说去床上等你）。这一段别退回旧版 EM 的写法。

### chatPrompts.ts — notion_diary_nudge
上游的 chatPrompts 没有 `notion_diary_nudge` 处理。移植上游 chatPrompts 改动后必须确认在 `buildMessageHistory` 的 interaction 类型判断处手动加回：
```typescript
if (m.type === 'interaction' && m.metadata?.kind === 'notion_diary_nudge') {
    content = `${timeStr} [系统: 用户通过快捷操作希望你立刻写一篇 Notion 私人日记...]`;
} else if (m.type === 'interaction') content = `${timeStr} [系统: 用户戳了你一下]`;
```

### useChatAI.ts — contextComposition 不能硬编码 0
移植上游 useChatAI 改动后，`setContextComposition` 里的值不能写死为 0，必须从 `payload.contextBreakdown` 读取实际值。

### useChatAI.ts — notionDiaryExtraProperties
`NotionManager.createDiaryPage()` 必须传第四个参数 `realtimeConfig.notionDiaryExtraProperties`，否则 Notion 日记不会自动填充角色标签等额外列。

### types.ts — NotionExtraDatabase
字段名是 `name`（不是 `displayName`），移植时注意不要搞混。

### ValentineEvent.tsx — 520 等活动入口
特别时光 App 的活动入口在 `ValentineEvent.tsx` 的 `SpecialMomentsApp` 组件里。上游新增活动时需要更新此文件（如 Like520Event 的 import 和卡片入口）。

### Like520Event.tsx — 自动存档
已加 `useEffect` 在 callA + callB + chibis 齐全时自动存档，防止闪退丢失活动进度。上游版本只在用户手动点"下一步"时才存档。

## 架构原则

0. **上游文件的纯类型瑕疵不修**（阿萌 2026-07-10 定）：上游 build 只跑 vite 不跑 tsc，他们看不见自己的类型错误（MemoryPalace 的 char 断言、vite.config 隐式 any 等 ~60 个）。修了只会给以后移植上游改动埋散点冲突。tsc 错误数只修 EM 自己文件的，数字跟自己比。真影响运行时行为的 bug（如 healthDb openDB 笔误）不在此限。

1. **个人新功能尽量做成独立文件**（新 App、新 util），减少对上游文件的侵入
2. **必须改上游文件时**，改动越小越好——加一行 import、加一个 case、加一个 hook 调用
3. **不要大面积重写上游文件**，否则以后吸收上游功能会很痛苦
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
- **心跳临时出门盖过日程**（2026-10-27，哨兵 `heartbeat-outing`）：心跳 social 真出门时写 `outing`（分钟，后端 `withOuting` 夹在 20–240，`runner.mjs` 解析层要放行），OSContext 收信时 `noteOutingFromLife` 记进本机 localStorage，`computeCharStatus` 在回来前返回 busy「和谁出门了」；睡眠仍优先。只存本机、不进备份

### 35. 多选收藏成一段对话（2026-10-15）
- 聊天多选底栏「收藏」：`apps/Chat.tsx` / `components/chat/ChatInputArea.tsx`（哨兵 `multi-select-favorite`）→ `utils/contentFavorites.ts` 的 `saveConversationContentFavorite`
- 存成一条 `ChatContentFavorite`，`conversation` 是当时的消息快照（data URL 图换成 blob 令牌，令牌在 assets 表里被引用，孤儿清理不会删）；同一组消息再收只更新
- 收藏夹「对话」分类由 `components/chat/FavoriteConversationBody.tsx` 按聊天气泡渲染
- 纯文字备份（含每天的自动备份）带 `contentFavoritesIndex`，`DB.importFullData` 只替换这一行素材（哨兵 `text-content-favorites`）；图片不随文字备份走

### 36. 停止回复（2026-10-15）
- 核心在 `utils/emReplyStop.ts`：本地生成用 `beginLocalReply` 的中止信号；交给 mini / amsg 的那一轮按 turnId 作废（localStorage 记最近 50 轮）并尽力取消
- `hooks/useChatAI.ts`（哨兵 `reply-stop`）：所有聊天补全请求带信号，后处理收到 `signal`；停了不报错，流式预览露出来、还没落库的那几句存下来
- `utils/applyAssistantPostProcessing.ts`：`persistMessage` / `typingPause` 认停止信号，已经上屏的留着
- `utils/activeMsgRuntime.ts`：收件箱见到停过的 turnId 直接丢掉
- mini 后端 `POST /chat/turns/cancel`（`server/agent-backend/chatTurns.mjs`）：还没开跑的取消，正在跑的掐掉模型请求、跑完不推不进信箱。改后端要在 mini 上拉代码重启

### 37. 机房 App（Mac mini 后端的家，2026-10-20）
- **2026-10-27 拆开（结构梳理第 4 步，哨兵 `machine-room-split`）**：机房只看 TA——`apps/MachineRoomApp.tsx` 一屏（mini 在不在 + 接上 mini 的角色各一行），角色详情只有心里、攒着想说的、最近几跳；两个人的时间只写到几点（开关是聊天工具栏「贴贴」）。机器那半回到设置 → Mac mini（`components/settings/AgentMiniControls.tsx`：服务、开关、角色心跳单子 `AgentCharacterHeartbeat.tsx`、心跳记录 `AgentRunsSheet.tsx`、这台手机、这台 mini）；脾气在神经链接设定页（`components/character/TemperamentSection.tsx`，那页是 formData 自动存，所以经 `handleChange` 交回、`useTemperament` 的 `persist` 参数）。两边共用 `hooks/useAgentMiniData.ts`。机房「后台设置」用 `settingsLaunch`（`utils/emSettingsPages.ts`）直达 Mac mini 页。以后改「窗台」就在机房这一屏上长
- 主色 mint，纯逻辑在 `utils/emMachineRoom.ts`；接入和脾气读写在 `utils/emAgentConnect.ts`（`connectCharacterToAgent`）、`hooks/useTemperament.ts`，别再在别处写一份
- 开关走后端 `GET/POST /settings`（`server/agent-backend/adminSettings.mjs`）：**只认白名单**（只试跑、心思试运行、存原文、安静时段），一项不对整批不改；关掉「只试跑」要确认。新开关加进白名单之前想清楚该不该从手机改
- 状态里的小红书登录态查一次要开浏览器，`createXhsLoginProbe` 带 10 分钟缓存、不在请求里现等；`GET /characters` 带 `nextHeartbeatAt`
- 上游文件只有接线：`types.ts` AppID、`constants.tsx` 图标、`PhoneShell.tsx` 路由、`safeAreaApps.ts`（测试里的名单也要加），设置页 `AgentBackendSection` 一个「看看 TA 们在干嘛」入口；`apps/Settings.tsx` 一行 `settingsLaunch.peek()` + 一行 consume，`apps/Character.tsx` 一行脾气卡
- **分工（2026-10-27 阿萌定，倒回 10-21 之前）**：机器的事归设置 → Mac mini，机房只看 TA 是什么样、在干嘛，脾气归神经链接。聊天交给 mini 仍是本机开关 `em_agent_chat_enabled_v1`
- 连 mini 的请求（`emAgentBackend.ts` 的 `request` 和连通性复检）都带 `__sullySuppressNetworkFailureLog`：超时、连不上不进 SYSTEM ERROR，机房 / 设置自己显示「后台休息中」或黄字（2026-10-22 阿萌定）
- 「立刻收信箱」只发 `em-agent-pull` 事件，走 OSContext 跟回到前台同一条收信路；**别直接调 `AgentBackend.inbox()` 再 ack**——那样消息不进聊天就被确认收下，等于吞掉（旧设置页按钮就是这样）

### 38. 外链图片存本机 + mini 图片仓库（2026-10-21）
- 起因：表情包 / 头像是别人图床上的链接（sharkpan 已下线、catbox 时好时坏），图床一挂就变问号；完整备份只带网址
- 纯逻辑在 `utils/emExternalImages.ts`（扫描 → 下载 → 存令牌 → 改写），面板 `components/settings/ExternalImagesPanel.tsx`，挂在设置「备份与恢复」里 `StorageUsagePanel` 下面（两行 `[EM: external-images-rescue]`）
- 改写范围：表情库 url、角色头像、我的头像 / 分角色头像，**加上 messages 里 type 为 emoji / image 且 content 是那个网址的行**——表情消息存的是网址，角色靠 `stickerNameFromUrl` 按网址反查表情名，只改表情库会让旧记录的名字对不上
- 角色和我的头像走 OSContext 的 `updateCharacter` / `updateUserProfile`，别直接写库（内存里的旧网址会被下一次更新写回去）；跑的时候拿 `maintenanceLock`，跟「优化资源存储」、孤儿 GC 互斥
- 浏览器下不了（跨域 / https 页面上的 http 图）就交给 mini：后端 `server/agent-backend/imageVault.mjs`，`POST /images/fetch` 代为下载、`POST /images/put` 收手机下好的、`GET /images` 只回数量。**代为下载只认公网地址**（解析出内网 / 本机 / Tailscale 段一律拒，跳转逐跳检查）——mini 本机跑着日历桥接、小红书这些服务，别放宽
- 仓库在 `<数据目录>/images/`，`<sha256>.<扩展名>` + 同名 `.json`，只收不发；「从 mini 恢复图片」还没做
- OSContext 网络日志加了 `__sullySuppressNetworkFailureLog`（一行 `[EM: external-images-rescue]`）：图床挂了是预期结果，不点亮 SYSTEM ERROR

### 39. 表情包描述 + 聊天图片存为表情包（2026-10-21）
- `Emoji.description?`（行尾 `[EM: emoji-descriptions]`）：图上画了什么。**只在阿萌发的表情后面带**（阿萌 2026-10-21 定），角色挑表情用的 `buildEmojiContext` 清单不带——一百多个表情每轮都会多一大截
- 给角色看的那一行在 `utils/emEmojiStickerLabel.ts`（不带依赖），`chatPrompts.ts` 私聊历史、`groupChat/prompts.ts` 群聊各一行接线；读图、选 API、批量在 `utils/emEmojiDescriptions.ts`
- `DB.saveEmoji` 改成同名覆盖时保留原行的其他字段（`[EM-START: emoji-descriptions]`），否则换图 / 改分类 / 外链存本机会把描述抹掉；只改描述用 `DB.setEmojiDescription`
- 读图 API：识图 API（开着优先）/ 主 API / 任一预设，选择存本机 `lilium.emoji.visionChoice`，不进备份
- 弹窗都是 EM 自己的文件：`components/chat/EmojiDescriptionModal.tsx`、`SaveImageAsEmojiModal.tsx`、`EmojiVisionControls.tsx`；上游 `ChatModals.tsx` 只多两个可选 prop 和两个按钮，`Chat.tsx` 两个 state + 两个弹窗
- 存为表情包：图一律尽量存本机（令牌直接共用、data URL 转令牌、网址先试下载），下不了才留网址并提示
- **分组「这一组是谁」**（2026-10-22）：`EmojiCategory.intro?`（`[EM: emoji-group-intro]`），长按分组 → 分类操作 →「这一组是谁」（`components/chat/EmojiGroupIntroModal.tsx`）。
  介绍不进分组标题（角色发表情偶尔写「组名:表情名」，程序按组名对），而是在表情清单后面单独一行「这几组表情包的主角：小豆泥＝…」（`groupIntroLine`，私聊和群聊都有）；
  阿萌发的表情在私聊历史里带组名「抱抱（小豆泥）（图上：…）」，`buildMessageHistory` 的 `options.emojiCategories` 由 `chatRequestPayload` 传；默认 / 系统组不带。让 AI 写描述时也把组名和介绍给读图模型（`groupVisionHint`）

### 40. 设置页：苹果式分组列表（2026-10-21）
- 首页 `components/settings/SettingsHome.tsx`：个人卡片 + 有事才出现的提醒行 + API / 连接 / 备份 / 后台 / 其他五组，每行右边直接写状态，点一行推进子页。样稿 https://claude.ai/artifact/9ptEF5b6AV45mUnBuMcvbN
- 纯逻辑（子页清单、标题、右侧状态怎么说、提醒行什么时候冒）在 `utils/emSettingsPages.ts`；MCP 体检在 `utils/emMcpHealth.ts`（只测不改配置，5 分钟内不重测）
- 上游 `apps/Settings.tsx` 只有接线（`[EM-START/EM: settings-ios-list]`）：`SettingsSection` 不再原地折叠，改成白卡外壳（单块的页小标题只给读屏）；原来每一大块用 `{onPage('…') && (<>…</>)}` 包住，内容一个字没改；顶栏换 F（子页返回首页）
- 「档案」App 收进设置顶上的个人卡片（`ProfileSettingsPage.tsx`），桌面图标在 `constants.tsx` 注释掉，`AppID.User` 仍能打开
- Instant Push 已停用：推送页里只在它还开着时出现，首页提醒行催去关（开着会抢在 mini 前面接走聊天）
- 测试 `utils/apiSettingsUi.test.ts` 的 `open()` 是「回首页再点那一行」，跨几块的草稿测试按子页来回切
- 图标格是灰底 32px（公约 C 的例外，见 `APP_CONVENTIONS.md` P16）；设置认领的主色是 `HUE.blue`
- 设置 → Mac mini 只管配对（见第 37 节分工）
- **子页换 F 皮（2026-10-22）不改上游 JSX**：设置根节点挂 `settings-f` + `SETTINGS_F_VARS`（`components/settings/settingsF.ts`，取值全来自 clayTokens），`settingsF.css` 把上游 Tailwind 的颜色 / 圆角 / 阴影 / 10px 小字映射成 F：装饰色（violet / sky / indigo…）一律收成设置主色 `HUE.blue`，绿 / 琥珀 / 红走状态色，渐变拍平，开关打开一律主色
- **配置直接铺在子页里（2026-10-22 阿萌：点进去还要再点进去）**：实时感知、MCP、主动消息 2.0 的弹窗换成 `components/settings/SettingsSheet.tsx`（参数同 os/Modal，多一个 `inline`）：在自己的子页里 portal 进滚动区的挂点（`SettingsInlineSlotContext`），别处照旧弹窗。进实时感知页要调 `openRealtimeModal()`（读 Notion 栏位），离开 MCP 页要 `flushMcpToolConfigSync()`（原来关弹窗时做的事），都在 Settings 的 `[EM: settings-inline-config]` effect 里；三页摘要卡上的「配置」按钮去掉了
- 颜色那一大段由 `node scripts/gen-settings-skin.mjs` 扫设置页和 `components/settings/*` 生成，**上游设置页加了新颜色类就重跑它**；只认真正的颜色名，`border-b`、`text-xs` 这种不能当颜色
- 内联 style 不受这层皮管：生图页上游写的是 `HUE.rose` 内联（一页一色，不算违规）；Intiface 标题的 🎮、几处 💡 / 🔗 / 🧪 是写在上游文字里的 emoji，要去掉得改上游 JSX

### 41. 烛下：聊天里的深谈（2026-10-22）
- 契约 `docs/spec-deep-talk.md`，UI 模式 `APP_CONVENTIONS.md` P17。阶段一（手机端闭环）已做，阶段二（mini 到点来叫、TA 主动约）、阶段三（动态蜡烛、情侣空间书架）待做
- 纯逻辑 `utils/deepTalk.ts`（状态、`[[DEEP_TALK: accept / later | HH:mm / decline]]` 标记、约定时间按角色时区、昼夜、提示词、历史折叠），落库 `utils/deepTalkActions.ts`，「这一夜」的记录在独立库 `utils/deepTalkDb.ts`（`LiliumOS_DeepTalk`，随备份 `emDeepTalkNights`）；界面在 `components/deepTalk/*`
- **正文是普通聊天消息**（`metadata.source = 'deep_talk'` + `deepTalkId`）：记忆宫殿只认消息流。聊天列表不显示它们（`chatMessageVisibility.ts`），结束了的那夜在 `buildMessageHistory` 里只剩折叠卡那一行（`keepInPromptHistory`），结束后第一轮走「模式切换」拉回短消息
- 邀请那一轮和开着的深谈**固定本机生成**（`useChatAI.ts` 的 `deepTalkLocal`：否决 mini / amsg 即时对话和 Instant Push），TA 那段话不进 `applyAssistantPostProcessing`，整段存一条
- 开着时：快照 `deepTalk` → 心跳 `speakBlock` 返回 `deep_talk`（since 超 3 小时不认）；本地主动消息跳过；amsg 云端排程管不到（阿萌本来也不靠它）。放着 3 小时没动，下次打开聊天自动收卡（「蜡烛燃尽了」）
- 夜间配色 `CANDLE_NIGHT`、手写体 `FONT.hand` 都在 clayTokens；卡片和系统气泡在聊天里一律白天配色
- **两种（2026-10-22）**：结束时预选、信笺里可改——谈事（`kind: 'matter'`）的原文当普通聊天记（按条数进上下文、进记忆宫殿 / 心跳 / 手动总结），说真话（缺省）的照下面隔离。判断一律走 `isWalledDeepTalkMessage(m, matterNightIds)`，别再直接拿 `isDeepTalkMessage` 当「不进记忆」
- **说真话的那种**：深谈原文不进记忆宫殿（`pipeline.ts` 三处）、不进角色 App 手动记忆总结、不进心跳快照、深谈轮次不跑情绪评估；
  收尾留两份摘要——`summary` 只写感受（给平时）、`candleSummary` 照实写（只给以后的烛下）；TA 挑的一两句原话（`kept`，程序校验真说过、不带现实处境）才写成卧室记忆，信笺里可删。
  **以后给深谈加新的「带走」路径（导出、摘要、快照…）都要先想会不会把真话漏回平时**
- 收尾时 TA 写一句只写感受的「余温」`afterglow`：当下一轮平时聊天的内心状态，并写进卡片那一行——深谈中不跑情绪评估，靠它接上氛围
- TA 的思考存 `metadata.deepTalkThinking`，纸面 / 信笺名字旁一个手写体 `<Thinking>` 小标签点开看；不用心象卡片样式

### 34. 小厨房（现实食品库存）
- 详细设计与每次改动见 `docs/kitchen-3d.md`；UI 规则见 `APP_CONVENTIONS.md` 的 P14 与 `utils/kitchenPaperTokens.ts`
- `utils/kitchenDb.ts` 是唯一能改库存的地方（独立库 `LiliumOS_Kitchen`）：每次改数量记一笔事件、带 operationId 去重；**一起发生的一批（拍一张小票、做一道菜）一个事务写完、同一个 `batchId`，「撤销最近操作」整批撤回**，做菜撤销连「做过几次」一起退
- 「是不是自己做的菜」只看批次的 `foodState`；`utils/kitchenDishNames.ts` 按名字猜只用来给放进表单预先打勾、给 v4 以前的旧数据补标记，别再在显示时按名字猜（沙拉酱、咖喱块会被当成菜）
- 名字配对 `shoppingMatches` 只认一个方向（后一个名字更具体），后面接「酱 / 面 / 粉 / 干…」的不算——番茄 ≠ 番茄酱。要买清单自动划掉和菜谱扣库存都用它
- 小票「慢慢吃」：冷冻的肉鱼虾和名字带肉的熟食（酱牛肉）一律算「要吃掉的」（阿萌 2026-10-14 定：重要冰箱库存），其余按保质期 ≥ 30 天、常温柜或调料名
- 上游文件只有五处接线（`types.ts` AppID 与备份字段、`constants.tsx`、`PhoneShell.tsx`、`safeAreaApps.ts`、`OSContext.tsx` 备份导出 / 恢复），`check-em-patches.sh` 的「小厨房」那几行钉着
- 读小票的 API 预设 id 存本机 localStorage（`lilium.kitchen.receiptPresetId`），不进备份
- 「柜子里」按 `pantryKindOf`（批次 `pantryKind` 优先，否则按名字猜）分速食 / 零食 / 饮料；米面油调料（staple）不上这张纸（阿萌 2026-10-14 定）

## 点子和待办往哪写

**新点子只写 `docs/ideas.md`，别再开新清单文档了**（2026-09-25 定，起因是同一批想法散在
五个地方，还有几条掉进外部记忆层里找不回来）。

| 东西 | 写哪 |
|---|---|
| 还没决定做的点子 | `docs/ideas.md` ← **唯一入口** |
| 决定要做了 / 已排期 | `docs/roadmap.md` 的优先级 |
| 做了但还没验收 / 体验 | `docs/roadmap.md` 的「做了，等验收」表 |
| 要交给另一个 session 独立做完的 | `docs/spec-<功能名>.md`（照 `spec-photo-favorites.md` 的骨架：数据层 / 各端改动 / **本次不做** / EM 惯例 / 验收） |
| 做完了 | `docs/changelog.md`（日期 · 标题 · **操作：Claude（小帕）** · 提交号 · 内容；最新在上，格式见文件开头） |
| 代码层面的技术待办 | `notes/todo.md` |
| 跨 agent 交接、踩过的坑 | 对应 `docs/spec-<功能名>.md`；纯代码欠账写 `notes/todo.md`，完成结果写 `docs/changelog.md` |

已完成、不要重复立项：地图×日程、Intiface、Finance 重设计、照片收藏、Token 召回面板、Offline 状态系统。其余做过什么先翻 `docs/changelog.md`。

**每完成一件事都要写 changelog**（2026-09-26 阿萌定）：合进 `main` 或上线后，在 `docs/changelog.md` 对应月份最上面加一条，操作者写 `Claude（小帕）`；同时把 roadmap「做了，等验收」里对应的那行删掉或更新。仓库文档是两边 Agent、cloud session 和阿萌共同可见的交接层。

## 文件说明

- `_em_backup/` — 以前整体合并上游前留的 EM 旧版备份，供参考旧逻辑用
- `.claude/launch.json` — Vite dev/preview server 配置
- 部署：Vercel（绑 GitHub main 分支自动部署）+ GitHub Pages

## UI 设计系统 — Emma Soft Clay UI v1.0「F」

**所有 UI 改动必须遵循 [`design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) 与 [`APP_CONVENTIONS.md`](../APP_CONVENTIONS.md)。**
2026-09-25 换皮定稿，替换 v0.1 的奶黄底 + 凹凸并存；七套备选和取舍过程见 https://claude.ai/artifact/4WQXnVEqsbsGbhGcuWbmD3

- 颜色、圆角、阴影、间距、字体、浮层、动效的值只从 `utils/clayTokens.ts` 取（`tokens.json` / `tokens.css` 是镜像），不许自己编 hex 值
- 基底 `#F8F9F7` 中性去黄，卡片纯白，靠明度差和 1px borderSoft 分层
- 核心质感：**全平**——无投影、无凹陷内阴影；「凹槽」只是 surfaceSunken 平底色块；图标钮是裸 icon
- 浮在内容上的 sheet / 提示条用 `OVERLAY` 雾面（iOS 18 材质，不是 iOS 26 液态玻璃）；普通卡片不许加玻璃
- 标题（顶栏、sheet、section）用衬线 Noto Serif SC；数字、正文一律无衬线
- 色板 16 色按 OKLCH 公式算：五颜六色但饱和度封顶；amber / yellow / lime 不做白字按钮底
- 色彩比例：中性底 ~75%、模块 Tint ~18%、高饱和 Main ~7%；每屏最多 1 主色 + 1 辅色 + 1 状态色
- 动效在 `utils/clayMotion.css`：三条曲线，一屏只一个 hero 时刻
- `design-system/Emma Soft Clay UI v2.dc.html` 是 v0.1 旧样例，仅供参考历史，不再代表现行风格

## 技术栈

React + TypeScript + Vite + Tailwind CSS + IndexedDB（Dexie）
