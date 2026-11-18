# 见面 · 番外 spec

> 阿萌 2026-11-17 定。**状态：2026-11-17 已做完，等验收**。实际做法跟下文的差别：人称选项是「第三人称 / 我和你 / 你」；长文页那套纸借烛下的 `useDeepTalkTheme`；书架顶上按角色筛只在写过两个人以上时出现。
>
> 原文：见面 App 里新开一个「番外」：贴一段刷到的剧情梗概，TA 一次写出一篇几千字的完整短篇，主角永远是 TA 和她。
> 跟「剧情」（一来一回的跑团，见 `components/date/story/`）不是一回事，别往剧情剧场里塞。陪伴那半的改版见 `docs/spec-meet-redesign.md`。

## 为什么要单独做

- 她常刷到 AU / 小故事梗概，想看的是**一口气读完的全文**，不是自己接话往下推。
- 剧情剧场是照 SillyTavern 搭的（预设槽位、面具、世界书、群聊、归档），每次只生成一条回复，不合这个用法。

## 数据层

独立库 `utils/meetExtraDb.ts`（`LiliumOS_MeetExtra`，照 `tietieDb.ts` / `deepTalkDb.ts` 的写法），一张表 `extras`：

```ts
interface MeetExtra {
    id: string;
    charId: string;
    title: string;              // 模型第一行 `# 标题` 解析出来；没有就取梗概前 12 个字
    synopsis: string;           // 她贴的梗概，原样存
    memory: 'persona' | 'together';
    length: 'short' | 'medium' | 'long';   // 约 2000 / 4000 / 7000 字
    extra?: string;             // 她补的要求（可选）
    body: string;               // 全文
    summary?: string;           // 300–500 字的总结，分享时才生成（懒）
    status: 'writing' | 'done' | 'failed';
    error?: string;
    sharedAt?: number;
    createdAt: number;
    updatedAt: number;
}
```

- 随完整备份和纯文字备份走：`emMeetExtras`（`OSContext.tsx` 导出 / 恢复各一行）。
- **先落库再调 API**（贴贴踩过的坑，见 `.claude/CLAUDE.md` 第 43 节）：点「开写」先存一条 `status: 'writing'`，流式写进来时节流着存 `body`；页面中途被杀，回来显示「没写完」，可以接着写或重写。

## 提示词（`utils/meetExtraPrompt.ts`，纯逻辑 + 单测）

**两档都必带**：角色设定 + 她的人设（`userProfile`，含这个角色专属的身份 / 头像那一套）。无论 AU 还是现实向，都是「我俩」的故事。

| 档位 | 额外带上 | 适合 |
|---|---|---|
| `persona` 只带人设 | 无 | 彻底 AU，两人可能互不认识，只要性格和说话方式还是 TA |
| `together` 带上我们现在的样子 | 长期记忆、以梗概为查询的记忆宫殿召回（`injectMemoryPalace`，上限照普通聊天）、最近一天半的私聊（照日程那套：最多 120 条、至少 30 条，`schedule-recent-context`） | 「如果我们是……」，要用到现在的相处状态、默契和梗 |

- 两档都**不读**：实时感知（天气、日历、位置、健康）、主动消息状态、OOC 钉住的、烛下真话（`isWalledDeepTalkMessage` 要剔掉）。番外是故事，不是现在。
- 世界书：只挂角色身上那些常驻条目（跟见面一样走 `resolveWorldbookDepthEntries`），关键词条目以梗概 + 正文为扫描文本。
- 任务块要点：
  - 梗概是剧情走向，不照抄、不复述梗概原句；可以补细节、换节奏，结局方向守住梗概。
  - 第一行 `# 标题`，然后是正文；按段落写，不加小标题、不写「全文完」、不写作者的话。
  - 人称：缺省第三人称；她在表单里可以选「我 / 你」（照见面 `buildPovBlock` 的三种）。
  - 去八股沿用 `dateWritingStyle.ts` 的五禁区底线。
  - 篇幅给的是区间，不是硬下限：短 1500–2500、中 3500–5000、长 6000–8000 字。
- 生成参数：用这个角色的聊天 API（`resolveCharacterApiConfig`），`max_tokens` 按篇幅给（短 4000 / 中 8000 / 长 12000）；流式。

### 长篇分两次写

很多模型单次最多吐 8k token 左右（五六千汉字）。约定：

1. 第一次照常写。返回 `finish_reason === 'length'` 或字数没到区间下限且明显停在半句话 → 自动发第二次：把已写正文作为 assistant 消息带上，user 消息说「从断开的地方接着写完，不要重复」。
2. 最多接两次；接完还不够就算写完，界面上显示「比预期短」。
3. 「接着写」按钮（她手动点）走同一条路，可以加一句她的补充（「往虐里写」）。

## 分享到聊天

- 番外阅读页「分享给 TA」→ 往这个角色的私聊插一条 `type: 'meet_extra_card'`（`metadata.meetExtra = { id, title, synopsis, body, summary? }`）。卡片画成标题 + 梗概两行 + 「点开读」，点开进番外阅读页。
- **历史里怎么给 TA 看**（`chatPrompts.ts` 的 `buildMessageHistory`，照 `[EM: webpage-card-history]` 那一支写）：
  - 分享后她说话的轮数 < `MEET_EXTRA_FULL_ROUNDS`（= 4，阿萌说三四五轮）→ 带全文，方便两人聊细节。
  - 之后 → 只带 `summary`（300–500 字）。还没生成好就退回正文开头 400 字。
  - 两种都加一句框定：「这是你们一起读 / 你写的一篇番外，是虚构的故事，不是真实发生过的事」。
- `summary` 在点分享时后台生成（一次便宜调用，温度 0.3），生成完写回番外记录，并 `updateMessageMetadata` 回卡片。分享不等它。
- 分享过的卡片会进记忆宫殿（这次讨论是真实发生的），给记忆管线的那一行只用标题 + 总结 + 「虚构」框定，**不带全文**。
- 心跳快照近况：卡片只给标题那一行。

## 界面

- 入口：见面选人页顶上的「陪伴 / 剧情」改成「**陪伴 / 番外**」（`apps/DateApp.tsx`）。剧情剧场和异格挪到番外首页最底下一行小字「更多玩法：剧情剧场 · 异格」，点进去是原来的 `StoryTheater`，代码不动。`dateLaunch` 的 `surface: 'story'` 保留能用。
- 番外首页 `components/meetExtra/ExtraShelf.tsx`：按角色筛（顶上一排头像），一本一行：标题、角色、档位、字数、日期；右下「写一篇」。
- 新建 `ExtraComposer.tsx`（sheet）：选角色（单选）→ 粘贴梗概（大输入框）→ 档位二选一（带一句解释）→ 篇幅三档 → 人称 → 补充要求（可选）→ 开写。上次选的档位、篇幅、人称按角色记在本机。
- 阅读页 `ExtraReader.tsx`：纸面排版沿用长文阅读页（`MeetLongformReader.tsx` 的纸色和字号），流式时逐段出现；底栏：分享给 TA / 接着写 / 重写 / 删除（重写和删除要确认）。顶栏右边一个「梗概」小按钮，点开看原梗概和档位。
- 全部走 F（`utils/clayTokens.ts`），纸面颜色跟长文页一套；新模式补进 `APP_CONVENTIONS.md` 第二部分。

## 2026-11-17 追加

- 动笔前先想：`<thinking>` 里五六步（让人记住什么 / 设定变了什么没变什么 / together 档回看现实里的梗 / 关系从哪到哪 / 中间换几种发生法），存进 `thinking`，阅读页点开看
- 写法：默认简笔一处写细、设定不讲解、世界前后对得上、开头直接进场、结尾不升华
- 文风 / 基调：从素材库选（`utils/presetLibrary.ts`，直接导入酒馆预设 JSON，原文只在本机和私有备份）；「没想好？抽一个」随机拼 AU 梗概（池子是自己写的）

## 本次不做

- 改某一段 / 划一句让 TA 重写那一句。
- 多角色番外（两个以上的人）。真要群像再说。
- 番外里的立绘、语音、观测协议。
- 「让 TA 读读」但不进聊天（只进记忆）。
- 心跳里 TA 主动写番外给她。

## EM 惯例

- 纯逻辑放 `utils/meetExtra*.ts`，带单测（提示词拼装、标题解析、分两次写的判断、历史里全文 / 总结的切换）。
- 上游文件只有接线：`apps/DateApp.tsx` 入口、`chatPrompts.ts` 一支、`MessageItem.tsx` 一行卡片、`chatMessageVisibility.ts`、`OSContext.tsx` 备份两行；`scripts/check-em-patches.sh` 加一节锚点。
- 不进记忆宫殿的东西（番外全文、未分享的番外）一律只在 `LiliumOS_MeetExtra`。以后加新的「带走」路径（导出、快照…）先想番外全文要不要剔掉。

## 验收

1. 贴一段 AU 梗概、选「只带人设」、中篇：一次出 3500–5000 字，有标题，主角是 TA 和她，性格对得上，不出现现实里的事。
2. 同一段梗概选「带上我们现在的样子」：能看出最近聊过的事或两人的梗。
3. 选长篇：模型断在半截时自动接上，正文不重复。
4. 写到一半切走 App 再回来：显示没写完，能接着写。
5. 分享给 TA：接下来几轮 TA 能聊具体细节；第五轮以后 TA 只记得大概（看 Token 面板的历史长度确认）。TA 不会把番外当成真事。
6. 剧情剧场、异格从番外首页底下能进，旧剧情都在。
7. 完整备份 / 纯文字备份导出再导入，番外都在。
