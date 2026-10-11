#!/bin/zsh
# LaunchAgent 入口：用 apple-events-bridge 那套 stdio→HTTP 转接，前面挂 bilibili-mcp，只听本机。
# 令牌不进 plist、仓库、日志；B 站登录态在 ~/.bilibili-mcp/config.json（mini 终端扫码写的）。
set -euo pipefail

ROOT="$HOME/Library/Application Support/LiliumOS/agent-tools"
APP="$ROOT/bilibili-mcp"
TOKEN_FILE="$ROOT/secrets/bilibili-mcp-token"
CLI="$APP/node_modules/@xzxzzx/bilibili-mcp/dist/cli.js"

if [[ ! -r "$TOKEN_FILE" ]]; then
  print -u2 "Missing bridge token: $TOKEN_FILE"
  exit 1
fi
if [[ ! -r "$CLI" ]]; then
  print -u2 "Missing bilibili-mcp: $CLI"
  exit 1
fi

export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# 直接 node 跑 cli.js 的真实路径，不走 npx / node_modules/.bin：
# 它只在 argv[1] 等于自身真实路径时才启动，软链接在 Node 23/24 上对不上，会静默退出。
export APPLE_EVENTS_COMMAND="$HOME/.local/bin/node"
export APPLE_EVENTS_ARGS_JSON="[\"$CLI\"]"
export LILIUM_MCP_LABEL="bilibili"
export LILIUM_MCP_HOST="127.0.0.1"
export LILIUM_MCP_PORT="8768"
# 读字幕 / 评论要连着请求好几次 B 站；比客户端的 60s 略短，超时由桥先回错而不是浏览器干等
export LILIUM_MCP_TIMEOUT_MS="55000"
# 它默认的浏览器 UA 在 mini 这条网络上读视频信息会被 B 站 412 风控（带 Mozilla 的 UA 全拦，搜索不拦）；
# 换成老实的工具 UA 后视频信息、字幕、评论、搜索都正常（2026-10-08 实测）。
export USER_AGENT="bilibili-mcp/1.14.2"
export LILIUM_ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173,https://emma-zhuym.github.io"
export LILIUM_MCP_TOKEN="$(<"$TOKEN_FILE")"

exec "$HOME/.local/bin/node" "$APP/bridge/index.mjs"
