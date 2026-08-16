# Token 面板扩展：展示本轮召回了哪几条记忆 spec

> **实施状态（2026-07-28）：已完成。** 采用随 payload 穿透的路径，并以独立 `recallBrief.ts` 缓存和 `recalledMemories` 字段落地；⚡ 面板在 0 条时也显示“未触发”。本文保留为数据链与验收契约。

roadmap（Token面板扩展）落地方案。目标：点开聊天头像栏 ⚡ 面板，除了现有 context 构成，还能看到"这一轮 AI 被喂了哪几条记忆宫殿的记忆"。

## 现有基础（都已存在，本功能主要是串起来）

1. **召回回执** `utils/memoryPalace/recallReceipts.ts` — 路径①召回每次注入 prompt 的 memoryId 列表已经在记录（localStorage 按 char 分键，环形 100 条）。写入方在 `memoryPalace/pipeline.ts`。
2. **Token 面板** — `hooks/useChatAI.ts` 的 `ContextComposition`（~43 行）+ `setContextComposition`（~745 行，`[EM: context-composition-set]` 哨兵处，值来自 `payload.contextBreakdown`）；UI 在 `components/chat/ChatHeaderShell.tsx` ⚡ 展开面板。
3. **contextBreakdown** — `utils/chatRequestPayload.ts` 返回值，EM 功能清单 #2。

## 设计：数据从召回处穿到面板

**推荐路径（A）：随 payload 穿透**

1. `memoryPalace/pipeline.ts` 路径①召回完成处（写 recallReceipt 的同一位置），把本轮召回明细整理成：
   ```ts
   export interface RecalledMemoryBrief {
     id: string;
     /** 记忆一句话摘要/标题，截 ~40 字，来自记忆节点自身字段（formatter 注入时就有） */
     snippet: string;
     /** 来源：向量召回 / 事件盒展开 / 置顶等（pipeline 里能区分就带上，区分不了可省） */
     source?: string;
   }
   ```
2. 沿调用链把 `RecalledMemoryBrief[]` 返回给 `chatRequestPayload.ts`，塞进 `contextBreakdown.recalledMemories`。
   - 若调用链穿透太深（pipeline 在 ContextBuilder 内部多层），用**降级路径（B）**：pipeline 里存一个模块级 `lastRecallDetail`（charId → brief[]，仅内存），`chatRequestPayload` 组装 breakdown 时读取。B 的代价是"最后一次"语义（并发/群聊需按 charId 分键），单聊场景足够。
3. `useChatAI.ts` 的 `setContextComposition` 处把 `recalledMemories` 一起 set（哨兵注释内改动）。

**注意**：不要为此新增 LLM 调用或重复检索——数据在召回瞬间就是现成的，只是没暴露给 UI。

## UI（ChatHeaderShell ⚡ 面板内加一节）

- 现有 breakdown 列表下方加「🧠 本轮召回记忆 (N)」小节：
  - 每条一行：snippet（textSecondary，截断省略号）+ 可选 source 小标签（Tint 底 Ink 字 chip）
  - 零条时显示「本轮未触发记忆召回」（tertiary，别隐藏整节——"没召回"本身是有用信息）
- 形态遵守 design-system：面板内列表行、chip 用 tokens 常量，无新发明。
- 不做点击跳转记忆宫殿（本期不做，面板保持轻量）。

## 边界情况

- 短消息（"嗯""哈哈"）不触发召回是既有设计（KI-CO 同款优化，LiliumOS 本来就有）→ 显示"未触发"属正常
- 群聊：ContextComposition 是 1v1 聊天的 EM 功能，本期不动群聊
- recallReceipts 本身**不用改**——它服务 extraction 反查，别把 UI 需求耦合进去；brief 是平行的新数据流

## EM 惯例

- 改动点均在 EM 功能清单 #2（Token 面板）既有触点 + pipeline 一处新增；上游文件处用 `[EM-START/END: token-panel-recall]` 哨兵；完工记入 `.claude/CLAUDE.md`。

## 验收

1. 发一条会命中记忆的消息（提及旧事）→ ⚡ 面板出现召回列表，条数与本轮注入一致
2. 发"嗯" → 面板显示"本轮未触发记忆召回"
3. 切换角色再发消息 → 列表是新角色的召回，不串台
4. 断网/召回失败 → 面板不报错，正常显示 0 条
