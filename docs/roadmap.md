# SullyEM Roadmap

> `main` 仍是发布基线；最近验收分支为 `merge-upstream-2026-08-01`（已推送，待单独批准推进 main）。最后核对：2026-08-01；验收分支覆盖至 `2b9db3e4`。
> 具体实现契约见对应 `docs/` 规格；跨 Agent 交接只记录工作上下文，不替代 Git 和仓库文档。

## 当前优先级

### P0：文档与上游同步安全

- 上游同步严格执行 `.claude/CLAUDE.md` / `AGENTS.md` 的审批闸门：先只读调研和汇报，再由 Emma 选择，获批后才建验收分支。
- merge 后运行 `bash scripts/check-em-patches.sh`（当前 74 项）和 `pnpm vitest run`。
- EM App 数据备份必须持续覆盖 Finance、Health、Shopping、Map 及 Finance 周期规则。

### P1：Health 外部数据链收尾

核心 Health App 已完成：本地 IndexedDB、训练/睡眠/饮食/经期/症状/体重、周期推算、饮食文本/图片识别、角色聊天健康摘要和完整备份。

仍待完成：

- Apple Health 快捷指令导入的真实解析与增量同步（当前按钮仍提示开发中）。
- Notion HealthLog / Daily Routine 同步。
- Health App 内“让角色说说这周”的周评论入口与缓存。
- 对按需读取健康详情的触发边界补测试。

### P1：Notion 高级管理 App

- 新建独立 `apps/NotionApp.tsx`，不重写 Settings 的基础配置。
- 整合多库权限、TAG 查询、日记模板和标签管理。
- 复用并扩展 `utils/notionExtraConfig.ts`，保持 `NotionExtraDatabase.name` 字段契约。

### P2：位置感知聊天

- 复用 `utils/geo.ts` 获取位置，通过 Google Places 反查地名与周边 POI。
- 新建 `utils/locationService.ts`，在 `chatRequestPayload.ts` 做可控、低 token 注入。
- 必须有显式权限、失败降级和隐私开关；不把实时位置写入 Engram。

### P2：日记系统整理

- 新建独立 `apps/DiaryApp.tsx`，统一交换日记与 Notion 日记入口。
- 增加多选/主次心情标签、封缄和情绪统计时间线。

### P2：共读增强

- Phase 2：角色回头回应用户写在已读段落的批注。
- 选中文字高亮。
- PDF 支持。

## 已完成

### 2026-08-01（验收分支，尚未推进 main）

- 同步上游至 `b24709a7`：纳入写歌工作台重做、API 预设编辑/删除、生活记录补录、新闻源迁移、备份导出稳定性、日程上下文对齐、API 调用记录、记忆高水位恢复与查手机修复。
- 聊天快捷工具栏已落地；聊天引用保持“引用和正文独立宽度、整组按当前发送者左右对齐”。
- 文字转语音只增加用户发送端的语音条展示；角色的语音权限仍只由 `chatVoiceEnabled` 控制。角色未配置 MiniMax / Fish API 时，仍可输出 `<语音>` 内容并以可“转文字”的语音条呈现；真实音频合成才要求 TTS 配置。
- 气泡工坊保留上游五项语音条主题设置：背景、播放时背景、按钮、波形、文字颜色；用户文字语音与角色语音共用这套主题。
- 日程/情绪设置新增按角色保存的日程密度滑块，范围 5–12 段、默认 8 段；松手后才保存并重生成，生成提示词严格要求所选数量。
- 验证：`check-em-patches.sh` 74/74；全量测试 1355 passed / 5 skipped；后续语音相关测试 57 passed；构建通过。

### 2026-07-28 至 2026-07-29

- 同步上游至 `9753431`，纳入记忆搬家/召回修补、日程卡主题、角色时区、查手机记录详情、XHS/MCP 稳定性等更新。
- 恢复首页三行图标、普通页五行布局，以及 Health / Shopping / Map 专用图标。
- Finance、Health、Shopping、Map 和 Finance 周期规则纳入全量备份/恢复。
- 投喂站店铺目录与店内商品列表改为独立滚动。
- 修复回复引用过长时撑宽短正文气泡的问题；新增 `sully-quote-bubble` 自定义 CSS 钩子；引用整组按当前消息发送者靠左/靠右。
- EM 合并保护增加到 74 项；全量测试 1250 passed / 5 skipped。

### 已落地的主要 EM 功能

- 通讯录与查手机增强。
- Token/context 面板及“本轮召回记忆”展示。
- 写 Notion 快捷操作、附加列和只读 TAG 数据库。
- Online / Busy / Offline 状态系统与延迟回复。
- 地图×日程 Clay 系统：世界编辑、`regionId` 数据链、角色位置与日程 sheet。
- Finance 重设计：多账户/币种、分类、流水、周期规则、趋势分析和“TA 怎么看”。
- Health 核心 App 与聊天健康摘要。
- Shopping 投喂站。
- Open-Meteo 免 key 天气。
- 照片收藏与查手机轮播。
- Intiface 硬件集成、聊天工具和悬浮控制球。
- EM 角色代记、语音感知/发送（含无 TTS 的转文字语音条）、日程分钟精度与密度滑块、桌面拖拽排序。

## 待决策项

- 邮局待寄队列超过 5 封时：部分接受、整批拒但友好提示，或提高限额。
- 角色时区下，小小窝/查手机/见面等界面时钟究竟显示角色时间还是设备时间。
- 多角色共同日程采用“共享少量锚点”还是更强同步。

## 暂不主动处理

- 上游文件中只影响 `tsc`、不影响 Vite 运行的纯类型瑕疵，避免增加未来 merge 冲突。
- `docs/dev-debug.md` 中低价值日志支线，等实际踩到问题再接。
