> 历史调研/实现计划存档；实际采用范围和当前进度以 ../upstream-sync-2026-09-12.md 为准。本文中的临时路径仅指调研时的本机证据，可能在另一台电脑上不存在。

# 语音收藏：纯文字语音与现有音频的最小适配方案

本报告只读。H 指 `/Users/emmazhu/Projects/Lilium/LiliumOS/` 当前 EM 实现，U 指 `/private/tmp/liliumos-upstream-20260912-3p1dky2j/source/` 上游快照。未编辑源码/Git/Engram，未调用任何 TTS 或模型。

## 结论与范围

采用上游的独立 `voiceFavorites` 索引和音频附件键，但把音频改成可选。EM 现有 `FavoritesPortal` 增加“语音”页签；聊天/图片收藏继续使用 EM `contentFavorites` 和 owners，不换上游整套收藏页。纯文字语音收藏保存文字、来源、时间与说话者；已有实际音频另存一份附件，来源删除后仍可读/播。

**硬约束：点击收藏、打开收藏页、导入/恢复收藏、点击纯文字收藏均不得调用 TTS，也不得要求配置 TTS API。** 私聊、见面和通话的收藏处理函数均要去掉“没有音频就生成”的兜底。只取内存或数据库已有音频，必要时 GET 已存在的音频 URL；拿不到音频仍保存文字并准确告知。收藏动作不自动播放。

这项适配不需要引入新版 TTS provider 路由、ElevenLabs、声音克隆或 Live2D 陪伴语音。若对应上游文件带有这些 import，应移除新增依赖或改接 H 已有能力，不能为收藏把暂缓功能顺带引入。

## 现有实现的具体障碍

| 位置 | 已确认行为 | 最小处理 |
|---|---|---|
| U `utils/voiceFavorites.ts:24`、`:126` | `SaveVoiceFavoriteInput.blob` 必填，保存先拒绝无 Blob/size 0，索引没有区分文字与音频。 | Blob 可选；没有 Blob 时允许非空文字快照；新增明确音频状态字段。 |
| U `apps/Chat.tsx:732`、`:743` | 收藏时没有 voiceData 便调用 `handleManualTts(msg, false)`；失败就不能收藏。 | 删除合成调用；独立提取文字，查已有 `voice_msg_<id>` 与 voiceDataMap；无音频仍保存。 |
| U `apps/Chat.tsx:3833`，`ChatModals.tsx:1007` | 可收藏条件只看 voiceData/语音标签，菜单额外限制 assistant。 | 增加 EM 用户 `metadata.voice === true`；移除收藏菜单对 assistant 的硬限制，继续限定为实际语音条。 |
| H `MessageItem.tsx:3666`、`:3677`、`:3781` | 角色 `<语音>` 标签即使无音频也显示语音条；用户 `type=text && metadata.voice` 同样如此。 | 同一事实用于收藏资格，不与 `voiceAvailable`、voiceProfile、API key、自动语音开关绑定。 |
| H `apps/Chat.tsx:509`、H `MessageItem.tsx:3918` | 当前无音频语音条的播放回调可能调用合成。 | 收藏页不要复用这个回调；纯文字项点“展开文字”，只有实际音频按钮才播放收藏 Blob。收藏手势需阻断冒泡，避免顺带触发聊天播放。原聊天播放行为不在本分片扩大修改。 |
| U `DateSession.tsx:475`、`:486` | 找不到已有 speech 时调用 translateAndSpeak，包含翻译和 TTS。 | 只查现有缓存；去掉合成/翻译调用。没有缓存时保存所选对白文字。 |
| U `DateSession.tsx:1231`、`:1300` | 见面语音收藏的长按/右键接线依赖 voiceEnabled。 | 若接入见面来源，收藏接线按“真实对白可选且非开场/非生成中”等原语义控制，独立于 TTS 配置；播放控件仍走原条件。 |
| U `CallApp.tsx:2219`、`:2232` | `ensureCallBubbleAudio()` 可能生成，URL 失效还 force=true 再生成。 | 两处 ensure 调用都删除；只取 bubble.audioUrl 或已保存本地缓存。失效时降为文字快照。 |
| U `VoiceFavoritesPortal.tsx:210`、`:302` | 每项都有播放按钮，无 Blob 就报“回到来源重新收藏”。 | 有音频才显示可播放按钮；文字项显示语音条/转文字入口；已标音频但附件缺失时显示“音频不可用，文字仍已保存”，绝不补合成。 |
| U `VoiceFavoriteActionSheet.tsx:53` | busy 文案固定“正在保存音频”。 | 改为“正在收藏…”。 |
| U `voiceMessageBackup.ts:62`、U `OSContext.tsx:4396` | text_only 模式将语音收藏索引与音频一起丢弃。 | 索引应在纯文字备份保留；只排除音频附件，标记已有音频此次未带出。 |

## 建议的数据结构与兼容方式

保留现有资产键、稳定 ID 和 sourceKey：

- 索引：`voice_favorites_index_v1`。
- 音频：`voice_favorite_audio_<favoriteId>`，仍在 `assets` 表，不改为图片 blobRef。
- 来源：`chat | call | date`。
- sourceKey：聊天 `<charId>:<messageId>`；通话沿用 `<charId>:<dbId-or-bubbleId>`；见面沿用消息 ID + 行号。不要因为新增文字类型再造一份不同 ID，同一来源只能 upsert 为一项。

建议小幅扩展 `VoiceFavorite`，保留 v1 索引键以直接读取旧资料：

```ts
type VoiceFavoriteAudioState = 'none' | 'stored' | 'omitted';

// VoiceFavorite 新增
audioState: VoiceFavoriteAudioState;
speakerRole?: 'user' | 'assistant';
speakerName?: string;

// SaveVoiceFavoriteInput 改动
blob?: Blob | null;
```

`none` 是本来就没有音频的文字语音；`stored` 表示收藏时保存过音频附件；`omitted` 表示文字备份刻意未带音频。后者避免恢复纯文字备份后把有意省略误报为损坏。旧索引无字段按 `stored` 兼容，因为上游旧保存入口强制有 Blob；读列表仍不加载音频。附件意外缺失与有意 omitted 区分处理。

`speakerRole`/`speakerName` 是为 EM 用户文字语音服务：`charId/charName` 继续表示所属角色会话，不能把用户语音错误显示成角色在说话。旧项默认 assistant、旧 charName 作显示回退即可。只保存必要文字快照和上述少量字段，不复制整份 message metadata。

保存规则：

1. 文本快照非空或有效现有音频至少满足一个；纯空条目不保存。`Blob.size === 0` 视为无音频，若有文字可照常保存，不能再一律“语音文件为空”。
2. 有有效 Blob 才写音频附件；无 Blob 只写索引。再次 upsert 同一项但这次没有 Blob，不应删除已经存好的旧音频，也不把其状态降为 none。
3. 维持 stable ID、favoritedAt 与写队列。取消收藏只删该 voice favorite 的索引项与专属音频附件，不删来源 `voice_msg_` 缓存或其他普通收藏。
4. 更新 sanitizer/save/load 一起保留新增字段；index 元数据不得存 blob: URL。旧数据、原音频 key 和测试 fixtures 继续兼容。
5. 底层 `saveVoiceFavorite` 不 import TTS/provider/translation；它只接受调用者已经取得的数据。这比传一个“允许合成=false”标志更可靠。

## 文字提取与调用点

建议新增纯函数 helper，例如 `utils/voiceFavoriteSnapshot.ts`，明确把“可收藏判断/文字快照”与“读取现有音频”分开。不要为了收藏调用 `handleManualTts` 来取得其副产品 originalText。

私聊：

- 用户 `metadata.voice === true`：正文作为文字语音快照，speakerRole=user，speakerName 取本次已确定用户名称；保留换行。
- 角色 `<语音>`：复用 H `parseVoiceOutput` 的标签修复与 subtitle 解析，但注意它的 `speech/rawSpeech` 会压平空白（H `minimaxTts.ts:175`），收藏若要完整保留原语音条换行，应提取归一标签后的原块，再用 H 现有显示清洗，不能为了方便把段落压成一行。
- 标签内话语是 voice/spoken 文本；`<字幕>` 是 translation，块外闲聊文字不是这段语音的译文。不得把块外一句闲聊写成翻译。
- 对已有 TTS 音频，优先保留已有 stored originalText/spokenText/lang；这些字段在旧外语语音中 originalText 常为中文翻译，不能统一改义破坏旧项显示。
- 按 MessageItem 同样规则处理繁体/未闭合标签、情绪/cue 标记、字幕，保留 EM 双语语音只显示一份译文的行为。不要把全部 UI 显示清洗重写为另一个语法解析器。
- 对 SAR 表里话，收藏应使用当前实际显示/听到的 surface 文本，而非为了上下文保留的 truth；若本阶段 SAR 未接入，不单独引入模块系统，只给未来 resolver 留参数即可。

读取音频的顺序：本次已有 Blob → `voice_msg_<id>.blob` → 已知 voiceData URL/StoredVoice.remoteUrl 的既有媒体 GET。不存在或失败即返回 null。U `shareExport.ts:57` 的 `fetchBlobForShare` 只是 fetch/原生 GET，可以用于取现有音频；调用前不能先 ensure/generate。

收藏成功后的旗标只写 `chatFavoriteKeys`；没有 voiceData 的纯文字项**不要**像上游 `setVoiceDataMap(...favorite:true)` 那样捏一个缺 url 的 VoiceData 对象。否则会扰乱“有无音频”的 UI/播放判断。已有真实 voiceData 可同步 favorite，但收藏状态以独立 ID 集合为准。

见面：target 已携带 originalText、sourceKey、timestamp（U `DateSession.tsx:150`、`:423`）。直接存 target；cache 里有 speech 才尝试取现成音频。不存在就无附件。开场/旁白与对白识别保持原规则，不把整个小说段落自动变成语音收藏。

通话：target bubble 已携带 text、audioUrl、timestamp、role。现有 extractVoiceTag/stripCallTextFormatting 能提取文字；只读取现成 URL，不 `ensureCallBubbleAudio`、不重生成。历史与实时通话入口共用这个安全处理。聊天新增用户语音收藏不要求顺便修改通话用户长按“编辑”这一既有语义。

菜单与收藏页：

- 私聊沿用 MessageItem 已有长按/右键选择消息 → ChatModals 的操作菜单，不必在所有语音条上新增独立悬浮星星。
- `voiceCollectable` 使用“text 且（用户 voice 元数据 / 角色语音标签 / 实际已有音频）”；不依赖是否配了 TTS。`voiceAvailable` 只控制独立的“转换语音”，与收藏无关。
- EM `FavoritesPortal` 增语音 tab，保留现有搜索/owners 图标和用户移除语义。语音 tab 支持来源过滤，可让既有关键词框过滤 original/spoken/translation/说话者以保持一致，分页按当前 portal 风格。
- 纯文字项提供“转文字/收起”或默认可读文字与“文字语音”标识，无播放/下载按钮，无“请先配 API”。stored 项保留播放；omitted 项显示已省略音频但文字可读。
- 普通“收藏聊天消息”与“收藏语音”是两个独立动作，取消一个不连带取消另一个。不自动制造双份普通收藏。

## contentFavorites owners 是否复用

**复用现有 EM 收藏页和保护规则；不要把 voice 强塞进现有 ContentFavorite union。**

H `ContentFavorite` 只有 chat/image 两类；`sanitizeFavorite`、图片去重、图库来源、删除与备份已有完整 owners 语义。上游独立 voiceFavorites 恰好可避免触碰这些。文字语音属于用户主动收藏，voice 索引可保持用户独占；没有本次需求要求角色也独立收藏语音，无需新增语音 owners。

直接以普通 chat 收藏来模拟语音 tab 并不完整：H `ChatFavoriteSnapshot` 明确不存 metadata（H `contentFavorites.ts:12`、`:40`、`:426`），来源删除后用户 `metadata.voice` 标记丢失，不能再判断它是语音；已合成但无语音标签的文字也不能识别，通话/见面单句与普通 message ID 关系亦不同。若强行扩展 contentFavorites，需改 sanitizer/union/移除/resolve/保留流程，影响面比独立 voice 索引更大。

因此保留 H `removeUserContentFavoriteById`、owners merge、图片身份对齐、legacyGallerySync 和 `preserveContentFavoritesBeforeMessageDeletion`。新范围清理只清来源消息与 `voice_msg_` 缓存，不碰独立 voice 索引/附件。让语音页并列读第二索引即可；无需导出/暴露 owners 内部私有函数。

## 备份必须一起适配

U `voiceMessageBackup.ts` 已解决 `JSON.stringify(Blob) === {}`：音频附件写 ZIP `assets/voice-favorites/*.bin`，索引仍是 JSON；恢复在 `DB.importFullData` 之前校验 marker 与文件尺寸。沿用这个机制和键，不要把音频 Blob 放入纯 JSON 索引。

最小改动：

1. `shouldIncludeVoiceRelatedAssetInBackup` 对 `VOICE_FAVORITES_INDEX_ASSET_ID` 始终保留；`includeFavorites` 参数应解释为“包含音频附件”，或更名 `includeVoiceAudio` 避免误解。音频前缀仍依 mode 控制。
2. text_only 导出克隆里的 stored 项设为 omitted；none 保持 none；不改当前数据库原项。这样用户在 MacBook 还原文字备份后仍看到全部文字语音收藏，不弹“音频丢失”。
3. `externalizeVoiceMessageBlobs` 无 Blob 时本来就跳过，适配后纯文字项只需普通 JSON 备份，不新增二进制占位标记。
4. 完整/带媒体备份保存有音频的附件与全部文字；只恢复实际存在的 markers，保留当前缺文件/尺寸不符在写库前中止的行为。纯文字项不得触发“缺少音频”校验。
5. 现有 v1 全音频收藏无 audioState 可读；text-only 若从旧数据导出，也按 stored→omitted 标记。原上游 text_only 包已经漏掉的收藏索引无法凭空恢复，不能承诺迁移能找回来。
6. 不把新 voiceMessageBackup 中 `companionVoiceAssets` 的依赖当作自动接入未批准 Live2D 语音升级的理由；可保留 H 已有陪伴备份逻辑，语音收藏仅接所需分支。

相关实际接线：U `OSContext.tsx:4396`（过滤）、`:4402`（外置 Blob）、`:4814`（导入前恢复）；`voiceMessageBackup.ts:57`、`:92`、`:117`。H `DB.getAssetRaw/saveAssetRaw` 已支持结构化对象与 Blob，无需为此新建数据库表或升 DB schema。

## 最小文件改动面与验证

必要生产文件：`utils/voiceFavorites.ts`；新纯函数快照 helper（或范围清楚的现有语音工具）；H `apps/Chat.tsx`、`ChatModals.tsx`、`FavoritesPortal.tsx`；`voiceMessageBackup.ts` 与 `OSContext.tsx` 两处备份接线。若见面/通话收藏作为已批准来源同步接入，再改各自收藏 handler/入口与 `VoiceFavoriteActionSheet`。`MessageItem` 只需保证共用可收藏事实/事件不误播，不必为收藏重写所有语音渲染。

应加的定向测试：

- 无任何 TTS 配置时收藏角色 `<语音>` 和 EM 用户 `metadata.voice`，都成功、可取消、重新进入仍在；TTS/translate/ensure mocks 全部调用次数为 0。
- 点击收藏/查看纯文字收藏不会调用 Audio.play、handlePlayVoice、fetch（无已知 URL 时）、任何 provider 或主/副模型。
- 有已存 Blob 时字节保留、删来源后仍播放；有现成 URL 只 GET 一次（原生降级按 helper 契约）；URL 失效保存文字，绝不合成。
- 纯文字/旧全音频 v1/音频丢失三种项正确显示；同 source upsert 不重复、不丢已有音频，取消只删该 voice 项。
- 角色语音+字幕/块外闲聊/未闭合标签/用户换行的快照正确；用户语音不标成角色发言。
- full/media 与 text_only 备份往返：文字索引始终在，媒体字节只在包含媒体时在；omitted 不误报损坏；不修改源库；丢失实际 marker 文件仍在写库前拦截。
- 同一消息同时有普通 EM 收藏和 voice 收藏：取消其中一个/清来源记录，另一项及所有 character owners 保留；图库收藏归属不变。
- 实机触屏长按收藏不会触发播放；无 TTS 的见面/通话入口可收藏且不弹 API 配置提示。

本次仅审阅源码与现有测试，未运行测试或浏览器验收。用户允许实际接入的范围由主 Agent 合并执行，以上是具体适配方案，不自行扩张暂缓功能。
