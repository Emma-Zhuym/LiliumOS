# Intiface 硬件集成设计文档

> 设计时间：2026-05-21  
> 连接方案：Intiface Central（本地 WebSocket）+ Buttplug.io 协议  
> 参考：Enclave0775/Intiface_Central-Sillytavern-plugin（ST 插件，命令格式参考）

> **实施状态（2026-07-28）：已完成。** 当前使用 `utils/intifaceClient.ts` 的原生 WebSocket / Buttplug 协议 v3 客户端，不依赖 `buttplug` npm 包；已接入 `hooks/useIntiface.ts`、Settings、Chat `control_toy` 工具、可拖动悬浮球和前台自动重连。本文后续的包依赖与早期文件规划仅作历史参考。

---

## 一、技术基础

**Intiface Central** 在用户设备上本地运行，暴露 WebSocket：`ws://localhost:12345`

当前实现：原生 WebSocket，无需安装 `buttplug` 包。

核心设备类型：
- **Vibrate**：震动马达（大多数玩具）
- **Oscillate**：摆动
- **Linear**：线性设备（The Handy 等）

v1 只实现 Vibrate，其余留扩展接口。

---

## 二、两种模式（核心差异）

### 模式 A：Chat 模式 — 角色主动控制（Tool Use）

**场景**：角色知道自己在遥控，这是对话的一部分。

```
用户：开始吧
角色："宝宝，我要开始了哦～"
      [tool_use: control_toy(intensity: 40, pattern: 'pulse')]
      "这个力度感受一下，乖不乖？"

用户：再高一点
角色："那就再高点～"
      [tool_use: control_toy(intensity: 70)]
      "这样好吗？"
```

工具定义（注入 API 请求）：
```typescript
{
  name: "control_toy",
  description: "控制用户连接的设备。角色在对话中主动调整设备时调用。intensity 0 = 停止。",
  input_schema: {
    type: "object",
    properties: {
      intensity:  { type: "number", description: "强度 0–100，0 为停止" },
      pattern:    { type: "string", enum: ["steady", "pulse", "wave"], description: "震动模式" },
      duration_ms:{ type: "number", description: "持续毫秒，省略则保持到下次调用" }
    },
    required: ["intensity"]
  }
}
```

**系统 prompt 补充**（有设备连接时自动注入）：
```
你现在可以通过 control_toy 工具直接控制用户连接的设备。
当你描述调整档位、改变强度时，同步调用工具让效果真实发生。
当前状态：已连接，设备：{deviceName}
```

### 模式 B：见面/约会模式 — 嵌入命令（叙事驱动）

**场景**：叙事正在发生，命令嵌在场景描写里，用户不感知命令存在。

命令格式（兼容 ST 插件，方便未来扩展）：
```
"VIBRATE": 70           — 单值，直接强度
"VIBRATE": 0            — 停止
```

AI prompt 指令：
```
在叙事的关键动作处嵌入隐藏控制标记，格式为 "VIBRATE": 数字（0-100）。
这些标记会被自动剥除不显示给用户，直接控制用户的设备。
- 0：停止
- 20–40：轻柔
- 50–70：中等
- 80–100：强烈/高潮
在动作开始处标记，场景结束时用 "VIBRATE": 0 归零。
```

客户端实时剥除：streaming chunk 到来时扫描正则，匹配到就触发 + 从文本中移除。

---

## 三、文件结构

```
utils/intifaceClient.ts     — WebSocket 连接、设备管理、命令发送（单例）
hooks/useIntiface.ts        — React hook（连接状态、设备列表、vibrate/stop）
utils/intifacePatterns.ts   — pattern 执行器（pulse/wave/steady 的定时逻辑）
```

**需要改动的上游文件（最小）：**
- `utils/chatRequestPayload.ts` — Chat 模式：有设备时注入 control_toy 工具
- `utils/chatPrompts.ts` — Chat 模式：有设备时在系统 prompt 追加控制说明
- `hooks/useChatAI.ts` — Chat 模式：检测 tool_use block，触发 intifaceClient
- `apps/DateApp.tsx` — 见面模式：流式输出时扫描 VIBRATE 标记
- `apps/Settings.tsx` — 设备管理 UI

---

## 四、安全 & 隐私

- 所有通信本地，不上云
- 设备使用记录不写 IndexedDB，不注入聊天上下文
- `visibilitychange` → hidden 时自动 stop()
- 紧急停止：Chat 头部图标长按 / Settings 里随时断开

---

## 五、实现顺序

1. `utils/intifaceClient.ts` + `hooks/useIntiface.ts` + `utils/intifacePatterns.ts`
2. Settings 配置 UI（连接/扫描/测试）
3. Chat 模式：tool 注入 + tool call 处理
4. 见面模式：流式标记扫描
