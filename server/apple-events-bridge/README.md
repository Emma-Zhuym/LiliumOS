# LiliumOS Apple Events Bridge

Private Streamable HTTP bridge for the macOS-only
[`mcp-server-apple-events`](https://github.com/FradSer/mcp-server-apple-events).
It keeps EventKit access on the Mac and adapts the upstream stdio transport to
the HTTP transport already supported by LiliumOS.

## Safety defaults

- Listens on `127.0.0.1:8765` by default.
- Refuses a non-loopback bind unless `LILIUM_MCP_TOKEN` is set.
- Browser origins are denied unless listed in `LILIUM_ALLOWED_ORIGINS`.
- `/health` reports process health only and does not expose calendar data.
- Sessions idle for 30 minutes are closed and their child process reaped.
  Override with `LILIUM_MCP_SESSION_IDLE_MS`.

Each MCP session owns one `mcp-server-apple-events` child process. Clients are
not required to send `DELETE /mcp`, and LiliumOS never does, so the bridge
sweeps idle sessions itself once a minute. A client that re-runs `initialize`
with a stale `Mcp-Session-Id` also has its abandoned session closed instead of
leaving the child orphaned.

## Run

Install the macOS-only MCP server and SDK in a private runtime directory. Do
not commit this directory or its credentials:

```bash
mkdir -p "$HOME/Library/Application Support/LiliumOS/agent-tools"
cd "$HOME/Library/Application Support/LiliumOS/agent-tools"
npm install mcp-server-apple-events@1.5.0 @modelcontextprotocol/sdk@1.29.0
```

Copy this bridge directory to
`~/Library/Application Support/LiliumOS/agent-tools/bridge`, then create a
random Bearer token at:

```text
~/Library/Application Support/LiliumOS/agent-tools/secrets/apple-events-token
```

The token file must be readable only by the current user (`chmod 600`). Never
put the token in the plist, repository, logs, or documentation.

```bash
APPLE_EVENTS_COMMAND="$HOME/Library/Application Support/LiliumOS/agent-tools/node_modules/.bin/mcp-server-apple-events" \
LILIUM_ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173" \
node server/apple-events-bridge/index.mjs
```

The MCP endpoint is `http://127.0.0.1:8765/mcp` and the health endpoint is
`http://127.0.0.1:8765/health`.

On the Mac mini, `run-macos.sh` reads the Bearer token from
`~/Library/Application Support/LiliumOS/agent-tools/secrets/apple-events-token`.
The included LaunchAgent starts the bridge after the user logs in and keeps
credentials out of the plist and repository.

For remote access, put an authenticated HTTPS ingress in front of the bridge.
Do not expose the local port directly. A production bind must set a strong
`LILIUM_MCP_TOKEN`; LiliumOS sends it through the MCP server's Bearer Token
field.

### Tailscale Funnel (no custom domain)

The tested personal deployment keeps the bridge on loopback and exposes only
that service through Tailscale Funnel:

```bash
tailscale funnel --bg 8765
```

Use `https://<device>.<tailnet>.ts.net/mcp` as the LiliumOS MCP URL and leave
the proxy URL empty. Funnel supplies the stable HTTPS hostname; the bridge
still enforces its Bearer token and browser-origin allowlist.

If a client that is itself connected to the same tailnet resolves the Funnel
hostname to the device's private `100.x` address and times out, disable **Use
Tailscale DNS settings** on that client only. This does not disconnect the
tailnet; private services can still be reached by Tailscale IP.

### Installed service

`cc.liliumos.apple-events-bridge.plist` is a LaunchAgent template for the
personal Mac mini deployment. It starts after the macOS user logs in and
restarts the bridge after an unexpected exit. Installations for another user
must replace the absolute home-directory paths before loading the plist.

The reference deployment was verified on 2026-08-22 with Node.js 24,
`mcp-server-apple-events` 1.5.0, Tailscale Funnel, Bearer authentication, CORS,
and these five tools:

- `reminders_tasks`
- `reminders_lists`
- `reminders_subtasks`
- `calendar_events`
- `calendar_calendars`

`calendar_events` can read, create, update, and delete events. Calendar
collections are read-only. Alarms, recurrence rules, event URLs, structured
locations, and availability remain Calendar.app responsibilities. LiliumOS's
tool prompt requires confirmation before create/update/delete operations.

## Test

```bash
node --test server/apple-events-bridge/index.test.mjs
```

After deployment, verify `/health`, then test MCP initialize and `tools/list`
with the Bearer token. Do not print the token or calendar/reminder contents as
part of routine health checks.
