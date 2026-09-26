# 小红书 MCP（Mac mini 常驻）

把上游 [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) 常驻在 Mac mini 上，
代替「小红书 Lite」那套手动复制 cookie 的做法：

- **登录在 mini 上那个浏览器里**，用手机小红书扫一次码就行；过期了在 LiliumOS 设置里再扫一次，不用 F12
- 不再模拟网页签名（Lite 那套），小红书改签名时不跟着挂
- 前台聊天和主动消息 2.0（Cloudflare worker）走同一个 HTTPS 地址、同一个令牌

登录态依然是网页登录，**会过期**，只是续命方式从复制 cookie 变成扫码。能撑多久要实测。

## 链路

```text
LiliumOS（手机 / 电脑）、amsg worker
   │ HTTPS  Authorization: Bearer <xhs-mcp-token>
   ▼
Tailscale Funnel → scripts/home-assistant-proxy.mjs（:18123）
   └─ /xhs/mcp, /xhs/health → 去掉 /xhs 前缀 → xiaohongshu-mcp（127.0.0.1:18060）
```

- 服务只听 `127.0.0.1:18060`，不直接开给公网
- 鉴权用上游自带的 `AUTH_TOKEN`（无令牌请求一律 401）；网关只做路由和来源白名单
- 网关只放行 `/xhs/mcp` 和 `/xhs/health`：上游的 `/api/v1/*` REST 接口（发帖、删 cookie 等）不从公网开

## 部署（一次）

以下路径都在 `~/Library/Application Support/LiliumOS/agent-tools/` 下，跟 Apple 日历桥接放在一起。

1. **放二进制**：从上游 [Releases](https://github.com/xpzouying/xiaohongshu-mcp/releases) 下载
   `xiaohongshu-mcp-darwin-arm64`，改名放好：

   ```bash
   APP="$HOME/Library/Application Support/LiliumOS/agent-tools/xiaohongshu-mcp"
   mkdir -p "$APP/data"
   mv ~/Downloads/xiaohongshu-mcp-darwin-arm64 "$APP/xiaohongshu-mcp"
   chmod +x "$APP/xiaohongshu-mcp"
   xattr -d com.apple.quarantine "$APP/xiaohongshu-mcp" 2>/dev/null || true
   cp server/xhs-mcp/run-macos.sh "$APP/"
   chmod 700 "$APP/data"
   ```

   第一次启动会自己下载一个无头浏览器（约 150MB）。只支持 Apple Silicon。

2. **生成令牌**（只存在这个文件里，不进仓库、plist、日志、Engram、备份）：

   ```bash
   SECRETS="$HOME/Library/Application Support/LiliumOS/agent-tools/secrets"
   mkdir -p "$SECRETS"
   openssl rand -hex 32 > "$SECRETS/xhs-mcp-token"
   chmod 600 "$SECRETS/xhs-mcp-token"
   ```

3. **常驻**（plist 里的路径写死了 `/Users/emmazhu`，换用户要改）：

   ```bash
   cp server/xhs-mcp/cc.liliumos.xhs-mcp.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/cc.liliumos.xhs-mcp.plist
   curl -s http://127.0.0.1:18060/health        # 本机自检
   ```

4. **重启网关**：拉到这次改动后，按平时的方式重启 `scripts/home-assistant-proxy.mjs`，
   它就多了 `/xhs/*` 这条路由。Funnel 不用动（还是同一个入口）。

   ```bash
   curl -s https://<mini>.<tailnet>.ts.net/__proxy-health   # routes 里应该有 xiaohongshu
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<mini>.<tailnet>.ts.net/xhs/mcp   # 没带令牌：401
   ```

## LiliumOS 里怎么填

设置 → 实时感知 → **小红书 · 本地**：

- 服务器 URL：`https://<mini>.<tailnet>.ts.net/xhs/mcp`
- 访问令牌：`xhs-mcp-token` 文件里那串
- 点「扫码登录」→ 用手机小红书扫出来的二维码（4 分钟内有效）。二维码最好在电脑上打开这页再用手机扫
- 扫完点「测试连接」，看到账号昵称就好了；再点保存
- 想让哪个角色用，就在那个角色聊天设置里打开「小红书」

保存后主动消息 2.0 的云端配置会一起同步，worker 用同一个地址和令牌直连 Funnel。

## 排查

- **测试连接说 401**：令牌填错了，或者 mini 上换过令牌
- **测试连接显示未登录**：点「扫码登录」重新扫；服务器上的登录态存在 `xiaohongshu-mcp/data/cookies.json`
- **502 / 连不上**：`launchctl list | grep xhs-mcp`，再看 `agent-tools/logs/xhs-mcp.error.log`
- 同一 tailnet 里的设备访问 Funnel 域名一直超时：见 `server/apple-events-bridge/README.md` 最后那段（关掉那台设备的 Tailscale DNS）

## 边界

- 依赖 mini 在线（mini 每天 4–7 点休眠，这段时间角色用不了小红书）
- 账号仍有被风控的可能：建议小号，也别让角色频繁主动发帖
- 这是个人部署：上游版本升级需要手动换二进制，工具名变了看 `utils/xhsMcpClient.ts` 的 `TOOL_NAME_ALIASES`
