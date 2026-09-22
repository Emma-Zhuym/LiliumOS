# LiliumOS Agent Backend（Mac mini 常驻服务）

阶段 1a / 1b 的实现：配对、多设备推送、信箱、任务调度、连通测试、Home Assistant 看门狗。
**还没有**心跳和 Codex 运行器，那些在阶段 1c（设计见 [`docs/agent-backend-design.md`](../../docs/agent-backend-design.md)）。

与 Cloudflare 上的主动消息 2.0（amsg）完全无关：不共用表、不共用协议、不共用版本号。这个服务
停了，LiliumOS 的聊天和 amsg 的定时主动消息照常。

## 要求

- Node ≥ 22.5（用到内置的 `node:sqlite`；mini 上建议 24 LTS 以上）。
- 推送需要 `web-push`，它是**可选**依赖：没装就只有信箱、没有推送，服务照常跑。

```bash
cd server/agent-backend && npm install
```

## 目录

```
~/Library/Application Support/LiliumOS/agent-backend/
  agent.db          SQLite（WAL）
  secrets/          600 权限的密钥文件
  logs/             路由、状态码、耗时，不含聊天内容
```

`secrets/` 下的文件（缺哪个就少哪项能力，服务不会因此拒绝启动）：

| 文件 | 用途 |
|---|---|
| `vapid-public` / `vapid-private` | Web Push。**必须与 LiliumOS 站点现有的那一对完全一致**，否则前端会退订重建，amsg 的推送会跟着断 |
| `vapid-subject` | 可选，形如 `mailto:...`；缺省用占位值 |
| `apple-events-token` | 调本机 apple-events-bridge 用的 Bearer |

```bash
chmod 600 ~/Library/Application\ Support/LiliumOS/agent-backend/secrets/*
```

权限比 600 松时服务会拒绝启动——密钥躺在别人读得到的地方比没有更危险。

## 启动

```bash
node server/agent-backend/index.mjs
```

常驻用 LaunchAgent：改好 `cc.liliumos.agent-backend.plist` 里的 node 路径与仓库路径，然后

```bash
cp server/agent-backend/cc.liliumos.agent-backend.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/cc.liliumos.agent-backend.plist
```

## 对外入口

服务只监听 `127.0.0.1:8790`，**不直接暴露**。对外复用已有的那个代理
（`scripts/home-assistant-proxy.mjs`，Tailscale Funnel 入口），在它上面加一条
`/agent/*` → `127.0.0.1:8790` 的路由即可。代理只放行 GET / POST，本服务也只用这两种方法。

## 命令

```bash
node server/agent-backend/cli.mjs pair      # 生成 6 位配对码（10 分钟有效、只能用一次）
node server/agent-backend/cli.mjs devices   # 列出已配对设备
node server/agent-backend/cli.mjs ping      # 排一个连通测试任务
node server/agent-backend/cli.mjs vapid     # 生成 VAPID 密钥（只在还没有站点密钥时用）
```

## 接口（`/agent/v1`）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 否 | 进程活着没有 |
| POST | `/pair` | 否 | `{ code, deviceName }` → `{ deviceId, deviceToken }` |
| GET | `/status` | 是 | 各依赖真实状态 + `capabilities`，前端只认这个判断功能可用 |
| GET | `/devices` | 是 | 设备列表 |
| POST | `/devices/push` | 是 | 登记本设备的推送订阅 |
| POST | `/devices/revoke` | 是 | `{ deviceId }`；不能作废最后一台有效设备 |
| GET/POST | `/characters`、`/characters/upsert` | 是 | 角色登记（排任务前必须先登记） |
| POST | `/characters/presence` | 是 | 在场信号，用服务端时间，只增不减 |
| POST | `/jobs` | 是 | 建任务；客户端只能建 `test.ping`，心跳只能由调度器自己排 |
| GET | `/jobs` | 是 | 查任务 |
| POST | `/jobs/cancel` | 是 | `{ uuid }` |
| GET | `/outbox` | 是 | 取未 ack 的消息 |
| POST | `/outbox/ack` | 是 | `{ messageIds }` |

## 验收（阶段 1a / 1b）

1. 手机配对后能收到 `cli.mjs ping` 发出的测试通知，并能在信箱里补收同一条。
2. 关掉本服务，LiliumOS 聊天与 amsg 主动消息不受影响。
3. 关掉 Home Assistant 虚拟机，15 分钟内收到一次通知，且**只有一次**；恢复后再次故障能再通知。

## 测试

```bash
node --test server/agent-backend/index.test.mjs
```

全部用内存库和假的 fetch，不碰真实设备、不发真推送。
