# LiliumOS 生图 API 与角色立绘参考

> 状态：第一版已实现，尚未提交或发布。最后核对：2026-08-17。

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
- “刷新模型列表”请求 `{baseUrl}/models`，复用通用模型列表解析器；成功后打开可搜索的独立生图模型选择页。
- `/models` 不可用或格式不兼容时仍可手动输入模型名。
- 生图模型列表和选择不改变主聊天模型或识图模型。

## 配置契约

配置保存在 `APIConfig.imageGeneration`：

```ts
interface ImageGenerationApiConfig {
  provider: 'pollinations-free' | 'openai-compatible';
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  useCharacterReference?: boolean;
}
```

- 缺少配置时等价于 `pollinations-free`。
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

请求体包含 `model`、`prompt`、`n: 1`、`size: 1024x1024`。响应可返回 URL 或 `b64_json`。

### 带角色参考生成

请求：`POST {baseUrl}/images/edits`，使用 multipart 表单与 `image[]` 字段。

场景描述前会加入身份保持说明，要求尽量维持脸型、眼睛、五官比例、发际线、发色和辨识特征，同时不强制复制参考图的姿势、表情、服装、构图与背景。

### 降级规则

- 角色没有可用立绘：提示后直接走纯文字生成。
- 立绘读取失败或请求发生网络错误：提示后尝试纯文字生成。
- 编辑接口返回 400、404、405、415 或 422：视为接口/模型不支持参考图，提示后尝试纯文字生成。
- 401、403、429 与服务端错误不静默吞掉，直接按生图失败处理。
- 生图失败时显示错误提示，并落一条“请检查设置里的生图 API”的文字气泡，避免整段回复无声消失。

身份一致性属于模型能力和提示词共同作用的尽力而为结果，不承诺像素级锁脸。

## 消息与主动消息链

- `utils/applyAssistantPostProcessing.ts` 统一处理 `[[SEND_PHOTO]]`。
- 角色 `photoStyle` 仍追加到场景提示词，不与 API 供应商绑定。
- 成功图片消息记录 `imageGenerationProvider`、`imageGenerationModel`、`characterReferenceUsed`、原始 `photoPrompt` 与 `photoStyle`。
- `utils/activeMsgRuntime.ts` 把全局生图配置交给同一后处理，因此前台私聊与主动消息采用相同规则。

## 隐私边界

- 内置免费通道会把文字提示发送给 Pollinations。
- 自定义通道会把文字提示发送给用户填写的服务；开启角色参考时还会上传选中的角色立绘。
- Key 保存在 LiliumOS 的本地 API 配置中；用户导出含 API 配置的备份时，Key 会跟随备份内容。
- 不把生图 Key、角色立绘或生成结果写入 Engram。

## 验证基线

2026-08-17：

- `utils/imageGeneration.test.ts`
- `utils/apiConfigNormalize.test.ts`
- `utils/applyAssistantPostProcessing.test.ts`
- 合计 31 tests passed。
- Worker bundle 与 Vite 生产构建通过。
- `bash scripts/check-em-patches.sh`：74/74。
- localhost 手机宽度检查通过：免费/自定义切换、立绘参考开关、模型列表入口和模型选择弹层。
- 全仓 `tsc --noEmit` 仍被既有的 MemoryPalace、MessageItem、CompanionHome 等错误阻断，本次相关文件未新增报错。

## 相关实现

- `types.ts`
- `utils/imageGeneration.ts`
- `utils/applyAssistantPostProcessing.ts`
- `utils/activeMsgRuntime.ts`
- `apps/Settings.tsx`
- `components/chat/ChatModals.tsx`

## 外部参考

- [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI Images edit endpoint](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [Pollinations API documentation](https://github.com/pollinations/pollinations/blob/main/APIDOCS.md)
