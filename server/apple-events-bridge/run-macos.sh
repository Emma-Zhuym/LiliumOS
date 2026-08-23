#!/bin/zsh
set -euo pipefail

ROOT="$HOME/Library/Application Support/LiliumOS/agent-tools"
TOKEN_FILE="$ROOT/secrets/apple-events-token"

export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export APPLE_EVENTS_COMMAND="$ROOT/node_modules/.bin/mcp-server-apple-events"
export LILIUM_MCP_HOST="127.0.0.1"
export LILIUM_MCP_PORT="8765"
export LILIUM_ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173,https://emma-zhuym.github.io"

if [[ ! -r "$TOKEN_FILE" ]]; then
  print -u2 "Missing bridge token: $TOKEN_FILE"
  exit 1
fi
export LILIUM_MCP_TOKEN="$(<"$TOKEN_FILE")"

exec "$HOME/.local/bin/node" "$ROOT/bridge/index.mjs"
