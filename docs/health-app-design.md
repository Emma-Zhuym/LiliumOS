# HealthApp 设计文档

> 原稿：2026-05-21 | 重大修订：2026-06-04

> **实施状态（2026-07-28）：核心完成，外部数据链部分完成。** 已实现本地 Health DB、训练/睡眠/饮食/经期/症状/体重、周期推算、饮食文本/照片识别、角色聊天健康摘要和完整备份。尚未完成 Apple Health 真导入（按钮仍提示开发中）、Notion HealthLog/Daily Routine 同步和 Health 内角色周评论。本文的 Notion/Apple Health 流程是待办契约，不应当成现有能力。

---

## 一、功能定位

Emma 的个人健康中心：经期追踪、训练记录、症状记录、体成分趋势。

**核心设计原则：**
- Health App 是**系统级**模块，数据不属于任何角色
- 每轮聊天会注入轻量健康摘要；详细事件读取仍应保持按需、克制
- 当前录入是结构化轻表单为主，饮食支持自然语言与照片识别

---

## 二、日历视图

月历为主视图，每个日期格下方最多显示 3 个彩色小点：

| 颜色 | 含义 |
|------|------|
| 🔴 深红 | 经期（量多） |
| 🩷 粉色 | 经期（量少/点滴） |
| 🔵 浅蓝 | 预测排卵窗口（背景色，不占点位） |
| 🟢 绿色 | 有训练记录 |
| 🟣 紫色 | 症状（痛经/腹胀等） |

日历顶部显示：当前周期第 X 天 · 预计下次 XX月XX日–XX日

---

## 三、数据录入：自然语言输入

Health App 内有「记录训练」和「记录症状/经期」两个入口。

**不通过任何角色**，由 Health App 自己调 LLM 提取结构化数据：

```
用户输入（自然语言）：
  "刚练完，背和腿，杠铃划船3组、负重深蹲、高位下拉，
   跑步机30分钟，Apple Watch 消耗480kcal"

LLM 提取 →

HealthLog 条目：
  date: 2026-06-04
  type: workout
  部位: [背, 腿]
  duration: 90min
  训练摘要: "杠铃划船×3组、负重深蹲×3组、高位下拉×3组 + 跑步机30min"
  source: manual

同时自动更新 Daily Routine（Notion）：
  健身: ✓
  消耗: 480
  页面 body Training 块追加一行摘要：
  "💪 背+腿｜杠铃划船×3 / 负重深蹲×3 / 高位下拉×3｜90min"
```

---

## 四、Notion 数据库结构

### HealthLog（事件详情库）

| 列名 | 类型 | 说明 |
|------|------|------|
| Date | Date | 日期 |
| Type | Select | workout / period / symptom |
| 部位 | Multi-select | 胸/臀/背/腿/肩/手臂（workout用） |
| Duration | Number | 时长（分钟） |
| 训练摘要 | Text | 主要动作，供角色读取 |
| 经期量 | Select | 点滴/少/中/多（period用） |
| 症状 | Multi-select | 痛经/腹胀/PMS/疲劳（symptom用） |
| Source | Select | manual / apple_health |

> **注意**：消耗 kcal 不在 HealthLog 里——只存在 Daily Routine 的 `消耗` 字段。

### Daily Routine（每日总览，已有）
Health App 写入时只更新两个字段：`健身 ✓` 和 `消耗`，其余字段用户自己填。

---

## 五、数据存储与同步

```
Health App 录入
  → IndexedDB（healthDb.ts，本地，角色读取用）
  → Notion HealthLog（备份，跨设备查看用）
  → 更新 Notion Daily Routine（健身✓ + 消耗）

Apple Health 快捷指令（可选，每晚自动）
  → 写入 Notion HealthLog（source: apple_health）
  → 下次打开 Health App 时增量同步到 IndexedDB
```

---

## 六、角色感知健康数据（两层设计）

### 第一层：轻量常驻注入
每次对话自动注入一行基本感知，不占太多 token：

```
【今日】睡眠 7.2h｜训练日（背+腿）
```

或：
```
【今日】睡眠 5.1h｜休息日
```

让角色能自然说出"你好像没睡好"或"今天练完了吧"。

### 第二层：对话触发按需读取
角色检测到健康相关话题时，主动读 IndexedDB 里的 HealthLog 详情：

```
用户："刚练完好累"
角色检测到训练话题
→ 读取今日 HealthLog 条目
→ "你今天练了背腿，消耗480kcal，难怪累……
   杠铃划船3组做完背应该很酸"
```

触发词范围：健身/训练/锻炼/练了/好累/肌肉/体重/经期/痛经/没睡好……

### 手动触发：角色周评论
Health App 底部「让 [角色] 说说这周」按钮——角色拿到本周完整健康摘要，用自己的口吻评论（3–5句）。每个角色独立评论，不存在"A先知道再告诉B"的问题。

---

## 七、周期推算（纯前端，无 LLM）

```typescript
function calcCycleStatus(periodStarts: string[]): CycleStatus {
  // 1. 当前周期第几天
  // 2. 过去 N 次周期长度 → 均值和标准差
  // 3. 预测下次 = 最近开始 + 均值，范围 = ±1σ
  // 4. 数据不足（<3次）或变异系数 >0.15 时标注"预测不确定"
}
```

显示用范围而非确定值："可能进入排卵窗口（第 12–16 天，你目前第 14 天）"

---

## 八、文件结构

| 文件 | 说明 |
|------|------|
| `apps/HealthApp.tsx` | 主 App：月历 + 详情 panel + 自然语言录入 |
| `utils/healthDb.ts` | IndexedDB 读写（健康数据表） |
| `utils/cycleCalc.ts` | 周期推算纯计算函数 |
| `utils/healthNotionSync.ts` | Notion ↔ IndexedDB 增量同步 |
| `utils/healthContextBuilder.ts` | 生成轻量注入摘要 + 按需读取接口 |

**需动的上游文件（最小改动）：**
- `constants.tsx`：加 `AppID.Health`
- `types.ts`：加健康数据类型
- `utils/chatRequestPayload.ts`：注入第一层轻量摘要
- `apps/Chat.tsx`：加健康话题检测 + 按需读取触发

---

## 九、实现顺序

1. 类型定义 + `healthDb.ts`
2. `cycleCalc.ts`
3. `HealthApp.tsx` 月历视图 + 彩点渲染
4. 自然语言录入 + LLM 提取 → IndexedDB + Notion 写入
5. `healthNotionSync.ts`（Notion 备份同步）
6. `healthContextBuilder.ts` + `chatRequestPayload.ts` 第一层注入
7. Chat.tsx 触发检测 + 第二层按需读取
8. 角色周评论按钮
