# SullyEM Current Progress

> 当前主干进度快照。最后更新：2026-07-29。

## 快照范围

- 当前分支：`main`
- 功能基线覆盖至：`39cf687` 及本次文档/引用对齐修订
- 最近上游基线：`qegj567-cloud/SullyOS` `9753431`（2026-07-28）

## 最近完成

- 完成 2026-07-28 上游同步并恢复全部已知 EM 补丁。
- 首页保留两个 widget + 三行图标；第二页保留 pinwheel；普通页每页五行图标。
- 恢复 Health、Shopping、Map 专用图标。
- Finance、Health、Shopping、Map 与 Finance 周期规则进入全量备份/恢复。
- Shopping 店铺目录、整页和折叠店内商品均可独立滚动。
- 聊天引用气泡和正文按各自内容宽度收缩，并提供 `.sully-quote-bubble` CSS 钩子；整组方向由当前消息发送者决定（用户靠右、角色靠左）。
- 更新 Claude/Codex 的上游审批规则：调研、执行合并、推进 main、push main 分别需要对应授权。

## 验证基线

- `bash scripts/check-em-patches.sh`：74/74 通过。
- `pnpm vitest run`：123 个测试文件，1250 passed，5 skipped。
- `pnpm run build`：通过。
- 移动端真实页面验证：Shopping 双层滚动和聊天引用气泡修复均已检查。

## 当前产品状态

### 完成

- 地图×日程 Clay 版。
- Intiface 硬件集成。
- Finance 重设计与备份。
- Token 面板召回记忆展示。
- Online / Busy / Offline。
- Open-Meteo、照片收藏、查手机轮播、Shopping、EM 角色代记。

### 部分完成

- Health：核心记录、周期、饮食识别、聊天摘要和备份已完成；Apple Health 真导入、Notion 同步和角色周评未完成。
- 共读：epub、用户/角色批注已完成；回信支路、高亮和 PDF 未完成。

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
