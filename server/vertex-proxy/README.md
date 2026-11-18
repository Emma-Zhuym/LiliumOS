# Vertex 转接（mini 常驻）

把 Vertex AI（现名 Gemini 平台 / Agent Platform）的 Gemini 包成 OpenAI 兼容接口，给酒馆、LiliumOS 聊天和心跳用。
2026-11-18 搭的，花的是那个号 Google Cloud 试用的 $300 赠金（2027-02-17 到期）。

## 为什么要转接

- 赠金只能花在 Vertex 上，AI Studio 的 Gemini API key 用不了。
- 新账号默认的组织政策禁了 API key（Express 模式）和服务账号 JSON 密钥（`iam.disableServiceAccountKeyCreation`），**别为了拿 JSON 去关政策**。
- 只剩 ADC：mini 上 `gcloud` 用这个号登录一次，令牌每小时自动换。手机和酒馆只认「OpenAI 格式 + 固定 key」，所以由这个小服务换令牌、补 `google/` 前缀。

付费渠道的数据不拿去训练，所以和网页版额度（`server/aistudio2api`）不同，**心跳和日程也可以走它**。

## 布局

| 东西 | 位置 |
|---|---|
| 程序 | `agent-tools/vertex/index.mjs`（从本目录 `index.mjs` 复制） |
| 设置 | `agent-tools/vertex/config.env`（模板 `config.env.template`：项目 ID、区域、模型清单） |
| Google 登录态 | `agent-tools/vertex/gcloud/`（`CLOUDSDK_CONFIG`，ADC 文件在里面，目录权限 700） |
| 对外 key | `agent-tools/secrets/vertex-proxy-token`，`run-macos.sh` 用环境变量传 |
| LaunchAgent | `cc.liliumos.vertex-proxy` |
| 日志 | `agent-tools/logs/vertex-proxy*.log`，只记模型、状态码、耗时 |

只听 `127.0.0.1:2060`。对外只经 Funnel 网关 `/vertex/v1/chat/completions`、`/vertex/v1/models`。

## 接入

OpenAI 兼容（酒馆选「自定义 OpenAI 兼容」，LiliumOS 新建 API 预设）：
- Base URL：`https://<Funnel 域名>/vertex/v1`
- Key：`vertex-proxy-token` 的内容
- 模型：从 `/v1/models` 拉，名字不带 `google/`

## 重新登录 / 换号

```bash
CLOUDSDK_CONFIG="$HOME/Library/Application Support/LiliumOS/agent-tools/vertex/gcloud" /opt/homebrew/share/google-cloud-sdk/bin/gcloud auth application-default login --no-launch-browser
CLOUDSDK_CONFIG="$HOME/Library/Application Support/LiliumOS/agent-tools/vertex/gcloud" /opt/homebrew/share/google-cloud-sdk/bin/gcloud auth application-default set-quota-project <项目 ID>
launchctl kickstart -k gui/$(id -u)/cc.liliumos.vertex-proxy
```

`--no-launch-browser` 打出链接，在无痕窗口登录对的号，把授权码贴回终端。

## 更新

改完本目录的 `index.mjs`：`cp server/vertex-proxy/index.mjs "$HOME/Library/Application Support/LiliumOS/agent-tools/vertex/"`，再 kickstart。
加模型改 `config.env` 的 `VERTEX_MODELS`（Vertex 的 OpenAI 接口没有列模型的端点）。

## 排查

- 日志一行 = 模型、状态码、耗时、字节数；`cut idle` = 连续 3 分钟没新内容被掐，`cut timeout` = 超过 15 分钟总上限。流式被掐时会给客户端发一条错误事件和 `[DONE]`，已写出的保留（2026-11-18 之前是 5 分钟硬上限、直接断连，酒馆的 HTML 小剧场一直挂着）

- 404 `Publisher model … was not found`：模型名不对或这个区域没有。2026-11-18 在 global 实测能用：`gemini-4-argon`、`gemini-3.1-pro-preview`、`gemini-3.8-flash`、`gemini-3.5-flash`、`gemini-3.1-flash-lite`；`gemini-3.1-pro`、`gemini-2.5-*` 是 404
- 429 `Resource exhausted`：Vertex 的共享容量被挤满（新模型常见，hydrogen / carbon 当天一直 429，argon 时好时坏），不是赠金用完。转接会隔 2 秒、5 秒自动重试两次，还不行才报错；放进备用链让下一条接
- Vertex 的报错是数组 `[{"error":…}]`，酒馆认不出来会一声不吭地停（2026-11-18 踩过），转接统一改成 OpenAI 的 `{"error":…}`，别删 `normalizeVertexError`
- 502「gcloud 换令牌失败」：登录态过期或被撤销，照上面重新登录
- 花了多少：Cloud 控制台 → 结算 → 报告；首页「设置预算提醒」
