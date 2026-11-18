#!/bin/zsh
# LaunchAgent 入口：AIStudio2API（把 AI Studio 网页版 Playground 的额度转成 OpenAI 兼容接口），只听本机。
# 令牌不进 plist、仓库、日志；Google 登录态在 $APP/auth/（mini 上隔离登录写的）。
set -euo pipefail

ROOT="$HOME/Library/Application Support/LiliumOS/agent-tools"
APP="$ROOT/aistudio2api"
TOKEN_FILE="$ROOT/secrets/aistudio2api-token"
BIN="$APP/bin/aistudio2api"

if [[ ! -r "$TOKEN_FILE" ]]; then
  print -u2 "Missing API token: $TOKEN_FILE"
  exit 1
fi
if [[ ! -x "$BIN" ]]; then
  print -u2 "Missing aistudio2api: $BIN"
  exit 1
fi

export PATH="/usr/bin:/bin:/usr/sbin:/sbin"
export PROXY_API_KEY="$(<"$TOKEN_FILE")"

# 它从当前目录读 .env、auth/、runtime/
cd "$APP"
exec "$BIN" -open-ui=false
