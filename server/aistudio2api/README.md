# AIStudio2API（mini 常驻）

把 Google AI Studio 网页版 Playground 的额度转成 OpenAI 兼容接口，给 LiliumOS 当一条**聊天备用线**。
上游项目：[Mag1cFall/AIStudio2API](https://github.com/Mag1cFall/AIStudio2API)（MIT，Go）。2026-11-18 部署的是 v0.3.11 darwin-arm64 命令行版。

## 为什么自己跑，不用公益站

公益站（如 catiecli 的 Playground Executor 油猴脚本）要把整个 Google 账号的登录 cookie 推到作者服务器，对话也经过它。
这里同一份额度、同一批模型，cookie 存在 mini 本机的 `auth/`，对话只在 mini 和 Google 之间走。
2026-11-18 读过源码：写死的外部地址只有 Google 自家、几个查出口 IP 的公共服务、GitHub（检查更新、下载运行组件），没有作者自己的服务器。

**仍然违反 AI Studio 的使用条款**：只挂专门的空号，别挂大号、家人的号、学校的号。带图片的请求会把附件暂存到那个号的 Drive（一小时后删）。

## 布局

| 东西 | 位置 |
|---|---|
| 程序 | `~/Library/Application Support/LiliumOS/agent-tools/aistudio2api/bin/aistudio2api` |
| 配置 | 同目录 `.env`（模板 `env.template`，权限 600） |
| Google 登录态 | 同目录 `auth/` |
| API 密钥 | `agent-tools/secrets/aistudio2api-token`，`run-macos.sh` 用环境变量 `PROXY_API_KEY` 传进去 |
| LaunchAgent | `cc.liliumos.aistudio2api`（`~/Library/LaunchAgents/`） |
| 日志 | `agent-tools/logs/aistudio2api*.log`；`REQUEST_BODY_LOG=false`，不落聊天正文 |

只听 `127.0.0.1:2048`（管理页面和 API 同端口）。对外只经 Funnel 网关 `scripts/home-assistant-proxy.mjs` 的
`/aistudio/v1/chat/completions` 和 `/aistudio/v1/models`，管理页面不从公网开。

## 加账号

要在 mini 上有图形界面的时候做（会弹一个隔离的 Firefox 窗口，自己登录，密码不经过任何脚本）：

```bash
cd ~/Library/Application\ Support/LiliumOS/agent-tools/aistudio2api && ./bin/aistudio2api setup --login
```

或者在 mini 的浏览器开 `http://127.0.0.1:2048` →「账户」→「浏览器登录」。加完到管理页面点「启动服务」（或重启 LaunchAgent）。

## 接进 LiliumOS

设置 → API 新建预设：
- Base URL：`https://<Funnel 域名>/aistudio/v1`
- Key：`aistudio2api-token` 的内容
- 模型：从 `/v1/models` 拉

**只放进聊天的备用链**，心跳和日程不走它：网页版额度的对话会被 Google 拿去改进产品，心跳快照里有健康、经期、日历。

## 更新

管理页面「版本」页一键更新；或照部署步骤重新下 Releases 的 `darwin-arm64.tar.gz`，核对 sha256 后替换 `bin/aistudio2api`，再
`launchctl kickstart -k gui/$(id -u)/cc.liliumos.aistudio2api`。

## 排查

- `curl -s http://127.0.0.1:18123/aistudio/v1/models -H "Authorization: Bearer $(cat …/aistudio2api-token)"`：
  `service_stopped` = 没有可用账号或没点启动；401 = 密钥不对
- 账号被限制时管理页面显示 `restricted` 和原因
