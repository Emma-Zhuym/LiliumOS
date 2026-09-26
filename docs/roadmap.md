# LiliumOS Roadmap

> 这份只管**接下来做什么**和**做了但还没验收的**。最后整理：2026-09-26。
>
> - 做完了的 → [`changelog.md`](./changelog.md)（按日期，写明谁做的）
> - 还没决定做的点子 → [`ideas.md`](./ideas.md)
> - 要交给另一个 session 独立做的 → `docs/spec-<功能名>.md`
>
> 具体实现契约看对应的 `docs/` 规格；跨 Agent 交接只记工作上下文，不替代 Git 和仓库文档。

## 做了，等验收 / 体验

按「阿萌需要做什么」排，做完一项就删掉这行，并在 changelog 里补一句验收结果。

| 事情 | 做完于 | 阿萌要做的 |
|---|---|---|
| 小红书 MCP 搬到 mini | 2026-09-26 | 扫码后点「测试连接」看到昵称；让角色搜一次小红书试试；决定旧的 `xiaohongshu-readonly` / `xiaohongshu-tunnel` 要不要停 |
| 心跳生活活动 v2 | 2026-09-26 | 重启 agent 后端；看一跳真实心跳，确认不再出现「你不来我就还没做饭」这类把自己日常冻住的话 |
| 换皮「F」 | 2026-09-25 | 日常使用中留意漏网的旧样式（VRWorld / 记忆宫殿 / Launcher / Chat / CallApp 有上游手写阴影，按约定暂不改） |
| SimpleFIN Instacart 预授权对账 | 2026-09-15 | 真实账本同步一次，看调价后的扣款是否只算一笔 |
| 查手机短信新话题、联系人只增不改 | 2026-09-12 | 刷几次短信，看新话题的内容质量 |
| 独立聊天设置与私人备注 | 2026-09-12 | 日常体验；备注只存本机，不会跨设备 |
| 2026-09-12 上游同步（含独立异格） | 2026-09-12 | 真机体验；异格的文字质量 |

## 当前优先级

### P0：规矩与同步安全

- 上游同步严格走 `.claude/CLAUDE.md` / `AGENTS.md` 的审批闸门：先只读调研、汇报，阿萌选完才建验收分支。建议两周一合。
- merge 后跑 `bash scripts/check-em-patches.sh`（当前 126 项）和 `pnpm vitest run`。
- EM App 数据备份必须持续覆盖 Finance（含周期规则）、Health、Shopping、Map、Moments、Smart Home。
- 剧情剧场默认独立故事线与独立记忆；只有用户显式开启才镜像进角色记忆。

### P1：心跳后续

- 送达时间统一（`docs/spec-heartbeat-life-v2.md` 第 5 节）：程序定外卖 / 网购的到达时刻，投喂站和提示词用同一个时间。
- 朋友圈由心跳定时刷新（现在只有「让大家看看」手动刷）。

### P1：Health 收尾

- Notion HealthLog / Daily Routine 同步。
- Health App 里「让角色说说这周」的周评入口与缓存。
- 要不要给角色开放逐样本的原始历史、要不要单独做七日趋势图——现在工具只返回按日聚合。

### P1：Notion 高级管理 App

- 独立 `apps/NotionApp.tsx`，不重写 Settings 的基础配置。
- 整合多库权限、TAG 查询、日记模板和标签管理；复用 `utils/notionExtraConfig.ts`，保持 `NotionExtraDatabase.name` 字段契约。

### P1：Smart Home 真实设备

App、HA REST、演示模式、备份和角色 MCP 都已完成；部署交接见 `docs/home-assistant-mac-mini-plan.md`。

- 两只 Tapo Matter 灯泡接入 HA。
- Levoit Core 200S-P 经 VeSync 接入，核对实体名、风速和模式字段。
- 用真实设备验收开关、亮度、色温、净化器档位、场景和角色控制。

### P2：位置感知收尾

- iOS 快捷指令的到达 / 离开自动化，以及受控的后端语义事件；实时位置不写入 Engram。

### P2：日记系统整理

- 独立 `apps/DiaryApp.tsx`，统一交换日记与 Notion 日记入口。
- 多选 / 主次心情标签、封缄、情绪统计时间线。

### P2：共读增强

- 角色回应用户写在已读段落的批注（Phase 2）；选中文字高亮；PDF 支持。

### P2：Finance 后续

- Amazon 邮件 / 订单匹配（需要单独的邮箱授权）。
- 角色替用户批量写分类——要先定义写账确认边界。

## 待决策

- 邮局待寄队列超过 5 封时：部分接受、整批拒绝但友好提示，还是提高限额。
- 角色时区下，小小窝 / 查手机 / 见面等界面的钟显示角色时间还是设备时间（见 `docs/character-timezone.md` 文末）。
- 多角色共同日程：共享少量锚点，还是更强的同步。
- 心跳产出的「临时出门」要不要反映到状态灯上（现在不会，已知且接受的不一致）。

## 暂不处理

- 上游文件里只影响 `tsc`、不影响运行的纯类型瑕疵（避免给 merge 埋冲突）。
- `docs/dev-debug.md` 里低价值的日志支线，等真的踩到再接。

## 已有功能一览

给新来的 Agent 快速建立印象用；每项什么时候做的、谁做的看 changelog，契约看 `.claude/CLAUDE.md` 的 EM 功能清单。

- **聊天**：通讯录、Token / 召回记忆面板、写 Notion 快捷键、Online / Busy / Offline 状态、角色代记、文字语音条、聊天记录搜索、MCP 调用记录、独立聊天设置与私人备注、角色独立 API、生图 API 与立绘参考。
- **角色的生活（Mac mini 后端）**：心跳（开口抽签、生活小事、工作往来、社交与约定）、起居注、工作 App、朋友圈、日常节律。
- **现实接入**：Apple Health（经 HA）、Apple 日历 / 提醒、位置感知、SimpleFIN 记账、Home Assistant 共栖舱、小红书（mini 常驻）、Open-Meteo 天气、中文热榜。
- **App**：Finance、Health、投喂站、地图×日程、日历、共栖舱、朋友圈、查手机增强、照片收藏、Intiface、七夕等特别时光。
- **工程**：EM 哨兵 + `check-em-patches.sh`、提示词外置 `emPromptAddons.ts`、完整备份覆盖 EM 数据、换皮「F」设计系统。
