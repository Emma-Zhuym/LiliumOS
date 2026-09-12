> 历史调研/实现计划存档；实际采用范围和当前进度以 ../upstream-sync-2026-09-12.md 为准。本文中的临时路径仅指调研时的本机证据，可能在另一台电脑上不存在。

# 独立异格最小提取方案

## Routing Decision

- `AUDIT → SWEEP / new-component-scan + diff-regression-scan`，只读子任务；不是新的产品审批请求。
- 用户已选定：**剧情内独立入口；直接选人格分岔 × 世界背景；可随机；不接活动室、NPC、货币、抽芯片；协同暂不接。** 本报告落实该选择，替代旧盘点中“隐藏 NPC、保留房间壳”的建议。
- 上游证据固定为 `/private/tmp/liliumos-upstream-20260912-3p1dky2j/source`，提交 `ac48e7c6fca99c4524dc968bd56805b0ec127b4a`。标为“当前”的证据来自 `/Users/emmazhu/Projects/Lilium/LiliumOS`，本轮检查时分支 `merge-upstream-2026-09-12`，源码仍接近 `b61078f6`；父任务并行合并后行号可能变化。
- 本子任务只写本文件；未修改源码、分支、提交、远端或 Engram；没有调用付费模型。

## 结论与文件预算

建议 **4 个新生产文件 + 4 个现有接线文件** 即可完成独立产品；测试、项目交接文档另计。不需要搬入整个 SAR 目录，也不需要新增应用、数据库、钱包或模块注册框架。

| 文件建议 | 最小职责与来源 |
| --- | --- |
| 新 `utils/storyVariantCatalog.ts` | 49 个纯静态选项、按类型查找和本地随机。取上游 `sarGacha.ts:4–16,48–135`，去掉所有拥有量、抽取历史、每日次数与 commerce import。 |
| 新 `utils/storyVariant.ts` | 提示词、JSON 解析、人格/世界/用户面具解析、关系门牌上下文、一次铸造、一次互动、导出与分享文本。取 `sarSimulation.ts` 中纯异格部分；将 `sarNarrative.ts` 的 42 行规则/连续性辅助函数直接放这里即可，不必为它再建层。类型放在现有 `types.ts`；数据库操作调用 DB，避免此工具文件再拥有另一套存储。 |
| 新 `components/date/story/StoryVariantHub.tsx` | 角色选择、人格分岔选择、世界背景选择、随机按钮、创建/读身份卡、旧卡/旧故事列表和进入阅读页。参考 `SARAssemblyCabinet.tsx` 中身份展示和用户柜子逻辑，重新组合简洁界面；不要整件复制 493 行装配柜。 |
| 新 `components/date/story/StoryVariantSession.tsx` | 正文/旁白、输入、50 轮进度、提前封存、Markdown 下载、主动分享。参考 `SARSimulationSession.tsx`，移除设施导航、SAR 统计与 QA 全局钩子，按当前项目样式规范重做外壳。 |
| 改 `components/date/story/StoryTheater.tsx` | 加一个独立 view 和入口，回到剧情列表的返回动作。 |
| 改 `types.ts` | 异格身份卡、运行记录、连续性字段、数据库记录联合类型；`FullBackupData.storyVariants?`。不加 SAR/NPC/协同类型。 |
| 改 `utils/db.ts` | 现有数据库加 **一个** `story_variants` store；身份/运行记录和消息同事务写入；常规导出、导入登记。 |
| 改 `context/OSContext.tsx` | 完整/纯文字备份的 store 清单、分片映射、对象导出分派及恢复语义。API、角色和用户设置复用现有 useOS。 |

如果父任务更希望数据库事务放独立工具文件，新增 `utils/storyVariantStore.ts` 是可接受的第 9 个文件，但不是运行依赖要求。不要为了把文件数压到更少而重新使用会吞错的 localStorage，或把异格塞进 `vr_settings`。

## 提取边界与 imports

上游 `sarSimulation.ts:1–8` 的依赖可逐一处理：

| 上游依赖 | 独立版本处理 |
| --- | --- |
| `APIConfig / CharacterProfile / Message / UserProfile` | 保留；加入现有 `ApiPreset` 或由 UI 先解析 API。`GroupProfile / RealtimeConfig` 参数未参与正式异格上下文，去掉。 |
| `DB` | 保留；改用新 store 对应方法。消息仍使用现有 messages store。 |
| `RoomPlateDB`、`formatRoomPlatesSection` | 保留：只读角色卧室关系门牌；不引入整个记忆检索链。 |
| `safeFetchJson` | 保留，用同一个通用请求/记录入口。 |
| `getSARModuleById / SARModuleDefinition` | 换为独立静态目录。 |
| `readSARGachaState` | **完全移除**；`sarSimulation.ts:779–781` 的 collection 所有权检查改为“两个 ID 属于各自合法目录”。 |
| `getVRApi / logVRApiCall / resolveSARSimulationApi` | **完全移除**；换当前 `utils/characterApi.ts:35–68` 的角色预设解析。日志沿用 safeApi meta，标签改“剧情 / 异格”。 |
| `sarNarrative` | 内容是纯推演规则，可以就地收进新 core，不需要其他 SAR 引擎。 |

可复用现有 `shareOrDownloadBlob`、图标库、React、项目 tokens；不增加 npm 包。不要导入 `sarCommerce`、`fishingMarket`、`sarBackup`、`sarCharacterCabinet`、`trackSARFeature`、`SARFacilityGuide`、`SARPageNav`、`SARCharacterCabinetNoteMeta`、`SARClubRoom`、`SARCharacterPicker` 整套设施，或 `features/collaboration`。

`SARAssemblyCabinet.tsx:65–89` 的 ModulePicker 以 collection 筛选、显示拥有量，应替换为普通选择器。`:118–186` 的“角色自己的柜子”属于一次模型写完的自动活动，不属于本次用户手动异格，整块不提取。`:100–112` 身份卡展示可参考。`SARSimulationSession.tsx:83–117` 的 `render_game_to_text/advanceTime` 是原 QA 辅助，不是新功能依赖。

## 人格与世界数据如何独立复用

1. 上游 `sarGacha.ts:68–98` 有 25 个 `variant`，`:100–129` 有 24 个 `story`。保留文字内容及稳定 `variant-01…25`、`story-01…24` ID；这些本来是人格变化和世界背景，不是 NPC 卡。
2. 保留 `id/pool/title/group/summary/memory/routeTags`。`memory` 是供模型读取的该选项设定文字，不是角色现实记忆。`accent/sigil` 仅装饰，可忽略，不要让其颜色绕过本项目 tokens。
3. “随机”只从各目录本地选择一个 ID 并展示选中结果，**不调用 API、不自动创建、不扣任何资源**。用户仍按创建按钮确认这一组；允许反复随机和随意重选。
4. API 层接 ID 后自己从目录取原定义，校验人格槽/世界槽。不要把任意 UI 对象当可信完整定义，也不要保留“尚未拥有”的锁。
5. 保存身份时记录这对 ID 和生成后的完整 profile；推荐把选项的标题/设定文本作小快照留在卡内，以免未来目录删改影响已创建故事。现有 profile 已足以支撑主要演绎，目录只提供原始背景/兼容回退。

## 剧情入口与产品边界

- 当前 `apps/DateApp.tsx:720` 已把剧情页交给 `StoryTheater`；`StoryTheater.tsx:32` 有本地 View 枚举，`:182–221` 是子页分派。加 `variants` 分支即可，新 hub 内再持有当前卡/运行与阅读页。
- 入口放当前剧情页介绍下、已有剧情列表上，即 `StoryTheater.tsx:243–245` 之间，文案“异格”；说明“选择另一种人格分岔与世界，开启独立故事”。返回原剧情列表，不新增 AppID、Launcher、PhoneShell 或 DateApp 路由。
- 保持普通 `StoryTheaterEntry`、剧情预设、世界书、多角色故事与异格的存档各自独立；**不要把异格伪装成一个现有剧情预设**，否则会误接普通剧情记忆、向量归档和写回角色等行为。
- 上游阅读页有本地黑白主题 CSS。可以沿用当前剧情外观状态来避免再加主题存储键，但当前 `StoryTheaterTheme.tsx:39` 起含旧样式，并不代表它符合新 UI 规则。新 UI 写前仍须读项目 `APP_CONVENTIONS.md` §0，使用 `utils/clayTokens.ts`；不要整段搬 `sarReading.css`、`sar-cabinet-library.css` 或新增裸颜色。此只读报告没有实施 UI。

## 纯异格 API 与记忆契约

- API 优先级使用 **角色所选 API 预设 → 主 API**；当前解析器负责不存在预设时回退，且保留主配置的辅助服务。将 `apiPresets` 与当前 `apiConfig` 从 useOS 显式传给解析器，避免拿旧快照。独立异格不再读彼方 API、不要求先接入彼方。
- 创建卡片：1 次 `/chat/completions`，上游 `sarSimulation.ts:777–829` 使用结构化 JSON，非流式，`max_tokens:8000`。每次互动：1 次，上游 `:852–941` 生成旁白、角色正文和连续性事实，`max_tokens:3200`。可保留上游额度，但让配置中的温度/流式选择按现有角色 API 契约生效。
- 显式传 `maxRetries=0`。同时保留父任务负责的共享 `safeApi.ts:350–375` 无自动重试修复；原版铸造传 2 但被共享层压为 0。用户重新生成是新的可能收费请求；保存失败后的“重试保存”应只落盘已拿到的结果。
- 身份创建只使用角色名、描述、核心人设、用户名/bio 和本地卧室关系门牌（上游 `:526–575`）。运行使用卡片中生成的用户面具，**不再读现实 bio**，不走 ContextBuilder/世界书/聊天历史/完整记忆宫殿/embedding/实时状态/模块。门牌不存在或读取失败时没有关系背景，不补全现实事件。
- 每条运行最多 50 次成功提交，开新 run 可复用旧卡。旁白与人物回应是同一个模型请求；封存、下载、分享、看历史均为 0 次。累计完整创建加 50 轮才可能有 51 次，绝不是一键预扣。
- 正文隐藏 `directorState` 中世界尚未揭露的事实；只给模型保持连续性。下载/分享不可意外把这些隐藏事实直接泄露，保留上游 `:389–482` 只格式化实际可见文本的做法。
- 私聊与异格线程隔离，例如 `story-variant:${runId}`，独立 metadata source。只有用户主动点“分享封存”才向原角色私聊写一条 user 消息；写明这是一份主动分享的异界记录，不能伪装成角色原有真实记忆；**不触发模型自动回复**。原角色被删除时仍可阅读/导出旧卡，但不能继续请求或写向不存在的角色。

## Must Fix Now：保存与备份契约

### 保存不能把未落盘当成功

证据：上游 `sarSimulation.ts:280–283` 吞掉 localStorage 写入异常却返回卡；`:922–940` 分别存两条消息后再写回合数；`:483–514` 分享消息与 sharedAt 分别写。此前对真实 write 函数的最小故障注入得到 `errorSurfaced:false, returnedCardId:"probe-card", realStored:false`，已证实保存失败会报告成功。当前 `utils/db.ts:790–817` 的 saveMessage 也在 request success 而非 transaction complete 时返回，不能用连续两个 saveMessage 修成原子提交。

最小可靠做法是在当前 `AetherOS_Data` 数据库加一个 `story_variants` store（当前 `DB_VERSION=70`，父任务合并后按最终版本加一；当前建表位置 `utils/db.ts:349–351`）。以 `kind:'card'|'run'` 区分两个记录，仍共用一个 store，消息保留在 messages。事务方法放 DB 现有模块，不另建数据库。

1. 创建卡、开 run、提前封存均等待 `transaction.oncomplete` 才显示成功；读取损坏/失败不得返回“空库”并覆盖原记录。不存在正常返回空，异常明确报错。
2. 模型生成在事务之外；拿到结果后开启同一 `readwrite` 事务读当前 run，校验 active、卡片归属、期望回合数，再写用户消息、助手消息、递增回合数/第 50 轮封存。任何一步异常 abort，三部分全不写；成功才更新 UI。
3. 每次提交有稳定 `operationId`，提交时记录最后/已提交 ID 与对应回合。重试同一结果只返回已提交内容，不能再追加一对消息或增加轮数。两个页面竞争同一 run 时由事务内期望回合校验拒绝过期提交。避免为了重试启动第二次生成。
4. 保存失败时保留模型结果和原输入在当前会话，提供“重试保存”；API 请求失败只保留输入。应明确区分“没有拿到结果”和“已生成但未保存”。刷新前尚未保存的内存结果不能宣称有恢复保证；不必为本次再建后台任务/云端队列。
5. 分享操作在 `story_variants + messages` 同一事务校验 archived/sharedAt，写私聊消息与 sharedAt，重复操作零重复。直接写 messages 时注意当前 `DB.saveMessage` 兼有水位线自愈；可在成功提交后复用这小段辅助，不要为原子性把普通私聊的水位保护悄悄丢掉。
6. 消息读失败是报错，不是空历史；不得空上下文继续生成下一轮。删除卡/运行若 UI 提供，应同事务清理关联运行与异格消息；不顺手删除已主动分享到私聊的独立消息。
7. 不继承原版 `.slice(0,100)` / `.slice(0,160)` 的静默截断（`:269–283`），避免收藏增多时丢掉关联卡或 run。容量问题应可见，不能后台裁旧故事。

### 备份必须带走所有可继续演绎的数据

- 新 `FullBackupData.storyVariants?: StoryVariantRecord[]`，参考当前 `types.ts:4126–4128` 的剧情字段。消息继续随已有 `messages` 备份，卡、run、次数、封存、分享去重状态一同携带；连续性事实在助手 metadata 内必须保留。纯文字版也完整携带这些文字，仅处理头像等媒体。
- `utils/db.ts` 同时登记：建表、exportData 的并行读取/返回（`:3110–3175`）、importFullData availableStores（`:3233`）、plannedSections（`:3311`）、实际导入小节（参考 `:3587–3598`）。不要只补类型或只有导出。
- `context/OSContext.tsx` 同时登记 allStores `:3898`、textOnlyFieldByStore `:4275`、普通导出 switch `:4491`。完整 ZIP 与纯文字流式 ZIP 是不同路径，必须都补；媒体补丁不带异格记录，不清理现存异格。
- 若保留 `charAvatar` 等媒体字段，新 store 不得直接加进 noImageStores（`:4236`）跳过媒体扫描；也可以不持久化额外头像，显示时读当前角色/缺失用文字。
- 导入前验证所有新记录：ID 唯一、类型合法、run 引用卡存在、次数是 0–50 有限整数、status/封存字段一致、对应消息的 run/source/turn 合法。拒绝损坏记录应发生在对现有数据库写入之前，不能边清空边发现问题。
- `storyVariants:[]` 是明确空存档；缺字段与空数组不同。恢复替换主聊天历史的旧完整/纯文字备份时，应同时清空该旧包没有的异格状态，以免当前卡片指向已替换消息；媒体或部分补丁缺字段则不触碰。沿用现有导入的真实主历史判定（当前 DB 在 `:3512–3519` 用有无角色备份区分消息清空/补丁），**不要为了这一判定引入 collaborationBackupMode**。父任务如抽了共享备份 mode 标记，直接用通用标记。
- 全量导入本来采用分节写入，不承诺整库原子；本次不把整库备份重写一遍。但必须先校验新域并正确向上抛失败，不能提示全部恢复成功。需要测试还原后的卡/消息/次数一致。
- 不导入 `sarBackup.ts`，它还负责钱包、活动室、抽卡、模块与大量本地偏好。若以后真要导入用户已有上游 SAR 档案，另做只映射 `sarLocalState.simulations` 和对应消息的兼容适配；本次没有证据表明用户已拥有此类存档，不额外承担整套旧 SAR 迁移。

## Refactor Signals / Slimming Opportunities / Do Not Touch Yet

- **已授权的产品改造**：collection 所有权、抽取 UI、设施导航、NPC 柜子、经济依赖都不提取。这是落实独立异格选择，不是声称上游这些文件为死代码，也不授权从其他已保留功能中删除其有效依赖。
- **重复逻辑收口**：API 解析用现有 characterApi，外观偏好尽量沿现有剧情，备份用既有 DB/ZIP；不建专属设置层、日志库、主题偏好库。
- **必须保留的核心**：世界设定、用户面具、钢印/改写代价、分开显示旁白与角色、连续性事实、50 轮封存和主动分享；少搬文件不能简化成仅两个词拼提示词。
- **暂不触碰**：普通剧情的 worldbook/向量/写回记忆、现有彼方书库与 EPUB、主聊天、其他未选 SAR 玩法、协同，以及全部旧源码清理。

## Verification Gates

1. 有意义的单元测试：49 选项及类型边界、本地随机无网络；创建/互动上下文隔离；角色预设与缺失回退；正常创建 1 请求、每轮 1 请求，存储重试 0 请求；49→50 封存、已封存拒绝生成；分享无自动回复；隐藏事实不出现在阅读/导出/分享。
2. 数据故障测试：两条消息中第二条 add 失败、run put 失败、tx abort、读取失败、重复 operationId、并发过期回合；均检查真实持久层内容，不能只 mock 函数返回。可用项目已有 IndexedDB 测试设施；如果缺失，只为这批高影响事务引入合适测试依赖，不因 UI 小改加大量镜像测试。
3. 备份回环：身份卡 + 进行中 run + 封存 run + 连续性 metadata + sharedAt，经完整/纯文字导出再恢复一致；空数组、旧主历史缺字段、媒体补丁缺字段、非法记录拒绝分别测试。消息数和回合数必须对应。
4. 真实界面：从剧情进/退、直接选择任意组合、随机显示选中值、已存故事刷新续读、创建失败/保存失败的提示与输入保持、小屏键盘/安全区、提前封存、下载、分享只一次。使用 mock provider 验证交互即可，不擅自用用户 key 计费。
5. 静态检查新异格依赖图中没有 sarCommerce/fishing/NPC/collaboration/vrApi；新 UI 符合项目 tokens/顶栏规则。运行父任务要求的类型检查、相关测试和构建；不要把此只读方案当作已经实现或验收。

## Optimization Eligibility

`Eligible for Gate Review`：用户已批准的独立产品边界允许做以上必要提取/适配；本报告本身没有实施。没有性能测量证据，不申请额外性能优化；不新增存储框架、消息事件总线、后台自动演绎或全部 SAR 模块。
