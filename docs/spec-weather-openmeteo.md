# 天气源迁移方案：OpenWeatherMap → Open-Meteo

> **实施状态（2026-07-28）：已完成。** `utils/openMeteo.ts`、`utils/realtimeContext.ts`、Settings 和旧配置迁移均已接入，并由 EM 哨兵与检查脚本保护。下方“现状（改动前）”只用于解释迁移动机。

目标：去掉 API key、去掉"手填城市名重名歧义"（Birmingham 美/英问题），天气跟着定位走。

## 现状（改动前）

- `utils/realtimeContext.ts`
  - `RealtimeConfig`: `weatherEnabled` / `weatherApiKey` / `weatherCity`（默认 `'Beijing'`）
  - `fetchWeather(config)`: 调 OpenWeatherMap（q=城市名&appid=KEY），模块级缓存 `weatherCache`（`config.cacheMinutes`，默认 30 分钟）
  - `WeatherData`: `{ temp, feelsLike, humidity, description, icon, city }`
  - `buildFullContext()` 约 543 行：`if (config.weatherEnabled && config.weatherApiKey)` 才取天气；注入格式 `【${city}实时天气】…` + `generateWeatherAdvice(weather)`
- `apps/Settings.tsx` 约 163-165 / 833-835：三个 state（enabled/key/city）+ 保存
- 已有 `utils/geo.ts` 的 `getCurrentPositionSmart()`（Capacitor 优先、回退 navigator，瑞幸在用）
- 天气消费方**只有** realtimeContext 内部和 Settings UI（CallApp/HotNewsApp/agenticTools 只用时间/新闻）→ 改动面封闭

## 目标设计

### 定位模式（二选一，Settings 切换）

1. **自动定位**（默认）：`getCurrentPositionSmart()` 经纬度 → 直接喂 Open-Meteo
2. **固定城市**：Settings 里搜索城市 → Open-Meteo Geocoding 返回候选列表（带国家+行政区，如 "Birmingham · Alabama · United States" vs "Birmingham · England · UK"）→ 用户点选 → **持久化 `{ name, admin1, country, latitude, longitude }`**。此后只用坐标查天气，城市名仅做显示 → 重名歧义消失

自动定位失败（拒权/超时）→ 有已存城市则降级用它，否则本轮静默跳过天气注入（返回 null，不挡聊天）。

### 新配置字段（RealtimeConfig）

```ts
weatherEnabled: boolean            // 保留
weatherMode: 'geo' | 'city'        // 新增，默认 'geo'
weatherLocation?: {                // 新增：city 模式选定；geo 模式可作降级缓存
  name: string; admin1?: string; country?: string;
  latitude: number; longitude: number;
}
// weatherApiKey / weatherCity → 从类型中删除（旧 JSON 多余字段无害，无需清洗）
```

### API 调用（均无 key）

天气：
```
https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}
  &current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code
  &timezone=auto
```
映射：`temperature_2m→temp`、`apparent_temperature→feelsLike`、`relative_humidity_2m→humidity`、`weather_code→description`（映射表见下）。

城市搜索（仅 Settings 用）：
```
https://geocoding-api.open-meteo.com/v1/search?name={query}&count=8&language=zh&format=json
```
候选项显示 `name · admin1 · country` 三段。

沿用 `safeResponseJson`/现有错误处理（console.error+返回 null）、沿用 `weatherCache` 缓存逻辑（geo 模式缓存 key 不必带坐标，30 分钟内位移可忽略）。

### WMO weather_code → 中文映射

`generateWeatherAdvice()` 靠关键词（雨/雪/晴/云/雾）匹配，映射必须含这些字：

| code | 描述 |
|---|---|
| 0 | 晴 |
| 1 | 基本晴朗 |
| 2 | 多云 |
| 3 | 阴天 |
| 45/48 | 雾 |
| 51/53/55 | 毛毛雨 |
| 56/57 | 冻毛毛雨 |
| 61/63/65 | 小雨/中雨/大雨 |
| 66/67 | 冻雨 |
| 71/73/75 | 小雪/中雪/大雪 |
| 77 | 雪粒 |
| 80/81/82 | 小阵雨/阵雨/强阵雨 |
| 85/86 | 阵雪 |
| 95 | 雷阵雨 |
| 96/99 | 雷阵雨伴冰雹 |

未知 code → `'未知'`。`WeatherData.icon`：确认无人消费就删；有人用按 code 粗映射，别花时间。

### city 显示名

Open-Meteo 不做反向地理编码，**不要**为此加第三方反查。geo 模式下：有 `weatherLocation` 就显示 `【{name}实时天气】`，没有就 `【你所在地实时天气】`（prompt 里角色不需要精确城市名）。

### buildFullContext 改动

守卫 `weatherEnabled && weatherApiKey` → 只留 `weatherEnabled`。注入格式与 `generateWeatherAdvice` 不动。

### Settings UI

- 删 API Key 输入框、删自由文本城市输入框
- 加模式切换（自动定位/固定城市）；固定城市 = 搜索框+候选下拉（三段显示），选中后展示已锁定城市可重选；自动定位 = 一行说明（首次会请求定位权限）

### 旧配置迁移

检测到旧配置（有 weatherApiKey/weatherCity 无 weatherMode）：`weatherMode='city'`、`weatherLocation` 留空（**不要拿旧城市名自动 geocoding 选第一个**——会复现 Birmingham 歧义），Settings 显示提示"天气已升级为免 key 服务，请重新选择城市或改用自动定位"。

### EM 惯例

- 新逻辑（WMO 映射、geocoding、模式判断）收进独立 `utils/openMeteo.ts`，realtimeContext 只留调用点
- 改上游文件处用 `[EM-START/END: weather-openmeteo]` 哨兵注释
- Settings 天气区改动记入 `.claude/CLAUDE.md` EM 功能清单

### 验收清单

1. 无 key 无城市 + 开自动定位 → prompt 出现真实天气（对照 open-meteo.com 同坐标手查）
2. 固定城市搜 "Birmingham" → 至少美/英两个候选，选 Alabama → 温度与 UAB 当地一致
3. 拒绝定位 + 无固定城市 → 聊天不报错，只是无天气段
4. 温度负数/零度时 generateWeatherAdvice 正常（temp<5 分支）
5. 缓存生效：30 分钟内两轮聊天只发一次天气请求（Network 面板）
