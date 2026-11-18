# 见面 · 陪伴改版 spec

> 阿萌 2026-11-17 定。**状态：2026-11-17 已做完，等验收**（roadmap「做了，等验收」）。实际做法跟下文的差别：风格不写库迁移，读的时候折算；表情格子改的是「正在用」那一套（默认或某套皮肤），皮肤的新建 / 删除在「正在用」那一行点开的弹窗里。
>
> 原文：不考虑上游（已不再 merge），入口和选人页的美化先不管。番外另见 `docs/spec-meet-extra.md`。

## 定下来的事

1. **长文是默认**：现在的长文阅读页（人铺满、字在纸上）就是见面的样子。
2. **单独的阅读模式删掉**：深色 / 浅色小说页、「浅色阅读模式」「阅读模式显示头像」两个开关一起去掉。
3. **立绘模式保留，做成会话里的开关**：一行一念、逐条点的视觉小说那套，随时切过去、切回来。
4. **两套写作风格合成一套**；设置页只放还起作用的项。
5. **剧情不删，只收起来**：入口让给番外，剧情剧场和异格挪到番外首页底下（见番外 spec「界面」）。

## 数据层

- 新字段 `CharacterProfile.dateSpriteMode?: boolean`（行尾 `[EM: meet-redesign]`）：`true` = 立绘模式，缺省 = 长文。
  `isMeetLongform(char)` 改成 `char?.dateSpriteMode !== true`。旧字段 `dateLongform` 不再读，留在类型里不删（旧备份里有）。
- 新字段 `CharacterProfile.dateLongformLength?: 'short' | 'medium' | 'long'`：长文每轮篇幅，缺省 `medium`。
  - short：120–250 字、一到两段
  - medium：200–400 字、两到四段（就是现在的）
  - long：400–700 字、三到五段
  - 贴贴开着时照旧走亲密写法的 500–900 字，不受这档影响。
- `dateLightReading`、`dateReadingShowAvatars`、`savedDateState.isNovelMode` 不再读；类型留着。
- **写作风格合并**：只留 `dateWritingStyle`（16 种 EM 预设或自定义字符串）。`dateStyleConfig.style` 不再给见面用（剧情剧场的 `theaterGenerator.ts` 还在读它，字段留着）。
  - 不改库，读的时候折算（`utils/emMeetStyle.ts`；角色没设过 `dateWritingStyle` 才看上游 style）：`cinematic → cinematic`（分镜光影）、`plain → minimal`（极简快切）、`lyrical → immersive`（细腻沉浸，注意别按同名 key 迁成「繁花缱绻」）、`playful → comedy`（俏皮欢脱）、`intense → sweet`（心动放大）。缺省的电影感**不迁**，等于「默认」。
  - 「默认」= 不加风格块，只有五禁区底线。
  - 人称、细节深挖、自定义补充继续存在 `dateStyleConfig` 里（`pov` / `digDeeper` / `extra`）。之前「自定义文风描述」框（写进 `dateWritingStyle` 的自定义字符串）并进「补充要求」：迁移时若 `dateWritingStyle` 不是预设 key，就把它接到 `extra` 后面，`dateWritingStyle` 清空。

## 提示词

- 长文模式：`buildMeetLongformModeBlock` 不变，风格那一行从 `getStylePreset(...).hint` 换成 EM 预设的「气质 + 写法」两行（**不带「例：」那行**——示例是一行一念写的，长文模式下会把 TA 往回拽）。抽一个 `dateWritingStyleForLongform(key)` 放 `utils/dateWritingStyle.ts`，带单测。
- 长文模式下 `buildDateWritingStylePrompt` 那整块（含示例）**不再拼**，只留五禁区；现在两块都拼是 bug。
- 篇幅：`composeMeetLongformBlock` 和 `meetLongformNote` 里的「200–400 字、两到四段」改成按 `dateLongformLength` 取。
- 立绘模式：`buildVNModeBlock` 照旧，但风格块换成合并后的 EM 预设（整块、带示例，那本来就是一行一念的写法）；上游 `DATE_STYLE_PRESETS` 的 `block` 不再拼。
- 感知开场（peek）：风格那句从 `preset.peekHint` 换成 EM 预设的 `desc`；默认还是「电影感，沉浸式，细节丰富」。
- 上游原版的见面提示词（拆进 `datePrompts.ts` 之前）在 `git show 607ccf18^:apps/DateApp.tsx` 第 365 行起，要对照效果时看那里，不做成选项。

## 会话界面

- `components/date/DateSession.tsx`：
  - 删掉 `isNovelMode` 那一整支（小说页、浅色、头像、小说页里的多选删除、「立绘模式 / 阅读模式」切换钮）。存档恢复里的 `isNovelMode` 忽略。
  - 长文分支的判断改用新的 `isMeetLongform`。
  - 立绘模式顶栏菜单加「切到长文」；长文阅读页的「…」菜单加「切到立绘」。切换只写 `dateSpriteMode`，当前会话不中断、存档照常。
- 多选删除：小说页没了以后只剩长文页的单条长按删除。长文页的多选删除照旧算「暂时没做」，记进 `notes/todo.md`。

## 设置页

新文件 `components/date/MeetSettings.tsx`（全 F），替掉 `DateSettings.tsx` 的三处引用（`DateApp.tsx` 一处、`DateSession.tsx` 两处）；`DateSettings.tsx` 删掉。**全部改了就存**，去掉底部「保存当前布置」。顶栏标题「见面设置」，返回钮按公约。

分组（白卡，组标题衬线小字）：

1. **怎么写**
   - 呈现：长文 / 立绘 二选一（跟会话里的开关是同一个字段）
   - 篇幅：短 / 中 / 长（只在长文时出现）
   - 写作风格：默认 + 16 种，选中下面一行 `desc`
   - 叙事人称（四项；长文下「默认」写明按「我 / 你」）
   - 细节深挖（开关）
   - 补充要求（一个输入框，失焦保存）
2. **立绘与背景**（长文模式下整组折叠成一行「立绘模式才用得上」，点开照样能改）
   - 预览 + 大小 / 左右 / 上下三个滑块，松手就存
   - 背景图
3. **表情立绘**（两种模式都用：长文的立绘也跟情绪走）
   - 当前皮肤（默认 / 各皮肤）
   - 基础五种 + 自定义情绪的格子；每格点开：上传图片 / 贴网址（原来单独的「图床 URL」块并进格子里）
   - 皮肤管理：新建、改名、删除、逐格设图
4. **观测协议**：原样挂 `ObserveSettings`，样式不在这次改。

线下时间感知开关在角色设定页（`apps/Character.tsx`），语音开关在会话菜单里，这次都不搬。

## 本次不做

- 选人页美化、入口重排（阿萌说先不管）。
- 长文页的多选删除、长文模式的语音。
- 观测协议设置的换皮。
- 删除剧情剧场的任何代码或数据。

## EM 惯例

- 纯逻辑带单测：`isMeetLongform` 新语义、风格迁移映射、`dateWritingStyleForLongform`、篇幅取值。
- 改完跑 `pnpm vitest run` 和 `bash scripts/check-em-patches.sh`；`meet-longform` 那几个锚点按新写法更新。
- 做完在 `docs/changelog.md` 记一条，roadmap 的「见面长文模式」那行按新状态改。

## 验收

1. 新开一次见面直接是长文；以前开着长文的角色不变，以前没开的也变成长文。
2. 会话里切到立绘、再切回长文，消息都在，存档恢复正常。
3. 找不到深色 / 浅色小说页的入口。
4. 设置页只有上面四组；改风格后下一条回复就变；长文模式下 TA 不再写成一行一句。
5. 原来设过「细腻文艺」的角色，迁移后显示「细腻沉浸」；自定义文风那段出现在补充要求里。
6. 篇幅调短 / 调长，下一条回复长度跟着变。
