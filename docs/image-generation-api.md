# LiliumOS 生图 API 与角色立绘参考

> 状态：自定义直连与主 Worker 中转均已在线出图；角色画风预设、本地 API 调用记录、移动端结果归一化和失败重试已接入。最后核对：2026-08-18。

## 目标

聊天模型输出 `[[SEND_PHOTO: 场景描述]]` 时，由独立的生图通道生成图片。生图配置不跟随角色聊天 API 预设切换，私聊、本地主动消息与 Active Message 2.0 的客户端后处理共用同一份全局配置。

第一版同时满足两种使用方式：

1. 零配置继续使用原有免费生图，不破坏旧角色和旧聊天行为。
2. 用户可接入支持图片输入的自定义接口，并用角色立绘尽量维持面部特征。

## 设置页行为

入口：`系统设置 → 生图 API`。

### 内置免费

- 默认选项，无需 URL、Key 或 Model。
- 保留原有 `image.pollinations.ai` 文本生图 URL。
- 只发送场景描述与角色的 `photoStyle` 画风标签。
- 当前内置通道不读取角色立绘，因此不能保证同一角色每次生成相同的脸。

### 自定义接口

- 接口形状：OpenAI Images 兼容。
- 必填：API 根 URL、Model。
- 可选：API Key，允许连接免鉴权或本机服务。
- 请求模式可选“稳定中转”或“浏览器直连”。中转适合 GitHub Pages 等静态部署；直连适合本机服务或已正确配置 CORS 的远程接口。
- “刷新模型列表”请求 `{baseUrl}/models`，复用通用模型列表解析器；成功后打开可搜索的独立生图模型选择页。
- 设置页可直接生成一张测试图并显示真实错误，不必等待聊天模型触发 `SEND_PHOTO`。
- `/models` 不可用或格式不兼容时仍可手动输入模型名。
- 生图模型列表和选择不改变主聊天模型或识图模型。

## 角色画风预设

聊天设置中的“发照片风格”由 `utils/photoStylePresets.ts` 统一提供标签和提示词，避免界面选项与实际生成标签漂移。当前预设为：

- 无
- 真实随拍
- 日系透明水彩
- 半写实幻想
- 柔光胶片
- 韩系精绘
- 清透日漫
- 电影写真
- 厚涂插画

其中，水彩预设只迁移透明水彩、纸张颗粒、晕染和细线稿，不复制参考作品的姿势、服装、构图或背景；半写实幻想保留二次元五官比例，强化湿发、珠宝、水面和织物等真实材质，同时压制毛孔级和 uncanny 的过度真人化；韩系精绘只采用彩色条漫/乙女游戏 CG 式的干净线稿、赛璐璐与柔和体积上色，不锁定粉色或任何固定背景物件。

## 配置契约

配置保存在 `APIConfig.imageGeneration`：

```ts
interface ImageGenerationApiConfig {
  provider: 'pollinations-free' | 'openai-compatible';
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  requestMode?: 'direct' | 'proxy';
  useCharacterReference?: boolean;
}
```

- 缺少配置时等价于 `pollinations-free`。
- 旧自定义配置的 `requestMode` 缺省为 `direct`，升级不会静默把 Key 改道到 Worker。
- `useCharacterReference` 缺省视为开启，但只对自定义接口生效。
- URL、Key、Model 经过与主 API 相同的边缘空白和不可见字符清理。
- 配置随 `apiConfig` 写入本地存储，并进入文字备份与完整备份；恢复时沿用现有 `updateApiConfig` 归一化入口。

## 角色参考图选择

启用立绘参考后，每次生图按以下顺序选择第一张可用图片：

1. 当前启用皮肤的 `normal`。
2. 当前启用皮肤的 `default`。
3. 当前皮肤其它非 `chibi` 立绘。
4. 角色默认立绘中的 `normal`、`default` 和其它非 `chibi` 立绘。
5. 角色头像。

明确规则：

- `sprites.chibi` 永不作为脸部参考。
- Emoji、空值和无法识别的字符串不是参考图。
- 支持本地 `blobref:`、`data:image/`、HTTP(S) 与站内绝对路径图片。
- 当前只上传一张身份参考图，不把姿势、服装或背景当作必须复刻的内容。

## 请求与降级

### 纯文字生成

请求：`POST {baseUrl}/images/generations`。

请求体包含 `model`、`prompt`、`n: 1`。不再强制发送 `size`，避免不接受 `1024x1024` 的兼容接口直接拒绝。响应支持原始图片、URL、`b64_json`、`b64`、`base64` 及常见嵌套数组。

### 带角色参考生成

请求：`POST {baseUrl}/images/edits`，使用 multipart 表单与单图 `image` 字段。

场景描述前会加入身份保持说明，要求尽量维持脸型、眼睛、五官比例、发际线、发色和辨识特征，同时不强制复制参考图的姿势、表情、服装、构图与背景。

### 降级规则

- 角色没有可用立绘：提示后直接走纯文字生成。
- 立绘读取失败或请求发生网络错误：提示后尝试纯文字生成。
- 编辑接口返回 400、404、405、415 或 422：视为接口/模型不支持参考图，提示后尝试纯文字生成。
- 401、403、429 与服务端错误不静默吞掉，直接按生图失败处理。
- 生图开始时先落一条固定尺寸的 pending 图片消息；成功后在原位置替换为成品，失败后保留原提示词与错误状态，可点按重新生成。

### 静态前端中转

- `requestMode: direct`：浏览器直接请求自定义 API；对方必须放行当前网页来源、`Authorization` 和 `Content-Type` 的 CORS 预检。
- `requestMode: proxy`：浏览器请求主 Worker 的 `/image-generation` 或 `/image-generation/models`，由 Worker 服务端访问自定义 API。
- Worker 只接受公网 HTTPS 地址，只转发 `/models`、`/images/generations` 和 `/images/edits`，拒绝本机及私网目标。
- 自定义接口若返回临时 CDN URL，Worker 会校验公网 HTTPS、跟随有限次安全重定向并下载图片本体，再以同源图片响应交给前端；不把上游 Key 转发给 CDN。
- 浏览器直连也会尝试把 URL 结果下载为本地图片数据；若 CDN 不允许跨域读取，会明确提示切换“稳定中转”，不再把不可显示的临时 URL 静默写进聊天。
- Worker 不持久化 Key、提示词、参考图或结果；Key 仅作为本次上游请求的 `Authorization` 头透传。

身份一致性属于模型能力和提示词共同作用的尽力而为结果，不承诺像素级锁脸。

## API 调用记录

- 自定义生图的 `/images/generations` 与 `/images/edits` 会进入 `设置 → API 调用记录`，不再只由中转站侧留痕。
- 记录包含请求模型、成功/失败、HTTP 状态、完整响应耗时、角色、是否尝试参考立绘以及是否经 Worker 中转。
- 参考图编辑失败后若触发纯文字降级，两次调用分别记录，便于区分“编辑不支持”和“最终仍成功出图”。
- 本地日志只统计文字提示词长度；不会保存 API Key、multipart 表单、角色立绘 Base64 或生成图片正文。
- 历史请求不会补录；功能更新后的新请求才会出现。

## 消息与主动消息链

- 当前生图不是发送给聊天模型的 OpenAI `tools` 函数，而是“模型输出照片标签 → 客户端后处理调用生图 API”的指令链；因此设置页测试成功只证明生图接口可用，不代表角色回复已经触发照片指令。
- `utils/applyAssistantPostProcessing.ts` 统一处理 `[[SEND_PHOTO]]`。
- 用户本轮明确索要自拍/照片而模型漏掉标签时，客户端会补一个英文照片描述并触发生图；否定请求不会触发。模型输出的单括号 `[SEND_PHOTO: ...]` 以及 ai-virtual-phone 风格的 `[照片: ...]`、`[照片:使用参考图: ...]` 也会归一成同一指令。
- 角色 `photoStyle` 仍追加到场景提示词，不与 API 供应商绑定。
- 成功图片消息记录 `imageGenerationProvider`、`imageGenerationModel`、`characterReferenceUsed`、原始 `photoPrompt` 与 `photoStyle`。
- 图片消息用 `imageGenerationStatus: pending | generated | failed` 表示生命周期；生成结果先转换为本地 `blobref:`，减少移动端内存占用并避免临时 URL、热链限制或 Safari 跨域显示差异。
- 失败重试沿用该消息保存的原始 `photoPrompt`、`photoStyle` 和当前全局生图配置，更新同一条消息，不额外制造失败文字气泡。
- `utils/activeMsgRuntime.ts` 把全局生图配置交给同一后处理，因此前台私聊与主动消息采用相同规则。

## 隐私边界

- 内置免费通道会把文字提示发送给 Pollinations。
- 自定义通道会把文字提示发送给用户填写的服务；开启角色参考时还会上传选中的角色立绘。
- 选择“稳定中转”时，上述数据会临时经过当前配置的主代理 Worker；选择“浏览器直连”时不会经过 Worker。
- Key 保存在 LiliumOS 的本地 API 配置中；用户导出含 API 配置的备份时，Key 会跟随备份内容。
- 不把生图 Key、角色立绘或生成结果写入 Engram。

## 验证基线

2026-08-18：

- `utils/imageGeneration.test.ts`
- `utils/apiConfigNormalize.test.ts`
- `utils/applyAssistantPostProcessing.test.ts`
- `worker/imageGenerationProxy.test.ts`
- 最新定向验证覆盖生图协议、调用记录、聊天后处理与画风预设，合计 70 tests passed，其中画风预设 5 tests passed。
- 移动端结果归一化与可恢复消息补测覆盖 URL 下载、Worker 公网校验、pending/failed UI 和原位状态更新；本轮相关定向验证 61 tests passed。
- Worker bundle 与 Vite 生产构建通过。
- `bash scripts/check-em-patches.sh`：79/79。
- localhost 页面检查覆盖：免费/自定义切换、直连/中转模式、测试生图、立绘参考、模型列表入口和模型选择弹层。
- localhost 聊天设置已确认九个画风选项完整显示；自定义浏览器直连与 Worker 中转均完成真实出图。

## 相关实现

- `types.ts`
- `utils/imageGeneration.ts`
- `utils/chatGeneratedImage.ts`
- `utils/applyAssistantPostProcessing.ts`
- `utils/activeMsgRuntime.ts`
- `apps/Settings.tsx`
- `worker/index.js`
- `components/chat/ChatModals.tsx`

## 重要外部参考

以下两个仓库作为后续 AI 小手机与生图演进的重要长期参考，但用途不同：

- [xiaolongbao0709/ai-virtual-phone](https://github.com/xiaolongbao0709/ai-virtual-phone) 是当前生图实现的主要工程参考。本轮采用其 URL 结果下载归一化、本地媒体存储、pending 原位替换和失败重试思路；其长超时与 heartbeat 方案保留为后续远程任务化参考。LiliumOS 仍保留自己的 IndexedDB、Worker 安全边界和 `[[SEND_PHOTO]]` 后处理架构。
- [shenqingmo3-dotcom/SharkOS](https://github.com/shenqingmo3-dotcom/SharkOS) 是 AI 手机产品形态、上传与视觉理解链路的参考。2026-08-18 审计时它没有真正的 AI 生图管线，其 scene card 是文字场景卡而非照片，因此不能把它当作生图代码来源；以后关注其手机交互、媒体输入和角色体验演进。

具体代码入口：

- [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI Images edit endpoint](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [Pollinations API documentation](https://github.com/pollinations/pollinations/blob/main/APIDOCS.md)
- [ai-virtual-phone image generation service](https://github.com/xiaolongbao0709/ai-virtual-phone/blob/main/lib/image-generation-service.ts)
- [ai-virtual-phone server image route](https://github.com/xiaolongbao0709/ai-virtual-phone/blob/main/app/api/image-generation/route.ts)
- [ai-virtual-phone generated image retry](https://github.com/xiaolongbao0709/ai-virtual-phone/blob/main/lib/generated-image-retry.ts)
- [ai-virtual-phone rich message parser](https://github.com/xiaolongbao0709/ai-virtual-phone/blob/main/lib/rich-message-parser.ts)
- [SharkOS repository](https://github.com/shenqingmo3-dotcom/SharkOS)
