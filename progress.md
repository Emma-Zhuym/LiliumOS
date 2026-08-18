# LiliumOS Current Progress

> 发布基线与验收分支并列记录。最后更新：2026-08-17。

## 快照范围

- 本地发布分支：`main`，已包含 LiliumOS 品牌迁移与角色 API 独立绑定。
- 远端 `origin/main` 的最后核对基线为 `fddf7c5a`；推送仍需单独批准。

## 最近完成

- 角色可绑定「设置 → API」里已有的命名预设；Chat 页快捷切换只改当前角色，私聊、本地主动消息与 Active Message 2.0 按同一角色路由，旧角色继续跟随主 API，预设缺失时安全回退。
- 新增「共栖舱」Smart Home App：可统一控制 Home Assistant 灯光、空气净化器和场景，支持亮度/色温连续滑杆、设备/场景同步入口、演示模式、REST 连接测试、可选代理及角色 MCP 接入。
- Smart Home 连接配置已进入完整备份/恢复；适配层、授权请求、服务调用与备份路径已有回归测试。
- 新 App 已完成桌面与 390px 手机尺寸检查；真实 Tapo Matter 灯泡和 Levoit Core 200S-P 联调等待 Home Assistant 常驻主机就位。
- LiliumOS 品牌文案与新图标已发布；公开仓库改名为 `Emma-Zhuym/LiliumOS`，Pages 地址迁移到 `https://emma-zhuym.github.io/LiliumOS/`。
- SimpleFIN 已完成账户、余额和交易的只读同步；新交易进入待分类复核，桌面角标和统一消息弹窗显示待处理数量。
- 同步账户允许自定义昵称、类型、图标和颜色；SimpleFIN 后续同步只更新外部来源字段，不覆盖本地展示设置与层级分类。
- Finance 支持交易页新建分类、详情字段对齐、信用卡还款转账语义，以及角色主动查询近期交易、消费汇总和账户快照。
- Finance 今日情报改为围绕角色经济生活生成，可包含购买、退款、礼物和与消费相关的社交话题。
- 主动消息 2.0 完成详细报错、gzip 上行、云端聊天通知对齐和用户点击时请求通知权限。
- 聊天已兼容 Vertex 原生 `functionCall` 响应；Notion 日记读取对瞬时网络失败增加重试。
- 聊天外观与模式切换修复已接入，API 预设标题栏恢复紧凑高度且预设面板保持固定高度。

- 完成 2026-07-28 上游同步并恢复全部已知 EM 补丁。
- 首页保留两个 widget + 三行图标；第二页保留 pinwheel；普通页每页五行图标。
- 恢复 Health、Shopping、Map 专用图标。
- Finance、Health、Shopping、Map 与 Finance 周期规则进入全量备份/恢复。
- Shopping 店铺目录、整页和折叠店内商品均可独立滚动。
- 聊天引用气泡和正文按各自内容宽度收缩，并提供 `.sully-quote-bubble` CSS 钩子；整组方向由当前消息发送者决定（用户靠右、角色靠左）。
- 更新 Claude/Codex 的上游审批规则：调研、执行合并、推进 main、push main 分别需要对应授权。
- 验收分支合入上游的写歌工作台、API 预设编辑/删除、生活记录补录、新闻源/备份/API 日志/记忆恢复、日程上下文和查手机修复。
- 语音条恢复上游气泡工坊五项主题设置；EM 只保留用户“文字作为语音条发送”的展示功能。角色未配 TTS 时仍能输出语音标签，语音条可转文字，真实播放才需要配置。
- 聊天“日程/情绪”设置增加每角色日程密度滑块：5–12 段，默认 8 段，松手后重生成当天日程。
- 生活系日程增加可展开的“日常节律”与跨午夜睡眠区间；睡眠区间按角色时区优先覆盖凌晨遗留 slot，显示为离线的“睡眠中”。意识系不显示也不注入这两项。
- 合入多角色故事剧场：每条剧情独立线程，可选角色/世界书/预设/面具；默认独立记忆，只有显式开启时才镜像到角色记忆。故事线、预设与面具进入完整备份。
- 合入故事剧场首映入口、Sully 默认头像迁移、Hot News API 迁移、API 预设编辑与安全删除、写歌工作台重做、查手机 NPC 历史定位修复及大备份导出稳定性。

## 验证基线

- 角色 API 解绑（2026-08-17）：生产构建通过；角色路由、角色卡隐私与主动消息相关定向测试 208 passed；`check-em-patches.sh` 74/74；全仓类型检查仍被既有的 MemoryPalace 等错误阻断，本次改动文件未新增报错。
- Smart Home（2026-08-17）：当前相关 3 个测试文件 23 passed；`check-em-patches.sh` 74/74；生产构建通过；桌面与 390px 手机布局通过浏览器检查。此前全量测试 3336 passed / 5 skipped，另有 2 项既有日期测试失败（`lifeRecords` 药盒创建日、`notionDiaryCadence` 跨时区日期），与本次改动无关且单独复跑可复现。
- `main`（2026-07-29）：`check-em-patches.sh` 74/74；`pnpm vitest run` 123 个测试文件、1250 passed、5 skipped；构建通过。
- 验收分支（2026-08-01）：`check-em-patches.sh` 74/74；全量 `pnpm vitest run` 133 个测试文件、1355 passed、5 skipped；构建通过。
- 验收分支定向补测：语音提示词/标签/转文字相关测试 57 passed；日程生成与 MessageItem 定向测试 18 passed。
- 验收分支（2026-08-02）：`check-em-patches.sh` 74/74；全量 `pnpm vitest run` 1409 passed / 5 skipped；构建通过。
- 移动端真实页面验证：Shopping 双层滚动和聊天引用气泡修复均已检查。

## 当前产品状态

### 完成

- 地图×日程 Clay 版。
- Intiface 硬件集成。
- Finance 重设计与备份。
- Token 面板召回记忆展示。
- Online / Busy / Offline；日程支持角色独立的 5–12 段密度、生活系日常节律与睡眠区间。
- 多角色独立剧情剧场。
- Open-Meteo、照片收藏、查手机轮播、Shopping、EM 角色代记、聊天快捷工具栏。
- Smart Home「共栖舱」App、Home Assistant REST/MCP 接入、演示模式与备份。

### 部分完成

- Health：核心记录、周期、饮食识别、聊天摘要和备份已完成；Apple Health 真导入、Notion 同步和角色周评未完成。
- 共读：epub、用户/角色批注已完成；回信支路、高亮和 PDF 未完成。
- Smart Home：软件接入已完成；真实设备发现、实体映射和角色控制仍待 Home Assistant 主机验收。

### 待做

- Notion 高级管理 App。
- 位置感知聊天。
- 独立 Diary App。
- 角色时区剩余入口与多人共享日程锚点。
- 邮局批量寄信限流方案。

## 文档入口

- 当前路线：`docs/roadmap.md`
- Agent、EM 功能与上游合并规则：`.claude/CLAUDE.md`、`AGENTS.md`
- 功能导航：`CLAUDE.md`
- 项目与用户可见功能：`README.md`

历史任务记录保留在 Git 历史中，不再把单次 Agent 会话日志当作当前项目进度。
