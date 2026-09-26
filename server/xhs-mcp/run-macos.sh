#!/bin/zsh
# LaunchAgent 入口：从权限受限的文件读令牌，起 xiaohongshu-mcp，只听本机。
# 令牌和登录态都不进 plist、不进仓库、不进日志。
set -euo pipefail

ROOT="$HOME/Library/Application Support/LiliumOS/agent-tools"
APP="$ROOT/xiaohongshu-mcp"
TOKEN_FILE="$ROOT/secrets/xhs-mcp-token"

if [[ ! -r "$TOKEN_FILE" ]]; then
  print -u2 "Missing xhs-mcp token: $TOKEN_FILE"
  exit 1
fi
if [[ ! -x "$APP/xiaohongshu-mcp" ]]; then
  print -u2 "Missing binary: $APP/xiaohongshu-mcp"
  exit 1
fi

export PATH="/usr/bin:/bin:/usr/sbin:/sbin"
# 登录态（扫码后写的 cookies）放在私有目录里，不用它默认的当前目录 / /tmp
export COOKIES_PATH="$APP/data/cookies.json"
# 用环境变量传，不用 -token 参数：参数在进程列表里谁都看得见
export AUTH_TOKEN="$(<"$TOKEN_FILE")"

cd "$APP"
# 只听 127.0.0.1：对外只经 home-assistant-proxy（/xhs/*）→ Tailscale Funnel
exec "$APP/xiaohongshu-mcp" -port "127.0.0.1:18060"
