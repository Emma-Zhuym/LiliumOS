# B 站 MCP（Mac mini 常驻）

把 [`XZXZZX-Ai/bilibili-mcp`](https://github.com/XZXZZX-Ai/bilibili-mcp)（`@xzxzzx/bilibili-mcp@1.14.2`，Apache-2.0）常驻在 Mac mini 上，
让角色能搜 B 站视频、读字幕 / 章节 / 评论 / 简介、搜 UP 主、看收藏夹。

- **只读**：12 个工具没有一个是发东西的（没有评论、弹幕、动态、私信），网关不需要停用名单
- 它是 stdio 服务，前面套的是 `server/apple-events-bridge/index.mjs` 那套 stdio→Streamable HTTP 转接（同一份代码，单独起一个实例）
- 登录态是 B 站网页 Cookie，在 mini 终端扫码写进 `~/.bilibili-mcp/config.json`（只有本用户可读），**会过期**，过期了再扫一次

## 链路

```text
LiliumOS（手机 / 电脑）
   │ HTTPS  Authorization: Bearer <bilibili-mcp-token>
   ▼
Tailscale Funnel → scripts/home-assistant-proxy.mjs（:18123）
   └─ /bili/mcp, /bili/health → 去掉 /bili 前缀 → 桥（127.0.0.1:8768）
                                                     └─ 每个 MCP 会话一个 bilibili-mcp 子进程（stdio）
```

- 桥只听 `127.0.0.1:8768`（8766 被 Codex 占了，8767 在 Tailscale 地址上有别的服务）
- 鉴权在桥上：没带令牌一律 401；网关只做路由和来源白名单，`/bili/` 下除了 `mcp`、`health` 都是 404
- 闲置 30 分钟的会话由桥自己回收子进程（LiliumOS 不发 DELETE）

## 部署（一次）

路径都在 `~/Library/Application Support/LiliumOS/agent-tools/` 下，跟苹果日历桥、小红书放在一起。

1. **装包**（不跑安装脚本）并放好桥和启动脚本：

   ```bash
   ROOT="$HOME/Library/Application Support/LiliumOS/agent-tools"
   APP="$ROOT/bilibili-mcp"
   mkdir -p "$APP/bridge" && cd "$APP"
   [ -f package.json ] || echo '{"private":true}' > package.json
   npm install --ignore-scripts @xzxzzx/bilibili-mcp@1.14.2
   cd ~/Projects/Lilium/LiliumOS
   cp server/apple-events-bridge/index.mjs "$APP/bridge/index.mjs"
   cp server/bilibili-mcp/run-macos.sh "$APP/" && chmod 700 "$APP/run-macos.sh"
   ```

2. **扫码登录**（必须在 mini 本人终端操作，窗口要够大——约 46 列 × 29 行，Claude 桌面版的终端面板太矮）：

   ```bash
   node "$APP/node_modules/@xzxzzx/bilibili-mcp/dist/cli.js" setup
   ```

   回车选扫码，用手机 B 站 App 扫。问要不要装语音转文字（ASR）选「否」：
   它先试 NVIDIA GPU，Mac 没有；CPU 回退在 mini 上也没通过（2026-10-08），半成品会在 `~/.bilibili-mcp/asr` 留 245MB。
   不装 ASR 的代价是：没有字幕（含 B 站 AI 字幕）的视频读不到正文，简介、评论、章节照常。

3. **生成令牌**（只存在这个文件里，不进仓库、plist、日志、Engram、备份）：

   ```bash
   (umask 077; openssl rand -hex 32 > "$ROOT/secrets/bilibili-mcp-token")
   ```

4. **常驻**（plist 写死了 `/Users/emmazhu`，换用户要改）：

   ```bash
   cp server/bilibili-mcp/cc.liliumos.bilibili-mcp.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/cc.liliumos.bilibili-mcp.plist
   curl -s http://127.0.0.1:8768/health
   ```

5. **重启网关**拿到 `/bili/*` 路由：`launchctl kickstart -k gui/$(id -u)/com.liliumos.home-assistant-proxy`

   ```bash
   curl -s https://<mini>.<tailnet>.ts.net/__proxy-health    # routes 里有 bilibili
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<mini>.<tailnet>.ts.net/bili/mcp   # 没带令牌：401
   ```

## 两个坑（都已写进 run-macos.sh）

- **不能用 `npx` / `node_modules/.bin/bilibili-mcp` 启动**：它只在 `argv[1]` 等于 `cli.js` 真实路径时才运行，
  经软链接启动在 Node 23 / 24 上对不上，**什么都不输出就退出**。一律 `node <真实路径>/dist/cli.js`。
- **默认 UA 读视频会被 412**：它默认发浏览器 UA，mini 这条网络上 B 站对带 `Mozilla` 的 UA 读 `/x/web-interface/view`
  一律回 412（搜索不拦），表现为读视频信息 / 字幕 / 评论都是「网络请求失败」。改成 `USER_AGENT=bilibili-mcp/1.14.2` 后全部正常。
  哪天又 412 了，先用 curl 换几个 UA 打 `https://api.bilibili.com/x/web-interface/view?bvid=…` 看是不是 B 站又改了规则。

## LiliumOS 里怎么填

设置 → 「MCP 工具服务器」→「配置」→「+ 添加」：

- 服务器 URL：`https://<mini>.<tailnet>.ts.net/bili/mcp`
- Bearer Token：`secrets/bilibili-mcp-token` 里那串；代理留空
- 点「测试连接」，应拉到 12 个工具；打开开关
- 「可用聊天」可以只绑给想让 TA 看 B 站的角色

## 排查

- **401**：令牌填错，或 mini 上换过令牌
- **工具回「未登录」/ 凭证失效**：mini 终端重跑第 2 步扫码；`node …/cli.js check` 看状态（不会打印 Cookie）
- **502 / 连不上**：`launchctl list | grep bilibili`，看 `agent-tools/logs/bilibili-mcp.error.log`
- **「该视频没有可用字幕」**：视频本身没字幕、也没 AI 字幕，没装 ASR 就读不到，属正常

## 边界

- 依赖 mini 在线（mini 每天 4–7 点休眠）
- 升级要手动改 `run-macos.sh` / README 里的版本号再 `npm install`；工具名、参数名（如 `bvid_or_url`）以 `tools/list` 为准
- 角色心跳自己逛 B 站、聊天里发链接自动读字幕还没接（见 `docs/ideas.md`）
