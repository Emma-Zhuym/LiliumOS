#!/bin/zsh
# LaunchAgent 入口：Vertex AI → OpenAI 兼容的小转接（index.mjs），只听本机 127.0.0.1:2060。
# 令牌不进 plist、仓库、日志；Google 凭据是 $APP/gcloud/ 里的 ADC 登录态（gcloud auth application-default login）。
set -euo pipefail

ROOT="$HOME/Library/Application Support/LiliumOS/agent-tools"
APP="$ROOT/vertex"
TOKEN_FILE="$ROOT/secrets/vertex-proxy-token"
CONFIG_FILE="$APP/config.env"

for f in "$TOKEN_FILE" "$CONFIG_FILE" "$APP/index.mjs"; do
  if [[ ! -r "$f" ]]; then
    print -u2 "Missing: $f"
    exit 1
  fi
done

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CLOUDSDK_CONFIG="$APP/gcloud"
export VERTEX_PROXY_TOKEN="$(<"$TOKEN_FILE")"
# VERTEX_PROJECT / VERTEX_LOCATION / VERTEX_MODELS
set -a
source "$CONFIG_FILE"
set +a

exec /opt/homebrew/bin/node "$APP/index.mjs"
