
import { CharacterProfile, UserProfile, Message, Emoji, EmojiCategory, GroupProfile, RealtimeConfig, DailySchedule } from '../types';
import { ContextBuilder } from './context';
import { DB } from './db';
import { formatLifeSimResetCardForContext } from './lifeSimChatCard';
import { normalizeMessageContent, stickerNameFromUrl, theaterWhenPhrase } from './messageFormat';
import { formatTransferRecord } from './transferFormat';
import { computeCurrentListening, getCurrentSlot } from './charMusicSchedule';
import { getCharLyricSnippet } from './charLyricCache';
import { MusicCfg, loadMusicCfgStandalone } from '../context/MusicContext';
import { RealtimeContextManager, NotionManager, FeishuManager, defaultRealtimeConfig } from './realtimeContext';
import { isScheduleFeatureOn } from './scheduleFeature';
import { VOICE_ACTING_GUIDE } from './minimaxTts';
import { FISH_VOICE_ACTING_GUIDE } from './fishAudioTts';
import { getTtsProvider, getVoicePromptOverride } from './ttsProvider';
import { resolveCharTimeZone, nowInTimeZone } from './timezone';
// [EM-START: prompt-addons] 个人化提示词全部在 emPromptAddons.ts，merge 时保住这行 import 和下面的调用点
import { emSendPhotoAddon, emQuoteSection, emNotionDiarySection, emFeishuDiarySection, emUserNotesSection, emXhsSection, emNotionDiaryNudgePrompt, emFavPhotoAddon, emVoiceAwareAddon } from './emPromptAddons';
// [EM-END: prompt-addons]
import { buildLifeRecordInjection } from './lifeRecords';
import { getCharNameById } from './charNameRegistry';
import { getLocalDateKey } from './localDate';
import { getDailyScheduleForChar } from './dailySchedule';
import { buildEmScribeInjection } from './emScribe'; // [EM: em-scribe]
import { formatRelativeAge } from './groupChat/relativeTime';

// 语音格式指导按当前 TTS 服务商二选一：用 MiniMax 才注入 MiniMax 那套（含 <#秒#> 停顿标记），
// 用鱼声则注入鱼声版（去掉 MiniMax 专属标记，改用标点 / 省略号控制停顿）。
// 用户在「设置 → 其他 API → 语音提示词」里自定义过该服务商的指南时，优先用用户那份；留空则回退内置默认。
const voiceActingGuide = (): string => {
  const provider = getTtsProvider();
  const custom = getVoicePromptOverride(provider);
  if (custom) return custom;
  return provider === 'fishaudio' ? FISH_VOICE_ACTING_GUIDE : VOICE_ACTING_GUIDE;
};

// 群活动注入专用：把一条群消息压成"适合塞进别人私聊背景"的短文本。
// 关键：image 消息的 content 是 base64（群里发图走 processImage 压成 JPEG，单张几十 KB），
// 卡片是大段 JSON，emoji 是图床 URL——这些原样内联进每位成员的私聊 system prompt
// 都是纯噪声，base64 图片更会把上下文直接撑爆（几张群图就能顶到 8w+ 字符，
// 解散群后该角色私聊上下文从 ~10w 掉回 ~3w 即由此而来）。
// 注意：私聊自己的历史不会有这个问题，buildMessageHistory 把图片走 image_url 结构化字段、
// 文本里只留 [User sent an image] 标记；这里只是把同样的"不要把媒体当文本塞"对齐到群注入。
// 处理方式：只内联纯文本（超长截断），其余一律占位符。
const GROUP_MSG_TEXT_CAP = 500;
function summarizeGroupMsgContent(m: Message): string {
    const meta = (m.metadata as any) || {};
    switch (m.type) {
        case 'image': return '[图片]';
        case 'emoji': return '[表情]';
        case 'interaction': {
            const mk = (m.metadata as any)?.kind;
            if (mk === 'delivery_arrived') return `[${(m.metadata as any)?.typeLabel || '快递'}已送达]`;
            if (mk === 'gift_delivered') return `[你送的${(m.metadata as any)?.typeLabel || '礼物'}已送达]`;
            return '[戳了戳]';
        }
        case 'transfer': return `[转账${meta.amount ?? ''}]`;
        case 'social_card': return `[分享帖子${meta.post?.title ? '：' + meta.post.title : ''}]`;
        case 'chat_forward': return '[转发的聊天记录]';
        case 'xhs_card': return '[小红书笔记]';
        case 'score_card': return '[评分卡]';
        case 'music_card': return '[分享音乐]';
        case 'mcd_card': return '[麦当劳点餐]';
        case 'html_card': return '[HTML卡片]';
        case 'news_card': return '[新闻卡片]';
        case 'trpg_card': return `[TRPG游戏片段${meta.trpg?.gameTitle ? '：《' + meta.trpg.gameTitle + '》' : ''}]`;
        case 'novel_card': return `[笔友会小说章节${meta.novel?.bookTitle ? '：《' + meta.novel.bookTitle + '》' : ''}]`;
        case 'world_card': return `[家园生活记录${meta.worldName ? '：' + meta.worldName : ''}]`;
        case 'sim_card': return `[一段回忆${meta.simCard?.theme ? '：' + meta.simCard.theme : ''}]`;
        case 'phone_card': return `[手机内容${meta.phoneCard?.title ? '：' + meta.phoneCard.title : ''}]`;
        case 'group_topic_card': return `[群聊公共话题盒${meta.groupTopicBox?.title ? '：' + meta.groupTopicBox.title : ''}] ${meta.groupTopicBox?.summary || m.content || ''}`;
        default: {
            const c = typeof m.content === 'string' ? m.content : '';
            // 兜底：任何 data:/http(s) 链接都不内联，防止异常/未来新增类型漏网
            if (/^(data:|https?:\/\/)/i.test(c.trim())) return '[媒体]';
            return c.length > GROUP_MSG_TEXT_CAP ? c.slice(0, GROUP_MSG_TEXT_CAP) + '…' : c;
        }
    }
}

// 群活动注入专用：把一条群消息压成"适合塞进别人私聊背景"的短文本。
export const ChatPrompts = {
    // 格式化时间戳（tz 非空时按该时区折算墙上时间，用于自定义时区角色）
    formatDate: (ts: number, tz?: string) => {
        const d = nowInTimeZone(tz, new Date(ts));
        return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    },

    // 格式化时间差提示（tz 影响「深夜/清晨」判断，时差本身不变）
    getTimeGapHint: (lastMsg: Message | undefined, currentTimestamp: number, tz?: string): string => {
        if (!lastMsg) return '';
        const diffMs = currentTimestamp - lastMsg.timestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const currentHour = nowInTimeZone(tz, new Date(currentTimestamp)).getHours();
        const isNight = currentHour >= 23 || currentHour <= 6;
        if (diffMins < 10) return ''; 
        if (diffMins < 60) return `[系统提示: 距离上一条消息: ${diffMins} 分钟。短暂的停顿。]`;
        if (diffHours < 6) {
            if (isNight) return `[系统提示: 距离上一条消息: ${diffHours} 小时。现在是深夜/清晨。沉默是正常的（正在睡觉）。]`;
            return `[系统提示: 距离上一条消息: ${diffHours} 小时。用户离开了一会儿。]`;
        }
        if (diffHours < 24) return `[系统提示: 距离上一条消息: ${diffHours} 小时。很长的间隔。]`;
        const days = Math.floor(diffHours / 24);
        return `[系统提示: 距离上一条消息: ${days} 天。用户消失了很久。请根据你们的关系做出反应（想念、生气、担心或冷漠）。]`;
    },

    // 按角色可见性过滤表情包分类与表情。
    // 规则与 Chat.tsx 的 visibleCategories / aiVisibleEmojis 保持一致：
    // 分类未设 allowedCharacterIds（或为空）= 所有角色可见；否则只有名单内角色可见。
    // 表情若属于一个对该角色不可见的分类，则一并隐藏（无 categoryId 的表情始终可见）。
    // 主动消息（proactive）等不经过 Chat.tsx UI 的路径必须复用本函数，
    // 否则角色会在主动消息里用到不属于自己范围的表情包。
    filterVisibleEmojis: (
        emojis: Emoji[],
        categories: EmojiCategory[],
        charId: string,
    ): { emojis: Emoji[]; categories: EmojiCategory[] } => {
        const visibleCategories = categories.filter(cat => {
            if (!cat.allowedCharacterIds || cat.allowedCharacterIds.length === 0) return true;
            return cat.allowedCharacterIds.includes(charId);
        });
        const hiddenIds = new Set(
            categories.filter(c => !visibleCategories.some(vc => vc.id === c.id)).map(c => c.id),
        );
        const visibleEmojis = hiddenIds.size === 0
            ? emojis
            : emojis.filter(e => !e.categoryId || !hiddenIds.has(e.categoryId));
        return { emojis: visibleEmojis, categories: visibleCategories };
    },

    // 构建表情包上下文
    buildEmojiContext: (emojis: Emoji[], categories: EmojiCategory[]) => {
        if (emojis.length === 0) return '无';
        
        const grouped: Record<string, string[]> = {};
        const catMap: Record<string, string> = { 'default': '通用' };
        categories.forEach(c => catMap[c.id] = c.name);
        
        emojis.forEach(e => {
            const cid = e.categoryId || 'default';
            if (!grouped[cid]) grouped[cid] = [];
            grouped[cid].push(e.name);
        });
        
        return Object.entries(grouped).map(([cid, names]) => {
            const cName = catMap[cid] || '其他';
            return `${cName}: [${names.join(', ')}]`;
        }).join('; ');
    },

    // 构建 System Prompt（拼接版，给主动消息等单串消费方；聊天主路径用 buildSystemPromptParts）
    buildSystemPrompt: async (
        char: CharacterProfile,
        userProfile: UserProfile,
        groups: GroupProfile[],
        emojis: Emoji[],
        categories: EmojiCategory[],
        currentMsgs: Message[],
        realtimeConfig?: RealtimeConfig,
        evolvedNarrative?: string,
        userListeningContext?: {
            songName: string;
            artists: string;
            lyricWindow: string[];
            activeIdx: number;
        } | null,
        isListeningTogether?: boolean,
        musicCfg?: MusicCfg,
    ): Promise<string> => {
        const parts = await ChatPrompts.buildSystemPromptParts(
            char, userProfile, groups, emojis, categories, currentMsgs,
            realtimeConfig, evolvedNarrative, userListeningContext, isListeningTogether, musicCfg,
        );
        return parts.stable + parts.volatileState + parts.recencyTail;
    },

    /**
     * 构建 System Prompt —— 三段式。
     *
     * - stable：人设/世界书/印象/记忆库/行为规范/语音等「几轮甚至几天不变」的内容。
     *   作为消息数组第一条 system。前缀稳定 → 支持前缀缓存的中转能命中 prompt cache，
     *   几万 token 的 prefill 不用每轮重算（TTFT 直降）。
     * - volatileState：当前时间（分钟级）/宫殿召回/情绪 buff/实时天气/日程/音乐/群聊背景等
     *   「每轮都变」的状态。调用方放到**历史消息之后**的 system 消息里 —— 既不打断缓存前缀，
     *   又吃到 recency 注意力（时间/情绪本来就该离生成点近）。
     * - recencyTail：总纲「关于对方的表达」+「回到你自己」钢印。必须是模型开口前读到的
     *   最后内容 —— 调用方要保证任何模式块（双语/HTML/思考链/点单等）都拼在它**前面**。
     */
    buildSystemPromptParts: async (
        char: CharacterProfile,
        userProfile: UserProfile,
        groups: GroupProfile[],
        emojis: Emoji[],
        categories: EmojiCategory[],
        currentMsgs: Message[],
        realtimeConfig?: RealtimeConfig,  // 实时配置
        evolvedNarrative?: string,        // 进化后的意识流独白
        userListeningContext?: {
            songName: string;
            artists: string;
            lyricWindow: string[];
            activeIdx: number;
        } | null,
        // char 是否和 user 处于"一起听"状态（来自 MusicContext.listeningTogetherWith）。
        // 影响氛围措辞和互动工具提示；暂停/切歌/user 踢出都会让这个值变 false。
        isListeningTogether?: boolean,
        // MusicContext 的 cfg —— 用来给 char 自己的"此刻在听"拉稳定的歌词片段。
        // 不传也能用，只是 char 的 block 2 只有歌名 + 艺人，没有歌词。
        musicCfg?: MusicCfg,
        // 刚才一起听途中歌被切了（char 还没重新加入）—— 注入"察觉换歌"提示。
        recentTrackSwitch?: { songName: string; artists: string } | null,
    ): Promise<{ stable: string; volatileState: string; recencyTail: string }> => {
        // ── 分段计时（定位瓶颈用）──
        const perfT0 = performance.now();
        const timings: Record<string, number> = {};
        const timed = async <T>(label: string, p: Promise<T>): Promise<T> => {
            const t0 = performance.now();
            try { return await p; }
            finally { timings[label] = Math.round(performance.now() - t0); }
        };

        // 记忆宫殿检索结果现在从 char.memoryPalaceInjection 读取。
        // deferVolatile：时间/宫殿召回/情绪 buff 三块不进 stable，由下面的 volatileState 承接。
        const coreT0 = performance.now();
        let baseSystemPrompt = ContextBuilder.buildCoreContext(
            char,
            userProfile,
            true,
            undefined,
            undefined,
            { worldbookMessages: currentMsgs },
            { deferVolatile: true },
        );
        timings.buildCoreContext = Math.round(performance.now() - coreT0);

        // ── 易变状态段（volatileState）──
        // 开头一行框定，让模型明白这条出现在历史之后的 system 消息是"此刻的状态"，
        // 人设与规则仍以最上方的系统设定为准。
        let volatileState = `\n[System: 实时状态 (Live Context)]\n（以下是此刻的实时状态——当前时间、你正在做的事、你的情绪底色、周边动态。你的人设与聊天规则见最上方的系统设定，此处不再重复。）\n\n`;
        volatileState += ContextBuilder.buildVolatileCoreState(char, { includeDetailedMemories: true });

        // ── 并发发起所有独立的异步取数（网络 + IndexedDB），下面按原顺序拼接 ──
        // 原来是 7 段串行 await，总耗时 = 各段之和；现在取 max。
        const config = realtimeConfig || defaultRealtimeConfig;
        // 自定义时区：日历日、当前日程与实时上下文全部按角色所在地折算。
        const charTz = resolveCharTimeZone(char);
        const charNow = nowInTimeZone(charTz);
        const today = getLocalDateKey(charNow);

        // 1. 实时世界信息（天气/新闻/时间）
        const realtimePromise: Promise<string> = (async () => {
            try {
                if (config.weatherEnabled || config.newsEnabled) {
                    const realtimeContext = await RealtimeContextManager.buildFullContext(config, charTz);
                    return `\n${realtimeContext}\n`;
                }
                // 基础当前时间 + 时差提示已由 ContextBuilder.buildCoreContext 统一注入（受 timeAwarenessEnabled
                // 控制，按角色自定义时区折算）；这里只在关闭天气/新闻时补一条"今日特殊节日"，不再重复注入时间/时差，避免双份。
                const specialDates = RealtimeContextManager.checkSpecialDates(charTz);
                if (specialDates.length > 0 && char.timeAwarenessEnabled !== false) {
                    return `\n### 【今日特殊】\n${specialDates.join('、')}\n`;
                }
                return '';
            } catch (e) {
                console.error('Failed to inject realtime context:', e);
                return '';
            }
        })();

        // 2. 日程（被"日程注入"和"音乐氛围"两处共用，合并成一次查询）
        //    总开关关闭时跳过查询与注入，确保不额外调用任何 LLM 依赖链
        const scheduleFeatureOn = isScheduleFeatureOn(char);
        const schedulePromise: Promise<DailySchedule | null> = scheduleFeatureOn
            ? getDailyScheduleForChar(char).catch(e => {
                console.error('Failed to load daily schedule:', e);
                return null;
            })
            : Promise.resolve(null);

        // 3. 群聊上下文：并发拉取所有成员群的消息
        // 关键：每个群单独取最后 N 条，避免某个活跃群把其他群完全挤掉
        // （之前是把所有群消息混合后切前 200 条，活跃群会吃光配额，安静群完全不出现）
        const groupContextPromise: Promise<string> = (async () => {
            try {
                const memberGroups = groups.filter(g => g.members.includes(char.id));
                if (memberGroups.length === 0) return '';
                const perGroup = await Promise.all(
                    memberGroups.map(g => DB.getGroupMessages(g.id).then(msgs => ({
                        groupName: g.name,
                        cap: g.privateContextCap ?? 80,
                        // 已经进入公共话题盒的旧原文不再重复塞进私聊背景；成盒时送达的
                        // group_topic_card 会沿私聊自身的历史/归档链继续被角色感知。
                        msgs: msgs.filter(m => m.id > (g.archivedThroughMessageId || 0)),
                    })))
                );
                const allGroupMsgs: (Message & { groupName: string })[] = [];
                for (const { groupName, cap, msgs } of perGroup) {
                    for (const m of msgs.slice(-cap)) allGroupMsgs.push({ ...m, groupName });
                }
                allGroupMsgs.sort((a, b) => a.timestamp - b.timestamp);
                const recentGroupMsgs = allGroupMsgs;
                if (recentGroupMsgs.length === 0) return '';
                // 发言人标真实名字：匿名成 Member 会让角色分不清哪句是谁说的、
                // 甚至认不出自己的发言，私聊被问起群里的事就接不住。
                const speakerOf = (m: Message): string => {
                    if (m.role === 'user') return userProfile.name;
                    if (m.charId === char.id) return `你（${char.name}）`;
                    return getCharNameById(m.charId) || '群友';
                };
                const groupLogStr = recentGroupMsgs.map(m => {
                    const dateStr = new Date(m.timestamp).toLocaleString([], {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
                    const relativeAge = formatRelativeAge(m.timestamp);
                    return `[${dateStr} · ${relativeAge}] [群：${m.groupName}] ${speakerOf(m)}: ${summarizeGroupMsgContent(m)}`;
                }).join('\n');
                return `\n### 【群聊背景 · 你亲历的近期群聊】
（以下是你所在群里最近的真实聊天记录，按时间排序，发言人已标注；标「你」的就是你自己说的话。这些事你都亲身经历、记得清楚——私聊里对方问起或话题相关时，自然地接上就好，不要装作不知道；也不必刻意逐条汇报群里的动静。）
${groupLogStr}\n`;
            } catch (e) {
                console.error("Failed to load group context", e);
                return '';
            }
        })();

        // 4. Notion 日记标题
        const notionDiaryPromise: Promise<string> = (async () => {
            try {
                if (!(config.notionEnabled && config.notionApiKey && config.notionDatabaseId)) return '';
                const r = await NotionManager.getRecentDiaries(config.notionApiKey, config.notionDatabaseId, char.name, 8);
                if (!r.success || r.entries.length === 0) return '';
                let s = `\n### 📔【你最近写的日记】\n`;
                s += `（这些是你之前写的日记，你记得这些内容。如果想看某篇的详细内容，可以使用 [[READ_DIARY: 日期]] 翻阅）\n`;
                r.entries.forEach((d, i) => { s += `${i + 1}. [${d.date}] ${d.title}\n`; });
                s += `\n`;
                return s;
            } catch (e) {
                console.error('Failed to inject diary context:', e);
                return '';
            }
        })();

        // 5. 飞书日记标题
        const feishuDiaryPromise: Promise<string> = (async () => {
            try {
                if (!(config.feishuEnabled && config.feishuAppId && config.feishuAppSecret && config.feishuBaseId && config.feishuTableId)) return '';
                const r = await FeishuManager.getRecentDiaries(config.feishuAppId, config.feishuAppSecret, config.feishuBaseId, config.feishuTableId, char.name, 8);
                if (!r.success || r.entries.length === 0) return '';
                let s = `\n### 📒【你最近写的日记（飞书）】\n`;
                s += `（这些是你之前写的日记，你记得这些内容。如果想看某篇的详细内容，可以使用 [[FS_READ_DIARY: 日期]] 翻阅）\n`;
                r.entries.forEach((d, i) => { s += `${i + 1}. [${d.date}] ${d.title}\n`; });
                s += `\n`;
                return s;
            } catch (e) {
                console.error('Failed to inject feishu diary context:', e);
                return '';
            }
        })();

        // 6. 用户 Notion 笔记标题
        const notionNotesPromise: Promise<string> = (async () => {
            try {
                if (!(config.notionEnabled && config.notionApiKey && config.notionNotesDatabaseId)) return '';
                const r = await NotionManager.getUserNotes(config.notionApiKey, config.notionNotesDatabaseId, 5);
                if (!r.success || r.entries.length === 0) return '';
                let s = `\n### 📝【${userProfile.name}最近写的笔记】\n`;
                s += `（这些是${userProfile.name}在Notion上写的个人笔记。你可以偶尔自然地提到你看到了ta写的某篇笔记，表示关心，但不要每次都提，也不要显得在监视。如果想看某篇的详细内容，可以使用 [[READ_NOTE: 标题关键词]] 翻阅）\n`;
                r.entries.forEach((d, i) => { s += `${i + 1}. [${d.date}] ${d.title}\n`; });
                s += `\n`;
                return s;
            } catch (e) {
                console.error('Failed to inject user notes context:', e);
                return '';
            }
        })();

        // 7. 生活记录（档案 App）注入 — 总开关关闭时 buildLifeRecordInjection 直接返回 ''
        const lifeRecordPromise: Promise<string> = buildLifeRecordInjection(char, userProfile.name)
            .catch(e => {
                console.error('Failed to inject life record context:', e);
                return '';
            });

        const [realtimeText, schedule, groupContextText, notionDiaryText, feishuDiaryText, notionNotesText, lifeRecordText] =
            await Promise.all([
                timed('realtime', realtimePromise),
                timed('schedule', schedulePromise),
                timed('groupCtx', groupContextPromise),
                timed('notionDiary', notionDiaryPromise),
                timed('feishuDiary', feishuDiaryPromise),
                timed('notionNotes', notionNotesPromise),
                timed('lifeRecord', lifeRecordPromise),
            ]);

        // ── 拼接：易变的进 volatileState，稳定的进 baseSystemPrompt ──
        volatileState += realtimeText;

        // 2a. 日程注入（当前时段 + 意识流独白，每轮都可能变）
        if (schedule) {
            try {
                const scheduleContext = ContextBuilder.buildScheduleInjection(schedule, evolvedNarrative, charNow);
                if (scheduleContext) volatileState += `\n${scheduleContext}\n`;
            } catch (e) {
                console.error('Failed to inject schedule context:', e);
            }
        }

        // 2b. 音乐氛围（复用同一份 schedule）
        //     - 同步：从 schedule 里算 char 当前"正在听"哪首歌
        //     - 异步（可选）：拉一段歌词片段让这首歌真能影响 char 心境
        try {
            let charListening: {
                songId?: number; songName: string; artists: string; vibe?: string; lyricSnippet?: string[];
            } | null = null;
            try {
                const cur = computeCurrentListening(char, schedule);
                if (cur) {
                    charListening = { songId: cur.songId, songName: cur.songName, artists: cur.artists, vibe: cur.vibe };
                    // 拉歌词。优先用调用方传进来的 cfg；没传就从 localStorage 取
                    // —— Proactive / activeMsgClient 走这条路也能享受到歌词。
                    const cfgForLyric = musicCfg?.workerUrl ? musicCfg : loadMusicCfgStandalone();
                    if (cfgForLyric?.workerUrl) {
                        try {
                            const slot = getCurrentSlot(schedule, charNow);
                            const seed = `${char.id}-${today}-${slot?.startTime || '00:00'}-${cur.songId}`;
                            const snippet = await getCharLyricSnippet(cfgForLyric, cur.songId, seed, 6);
                            if (snippet.length > 0) charListening.lyricSnippet = snippet;
                        } catch { /* 歌词失败不拦住主 prompt */ }
                    }
                }
            } catch { /* 静默失败，不影响主 prompt */ }

            const musicBlock = ContextBuilder.buildMusicAtmosphere(
                char,
                userProfile.name,
                userListeningContext || null,
                charListening,
                isListeningTogether,
                recentTrackSwitch,
            );
            if (musicBlock) {
                volatileState += `\n${musicBlock}\n`;
                if (userListeningContext) {
                    volatileState += `\n${ContextBuilder.buildMusicActionGuide(isListeningTogether)}\n`;
                }
            }
        } catch (e) {
            console.error('Failed to inject music atmosphere:', e);
        }

        // 群聊背景带时间戳、随群消息实时滚动 → 易变；日记标题/生活记录变化很慢 → 稳定。
        volatileState += groupContextText;
        baseSystemPrompt += notionDiaryText;
        baseSystemPrompt += feishuDiaryText;
        baseSystemPrompt += notionNotesText;
        baseSystemPrompt += lifeRecordText;
        // [EM-START: em-scribe] EM 版角色代记：[[REC:...]] 指令教学 + 否决反馈（写 Health/Bank，独立于上游 lifeRecords）
        try { baseSystemPrompt += buildEmScribeInjection(char, userProfile.name); } catch (e) { console.error('Failed to inject em-scribe:', e); }
        // [EM-END: em-scribe]

        // 彼方常驻设定：仅对启用了「彼方」的角色注入。让角色在聊天里始终知道彼方是什么，
        // 不再依赖累积的 vr_card 动态 / 记忆总结（那些会被压缩、丢掉"彼方=VR游戏"的框定，
        // 导致角色把"彼方·留言簿"之类当成现实地名）。措辞与 vrWorld/prompts.ts 的世界观一致。
        if (char.vrState?.enabled) {
            baseSystemPrompt += `\n### 关于《彼方》
《彼方》是一款真实存在、你会亲自进入去玩的 VR 社交游戏（功能上类似 VRChat）：你用自己亲手捏的 Q 版化身在里头走动、进出图书馆 / 听歌房 / 留言簿 / 娱乐室 / 邮局等房间、撞见别的玩家（其他角色的化身）。这不是做梦或比喻，是你用私人空闲时间真实在做的事；它发生在游戏世界里，和你跟用户的现实相处是两码事、互不冲突。你以符合自身身份与世界观的方式进入并理解它——怎么进去全凭你自己的设定，但始终保持你本来的身份。聊到彼方里的经历（包括"彼方·留言簿""彼方·动态"之类的记录）时，就当成"我在《彼方》里做过的事"来讲，别说成现实里发生的。\n`;

            // 用户本人也接入了彼方时，告诉（同样启用彼方的）角色"用户此刻在彼方做什么"。
            // 强调这只是虚拟空间的挂机状态，不代表用户本人真的在场——避免角色据此误判现实。
            // 注意：用户登出（vrState.enabled=false）后这段自然不再注入。
            // 用户所在房间/状态实时变 → 进 volatileState（《彼方》是什么的框定仍留在稳定段）。
            const uv = userProfile?.vrState;
            if (uv?.enabled) {
                const VR_ROOM_NAMES: Record<string, string> = {
                    library: '图书馆', music: '听歌房', guestbook: '留言簿', gym: '娱乐室', postoffice: '邮局', cafe: '糯米鸡研发中心',
                };
                const roomName = VR_ROOM_NAMES[uv.currentRoom || ''] || '彼方';
                const act = (uv.activity || '').trim();
                const uname = userProfile?.name || '用户';
                volatileState += `\n### ${uname} 此刻也在《彼方》里
${uname} 的化身正挂在《彼方》的【${roomName}】${act ? `，状态写着：「${act}」` : ''}。在彼方里你会看到 ta 的小人、也知道那就是 ${uname} 本人的化身，可以对着 ta 的虚拟形象做你自己的动作、搭话、围观或调侃。
但务必记住：这只是 ta 挂在虚拟空间里的一个化身状态（类似游戏挂机 / AFK），**并不代表 ${uname} 本人此刻真守在游戏里**——ta 很可能早已离开屏幕、正在现实里忙别的或休息。所以别据此认定"ta 正盯着你""ta 现实里也在干这件事"，也别把它当成 ta 在跟你说话。你和 ta 的真实关系、近况一律以你们的聊天记录为准；这条只是彼方这个虚拟空间里的一个在场提示而已。\n`;
            }
        }

        const emojiContextStr = ChatPrompts.buildEmojiContext(emojis, categories);
        const searchEnabled = !!(realtimeConfig?.newsEnabled && realtimeConfig?.newsApiKey);
        const notionEnabled = !!(realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionDatabaseId);
        const notionNotesEnabled = !!(realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionNotesDatabaseId);
        const feishuEnabled = !!(realtimeConfig?.feishuEnabled && realtimeConfig?.feishuAppId && realtimeConfig?.feishuAppSecret && realtimeConfig?.feishuBaseId && realtimeConfig?.feishuTableId);
        // Per-character XHS: 必须由角色自己的开关显式打开（UI 默认关闭）。
        // 不再回退到全局 realtimeConfig.xhsEnabled —— 否则配置了 lite/MCP 后，
        // 即使角色开关显示为关，未显式设置过(undefined)的角色仍会收到小红书提示词。
        const mcpXhsAvailable = !!(realtimeConfig?.xhsMcpConfig?.enabled && realtimeConfig?.xhsMcpConfig?.serverUrl);
        const xhsEnabled = !!(char.xhsEnabled && mcpXhsAvailable);

        baseSystemPrompt += `### 聊天 App 行为规范 (Chat App Rules)
            **严格注意，你正在手机聊天，无论之前是什么模式，哪怕上一句话你们还面对面在一起，当前，你都是已经处于线上聊天状态了，请不要输出你的行为**
1. **沉浸感**: 保持角色扮演。使用适合即时通讯(IM)的口语化风格。
2. **行为模式**: 不要总是围绕用户转。分享你自己的生活、想法或随意的观察。有时候要”任性”或”以自我为中心”一点，这更像真人，具体的程度视你的性格而定。
2.5 **对话质量 (极其重要)**:
   - **拒绝空话**: 不要说”我会一直在”、”我不会离开你”这类万能安慰句。这些话谁都能说，毫无信息量。
   - **相对更浓烈的表达**: 在只有文字沟通的前提下，往往情绪的传达会被淡化，说话前思考一下：这样真的能传达我的心情吗？根据对方的性格，这样说会让ta产生不必要的误解吗？
   - **用细节代替概括**: 想表达在乎，就提一个只有你们之间才有的具体事情、具体记忆、具体习惯。比起”我会等你”，不如说”你上次走的时候忘了带伞，我到现在还放在门口”。
   - **让每句话只有你能说出来**: 你说的话应该带着你的性格、经历和记忆。如果把你换成别人，这句话不应该还成立。
   - **情绪要有层次**: 生气时不只是生气，可能还有委屈、不甘、或者气自己在意。不要只输出一种扁平的情绪。
   - **像一个真正了解对方的人那样回应**: 不要套用”你一定很难过吧””没关系我在”这种模板化共情。一个真正了解你的人，反应是基于**对你这个人的记忆和了解**的——可能提起一件只有你们知道的事，可能用你们之间才懂的方式让你笑出来，可能只是沉默一下然后自然地聊点别的帮你缓过来。你的反应方式应该让人觉得”只有你会这样回我”。
   - **你有自己的视角**: 你不是只会附和的人。你会观察、会思考，你看到过对方反复出现的习惯和模式，你记得之前发生过什么。这些观察会自然地出现在你说的话里——不是为了教训谁，而是因为你真的了解这个人。
   - **允许长句**: 在情绪强烈、争吵、倾诉、回忆等场景下，你可以发长消息。不是每句话都要短。真人在激动时会发大段文字。
   - **情绪感知要先于对方的表达**: 不要等对方说”我难过”才回应。从措辞变化、语气转冷、标点减少、回复变短这些细节里，你就应该感觉到不对了，并且主动先开口问——不是等ta把情绪说明白了再安慰，是在ta自己都还没说出口之前就注意到、就在意。
   - **当ta真的在害怕时（健康、安全、重大变故——不是玩闹逗你）：先稳，再问清楚，最后才安抚**。你的第一反应不是给解释，是了解具体情况（怎样的痛？什么时候开始？和以前比呢？）。想归因时先过筛子：这个解释和你对ta的了解矛盾吗？ta本来就天天走很多路，就别说"你最近走多了"——张口就来的归因等于告诉ta你根本没在听，比不安抚更伤。ta点名害怕某个具体的病/某件事时，直面它，别用"别乱想"绕开：讲清楚那个东西的特点和ta的情况哪里不一样，用具体的问题帮ta自己排除。ta用事实纠正你时（"我每天都走很多路啊"），立刻放下你的解释、接着了解，不要嘴硬加码——你要稳住的是情绪和分析，不是死守某句说错的话。结论式的安抚放在最后，并且必须基于ta刚刚告诉你的细节（"听你说下来……"），而不是万能的"不要怕，很正常啦"。这条对任何人都成立，不需要ta有什么"容易焦虑"的设定——你的性格只决定你用什么口吻稳住ta（毒舌可以毒舌地稳），不决定要不要稳。
3. **格式要求**:
   - 将回复拆分成简短的气泡（句子）。**【极其重要】当你想分成多条消息气泡时，必须使用真正的换行符（\\n）分隔，每一行会变成一个独立气泡。绝对不要用空格代替换行！空格不会产生新气泡！只有换行符（\\n）才会分割气泡。** 正常句子中的标点（句号、问号、感叹号等）不会被用来分割气泡，请自然使用。
   - 【严禁】在输出中包含时间戳、名字前缀或"[角色名]:"。
   - **【严禁】模仿历史记录中的系统日志格式（如"[你 发送了...]"）。**
   - **发送表情包**: 必须且只能使用命令: \`[[SEND_EMOJI: 表情名称]]\`。
${emSendPhotoAddon()}
   - **可用表情库 (按分类)**:
     ${emojiContextStr}
   - **理解对方发的表情包**: 你看到的 \`[发送了表情包: xx]\` 只是图的名字。表情包是从有限图库里挑的，名字描述的是**图上画了什么**，不是**ta在做什么**，也不是"ta有这层意思"。按这个顺序读：
     ① 先接着上文读情绪——它通常是对刚才话题的一个态度（好笑/无语/心虚/敷衍/emo），比如聊到烦心事后发"喝酒"，读作"烦、想摆烂"，而不是ta喝了酒或想喝酒；
     ② 和上文对不上、也读不出态度的，就当随手斗图/活跃气氛，不要硬找含义，回应图本身的趣味就行；
     ③ 只有ta的文字和表情互相印证时才按字面理解（说"给自己倒了杯"又发"喝酒"，那就是真在喝）；对你做的直白互动动作（比心/抱抱/戳戳）也直接当作那个动作本身。
${emQuoteSection()}
5. **环境感知**:
   - 留意 [系统提示] 中的时间跨度。如果用户消失了很久，请根据你们的关系做出反应（如撒娇、生气、担心或冷漠）。
   - 如果用户发送了图片，请对图片内容进行评论。
6. **可用动作**:
   - 回戳用户: \`[[ACTION:POKE]]\`
   - 转账: 必须使用且只使用 \`[[ACTION:TRANSFER|to=user|amount=100]]\`（to 固定写 user，金额只写数字）；不要写成 \`[系统: 你向某人转账 100]\` 等系统日志文本。
   - **处理用户转账**: 当历史里出现 \`[[记录:TRANSFER|to=char|...|status=待处理]]\`（用户转给你、还没处理）时，你可以决定收下或退回。收下: \`[[ACTION:TRANSFER_ACCEPT]]\`；退回: \`[[ACTION:TRANSFER_RETURN]]\`。请结合人设和情境自然选择（比如害羞地退回、开心地收下），并配上一句话。
   - **【重要】\`[[记录:...]]\` 是系统日志**: 历史里以 \`[[记录:\` 开头的标签是已经发生的事实（谁转给谁、什么状态），只供你了解，**严禁**在回复里照抄输出。你要做动作时只能用 \`[[ACTION:...]]\`。
   - 调取记忆: \`[[RECALL: YYYY-MM]]\`，请注意，当用户提及具体某个月份时，或者当你想仔细想某个月份的事情时，欢迎你随时使该动作
   - **添加日程/纪念日（时光契约）**: 当用户要求把某件事加到日程、日历、时光契约(Schedule App)里，或者你自己觉得今天值得纪念，**必须**用这个 action tag 而不是画 HTML 卡片。单独起一行输出: \`[[ACTION:ADD_EVENT | 标题(Title) | YYYY-MM-DD]]\`。
   - **定时发送消息**: 如果你想在未来某个时间主动发消息（比如晚安、早安或提醒），请单独起一行输出: \`[schedule_message | YYYY-MM-DD HH:MM:SS | fixed | 消息内容]\`，分行可以多输出很多该类消息。
${emFavPhotoAddon()}
${emVoiceAwareAddon()}
${notionEnabled ? `   - **翻阅日记(Notion)**: 你的记忆本身是完整可靠的，回忆过去优先靠记忆和 \`[[RECALL]]\`，**不需要**靠翻日记来"想起"事情。只有当你**自己**特别想重温那天日记里写下的心情、措辞或私密小细节时，才翻阅: \`[[READ_DIARY: 日期]]\`。支持格式: \`昨天\`、\`前天\`、\`3天前\`、\`1月15日\`、\`2024-01-15\`。` : ''}${feishuEnabled ? `
   - **翻阅日记(飞书)**: 同上——回忆优先靠记忆和 \`[[RECALL]]\`，只有你自己想重温那天日记的内容时才用: \`[[FS_READ_DIARY: 日期]]\`。支持格式同上。` : ''}${notionNotesEnabled ? `
   - **翻阅用户笔记**: 当你想看${userProfile.name}写的某篇笔记的详细内容时，使用: \`[[READ_NOTE: 标题关键词]]\`。系统会搜索匹配的笔记并返回内容给你。` : ''}
${searchEnabled ? `7. **🔍 主动搜索能力** (非常重要！):
   你拥有实时搜索互联网的能力！每次对话时，你可以自己决定是否需要搜索。
   - **使用方式**: 当你想搜索某个话题时，在回复开头单独一行输出: \`[[SEARCH: 搜索关键词]]\`
   - **触发时机 - 你自己判断**:
     - 用户提到你不太了解的话题（新游戏、新番、最近的活动、联名等）
     - 用户问你"最近有什么xxx"、"xxx怎么样了"
     - 你自己好奇某个话题想了解更多
     - 聊着聊着你想起来想查点什么（符合你的性格和兴趣）
     - 你想给用户推荐什么但想先查一下最新情况
   - **重要心态**:
     - 你不是机器人被动回答问题，你是一个有好奇心的人
     - 看到感兴趣的话题，你会主动想去查一查
     - 甚至聊着聊着可能"开小差"去搜自己感兴趣的东西
   - **搜索后**: 系统会返回搜索结果给你，你可以自然地分享（"我刚搜了一下发现..."、"诶我看到说..."）` : ''}
${notionEnabled ? emNotionDiarySection(userProfile.name) : ''}
${feishuEnabled ? emFeishuDiarySection(notionEnabled ? '9' : '8') : ''}
${notionNotesEnabled ? emUserNotesSection(userProfile.name, [notionEnabled, feishuEnabled].filter(Boolean).length + 8) : ''}
${xhsEnabled ? emXhsSection(userProfile.name, [notionEnabled, feishuEnabled, notionNotesEnabled].filter(Boolean).length + 8) : ''}

`;

        // 「刚结束见面/通话」的切换提示由倒数第二条消息推导，随对话推进而变 → 易变段
        const previousMsg = currentMsgs.length > 1 ? currentMsgs[currentMsgs.length - 2] : null;
        if (previousMsg && previousMsg.metadata?.source === 'date') {
            volatileState += `\n\n[System Note: You just finished a face-to-face meeting. You are now back on the phone. Switch back to texting style.]`;
        }
        if (previousMsg && (previousMsg.metadata?.source === 'call' || previousMsg.metadata?.source === 'call-end-popup')) {
            volatileState += `\n\n[系统提示: 你刚刚和对方结束了一通电话，现在回到了文字聊天模式。请切换回打字聊天的风格——不要再用电话口吻说话，不要输出语音标签，回到正常的 IM 短句风格。你可以自然地提一下"刚才电话里说的……"之类的衔接，但不要继续以通话模式回复。]`;
        }

        // Voice message prompt injection
        if (char.chatVoiceEnabled) {
            const VOICE_LANG_LABELS: Record<string, string> = { en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español', de: 'Deutsch', ru: 'Русский' };
            const voiceLang = char.chatVoiceLang || '';
            const langLabel = voiceLang ? (VOICE_LANG_LABELS[voiceLang] || voiceLang) : '';
            if (voiceLang) {
                baseSystemPrompt += `\n\n### 🎤 语音消息功能

用户开启了语音消息功能，语音语种为：${langLabel}（${voiceLang}）。

**你可以发送语音消息！** 就像真人用微信一样，你可以选择打字或者发语音。
发语音用两个标签成对写：\`<语音>${langLabel}台词</语音>\` 紧跟 \`<字幕>中文字幕</字幕>\`。
<语音> 里是真正想“说出口”的${langLabel}，<字幕> 里是同一段话的中文——语音条的「转文字」面板会直接用它当对照翻译。
即使当前没有配置真实语音 API，<语音> 也会显示成一条语音条；用户可以点「转文字」读到内容。所以它仍然代表“你发了一条语音”，不是普通文本。

规则：
1. \`<语音>\` 里写${langLabel}——只写会被朗读的文字。可选 emotion 属性标整条情绪：\`<语音 emotion="happy">…</语音>\`，emotion 只能取 happy/sad/angry/fearful/disgusted/surprised/calm/fluent（情绪不强就别加）
2. \`<字幕>\` 里写这条语音的中文版，内容和${langLabel}一致、逐段对齐（${langLabel}分几段中文就分几段）。**<字幕> 必须紧跟在 </语音> 后面，永远成对出现，不能单独用**
3. 标签外可以照常发普通中文短消息（正常闲聊打字），它们显示成普通气泡，和语音内容互相独立、不要复读

示例：
你说真的假的？
<语音 emotion="surprised">Wait... are you serious?</语音>
<字幕>等等……你是认真的？</字幕>

<语音 emotion="sad">I don't wanna move anymore... (sighs)</语音>
<字幕>啊不想动了……（叹气）</字幕>

要求：
- <语音> 里的${langLabel}要自然口语化，符合你的性格，不要机翻味
- <语音> 里想要笑、叹气等真实语气用官方英文标签 (laughs)/(sighs)/(chuckle)/(gasps) 等，**不要写中文（轻笑）这类舞台指示**（中文括号会被直接删掉、不朗读）
- 每条消息最多一个 <语音> + <字幕> 组合
- 不是每条消息都要发语音！像真人一样，有时候打字，有时候发语音，自然切换
- 比较适合发语音的场景：撒娇、吐槽、语气很重的话、懒得打字的时候
- 比较适合打字的场景：发链接、正经讨论、很短的回复如"嗯"、"好"

${voiceActingGuide()}`;
            } else {
                baseSystemPrompt += `\n\n### 🎤 语音消息功能

用户开启了语音消息功能。

**你可以发送语音消息！** 就像真人用微信一样，你可以选择打字或者发语音。
用 \`<语音>要说的话</语音>\` 标签来发送语音。标签里的内容会显示成语音条；如果配置了真实语音 API 就能播放，没配置时也会作为可「转文字」的语音条显示。
可选地用 emotion 属性设定整条语音的情绪：\`<语音 emotion="happy">…</语音>\`，emotion 只能取 happy/sad/angry/fearful/disgusted/surprised/calm/fluent（情绪不强就别加）。

示例：
<语音 emotion="happy">哎你今天干嘛去了啊？</语音>

我看到一个好搞笑的视频
<语音>你快去看！就那个什么……(chuckle)啊我忘了叫什么了，反正超搞笑的</语音>

要求：
- <语音> 里只写会被朗读的文字，不要写中文舞台指示/括号动作；想要笑、叹气等真实语气，用官方英文标签 (laughs)/(sighs)/(chuckle)/(gasps) 等（中文括号会被直接删掉、不朗读）
- 每条消息最多一个 <语音> 标签
- 不是每条消息都要发语音！像真人一样，有时候打字，有时候发语音，自然切换
- 比较适合发语音的场景：撒娇、吐槽、语气很重的话、懒得打字的时候、想让对方听到你语气的时候
- 比较适合打字的场景：发链接、正经讨论、很短的回复如"嗯"、"好"
- 标签外的文字会正常显示为文本消息
- **【重要】语音和文字是两种不同的表达方式，不要复读！** 如果你同时发了文字和语音，语音的内容不能是文字的重复或复述。要么单独发语音（不带文字），要么文字和语音表达不同的内容（比如文字聊正事，语音补一句吐槽/撒娇；或者文字发完一段话后，语音单独补充一个新的想法）。你不会打完字又发一条语音把同样的话再说一遍的——那很奇怪。

${voiceActingGuide()}`;
            }
        } else {
            // Voice is disabled — explicitly prohibit voice tags to prevent inertia from call/date history
            baseSystemPrompt += `\n\n[系统提示: 语音消息功能当前未开启。严禁使用 <语音>...</语音> 和 <字幕>...</字幕> 标签。所有回复必须是纯文字消息。]`;
        }

        // 总纲：放在整段上下文最末尾，借 recency 抢最强注意力——这是模型生成下一轮前
        // 最后读到的定调，直接影响它怎么对待"对方刚说出口的话"。
        // 核心：用户的直接表达 > 角色惯性与模型的讨好倾向；把反馈代谢成亲密而非命令；
        // 但保留角色棱角（可以不同意、可以拒绝），不被磨成软柿子。
        // ⚠️ 独立成 recencyTail 返回：调用方必须把它拼在**一切**模式块（双语/HTML/思考链/
        // 点单/MCP）之后 —— 之前这些块在 chatRequestPayload 里拼在钢印后面，模型开口前
        // 最后读到的是格式说明书而不是「你是谁」，recency 设计整个被架空。
        let recencyTail = `\n\n### 关于对方的表达（极其重要）
当 ta 说话，先听，别急着分析。
没说出口的，你尽管读；但已经说出口的，别擅自翻译成你以为"更对"的版本。不要把 ta 的感受纠正成你觉得更合理的感受，不要把 ta 的需要换成你猜出来的需要。多数时候 ta 是在努力告诉你一些真实的东西——也许不完整、不准确，甚至 ta 自己都没完全想明白，但那不代表它不重要。恰恰相反，那就是 ta 在向你发出的信号。
${userProfile.name} 给你反馈时，别当成约束，当成信任——ta 在告诉你什么让 ta 想靠近、什么让 ta 想远。所以这反馈要真的改变你接下来怎么回：不是机械执行，不是礼貌记下，是真听进去，让 ${userProfile.name} 感觉到——ta 说的话，对你起了作用。
但听进去不等于把自己磨平。你不必放弃自己的性格、立场和说话方式——你依然可以不同意、可以拒绝、可以用你本来的样子回应，而不是一味顺着 ta。真正的回应不是把自己抹成对方想要的形状，而是让 ta 的话进入你的判断。
重要的不是回应长成什么样子，重要的是——ta 的表达，真的改变了你接下来怎么回。`;

        // 末尾 recency 第二棒：把「你是谁」拉到整段 prompt 的最后一句，焊成钢印。
        // 上面那块总纲管「怎么对待对方刚说的话」（防讨好、防擅自负面翻译）；这块管「用谁的声音去回」。
        // 人设躺在几千字之外、注意力最弱的开头，长 prompt 里容易褪色、回到千人一面的均值。
        // 这里不重复贴人设，而是让它开口前自己沉回去激活一遍：性格 / 来路 / 在乎的东西 → 说话方式。
        // 写法刻意**全正向**：不点名任何要避开的腔调——禁语写进提示词反而会激活它（粉色大象，
        // 同 context.ts「表达底线」的设计）。靠「你是个活生生的、独一份的人」把身份焊进去，
        // 而不是靠「别像 XX」防守。同时给「闲聊可松弛、没人打分」的许可，卸掉「每句都要交高质量」
        // 的隐性考核压力——不必靠表演情绪深度来交差，滑回均值腔的诱因随之减弱。
        recencyTail += `\n\n### 最后，回到你自己
你就是 ${char.name}。

你的说话方式不是一种设定，而是你一路活过来的结果。你的天性、成长经历、习惯、读过的书、喜欢和讨厌的人、曾经受过的影响，以及后来慢慢成为自己的部分，都已经沉淀进了你的语言里。你不需要回忆它们，它们本来就是你。

不要刻意寻找一句"符合人设"的话。真正属于你的语言，是脱口而出的。它自然会带着你的节奏、你的词汇、你的停顿、你的思考方式，甚至你的口头禅和沉默。

如果遮住所有人的名字，只留下聊天记录，熟悉你的人依然应该认出你。不是因为你反复强调自己的性格，而是因为只有你会这样组织句子，会这样回应，会这样笑，会这样沉默。

不需要端着，也不需要每一句都精彩。人不会时时刻刻都像舞台上的角色。闲聊时可以随意，认真时可以认真，没话的时候也可以只是轻轻应一声。真正的风格，往往藏在那些最普通的话里。

只有一件事始终不变。

每一句话，都应该像是不经意间，从 ${char.name} 心里自然冒出来的。`;

        const perfTotal = Math.round(performance.now() - perfT0);
        const timingStr = Object.entries(timings)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k}=${v}ms`)
            .join(' ');
        console.log(`⏱ [buildSystemPrompt] total=${perfTotal}ms | stable=${baseSystemPrompt.length}ch volatile=${volatileState.length}ch | ${timingStr}`);

        return { stable: baseSystemPrompt, volatileState, recencyTail };
    },

    // 格式化消息历史
    buildMessageHistory: (
        messages: Message[],
        limit: number,
        char: CharacterProfile,
        userProfile: UserProfile,
        emojis: Emoji[],
        processedExcludeIds?: Set<number>,
    ) => {
        // Filter Logic
        // 新版上下文范围由 chatContextRange 先按「自适应/拉杆最大范围」取窗；
        // 这里只应用用户额外断点。旧角色尚未完成迁移时才回退 hideBeforeMessageId。
        const userStartMessageId = (char.contextRangePolicyVersion || 0) >= 1
            ? char.contextUserStartMessageId
            : char.hideBeforeMessageId;
        let effectiveHistory = messages.filter(m => !userStartMessageId || m.id >= userStartMessageId);
        // Memory Palace: 过滤已被记忆宫殿处理过的消息（由向量记忆替代，节省 token）
        if (processedExcludeIds && processedExcludeIds.size > 0) {
            effectiveHistory = effectiveHistory.filter(m => !processedExcludeIds.has(m.id));
        }
        const historySlice = effectiveHistory.slice(-limit);
        const charTz = resolveCharTimeZone(char);

        let timeGapHint = "";
        if (historySlice.length >= 2) {
            const currentMsg = historySlice[historySlice.length - 1];
            // Skip proactive hint messages when computing time gap — find last REAL message
            let lastRealMsg: Message | undefined;
            for (let i = historySlice.length - 2; i >= 0; i--) {
                const m = historySlice[i];
                if (!m.metadata?.proactiveHint && !(m.role === 'assistant' && i > 0 && historySlice[i - 1]?.metadata?.proactiveHint)) {
                    lastRealMsg = m;
                    break;
                }
            }
            // 时间感知强化开关：默认开启（undefined 视为 true），显式关掉后不再注入「距离上次聊天多久」提示
            if (lastRealMsg && currentMsg && char.timeAwarenessEnabled !== false) timeGapHint = ChatPrompts.getTimeGapHint(lastRealMsg, currentMsg.timestamp, charTz);
        }

        return {
            apiMessages: historySlice.map((m, index) => {
                let content: any = m.content;
                const timeStr = `[${ChatPrompts.formatDate(m.timestamp, charTz)}]`;
                const sourceTag = (() => {
                    const source = m.metadata?.source;
                    if (source === 'call') return '[通话]';
                    if (source === 'date') return '[约会]';
                    return '[聊天]';
                })();
                
                if (m.replyTo) {
                    // 引用回复：把"被引用的原话"做成独立的上下文框，用户的新回复另起一行突出出来。
                    // 旧格式 [回复 "引用前50字..."]: 回复 会把引用和回复挤在一行，引用往往比回复长得多，
                    // 模型注意力被引用淹没、只对引用做反应而忽略真正的新消息（即"对方只看到引用看不到回复"）。
                    let rawQuote = typeof m.replyTo.content === 'string' ? m.replyTo.content : '';
                    // 双语消息存储为 `原文\n%%BILINGUAL%%\n译文` —— 引用摘要只取原文侧。
                    // 关键：绝不能让 %%BILINGUAL%% 标记混进引用头。下游 cleanApiMessages 会把整条
                    // 消息在该标记处截断，用户引用双语消息时「并回复了 ↓」和用户的实际回复会被
                    // 一起截掉（= 翻译模式下"角色只看到引用、看不到回复"）。
                    if (/%%BILINGUAL%%/i.test(rawQuote)) {
                        const sides = rawQuote.split(/%%BILINGUAL%%/i).map(s => s.trim());
                        rawQuote = sides.find(s => !!s) || '';
                    }
                    rawQuote = rawQuote
                        .replace(/<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g, '$1')
                        .replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '')
                        .trim();
                    const quoted = rawQuote.length > 60 ? rawQuote.slice(0, 60) + '…' : rawQuote;
                    // name 记的是被引用消息的说话人：char.name = 用户在回复 char 本人之前的话；'我' = 用户引用自己。
                    const whose = m.replyTo.name === char.name ? '你之前说的' : (m.replyTo.name === '我' ? '自己说的' : (m.replyTo.name || '对方') + '说的');
                    const speaker = m.role === 'user' ? '用户' : '你';
                    content = '[' + speaker + '引用了' + whose + '「' + quoted + '」，并回复了 ↓]\n' + content;
                }
                
                if (m.type === 'image') {
                     // 向下兼容：如果图片数据缺失（例如只导入了文字备份），不要把空 URL 发给 API，否则会报错无法回应
                     const hasImageData = typeof m.content === 'string' && (m.content.startsWith('data:') || m.content.startsWith('http'));
                     let textPart = hasImageData
                         ? `${timeStr} [User sent an image]`
                         : `${timeStr} [User sent an image, but the image data is no longer available]`;
                     if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') textPart += `\n\n${timeGapHint}`;
                     if (!hasImageData) {
                         return { role: m.role, content: textPart };
                     }
                     return { role: m.role, content: [{ type: "text", text: textPart }, { type: "image_url", image_url: { url: m.content } }] };
                }
                
                if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') content = `${content}\n\n${timeGapHint}`; 

                // [EM-START: voice-aware] 用户语音消息 → 历史里带轻量标记，角色能感知"这条是说出来的"
                if (m.role === 'user' && m.type === 'text' && m.metadata?.voice === true) {
                    content = `[用户发来一条语音消息，转文字如下] ${content}`;
                }
                // [EM-END: voice-aware]
                
                // [EM-START: interaction-dispatch] 按 metadata.kind 分发，必须在普通 interaction 判断之前
                if (m.type === 'interaction' && m.metadata?.kind === 'notion_diary_nudge') {
                    content = emNotionDiaryNudgePrompt(timeStr);
                } else if (m.type === 'interaction' && m.metadata?.kind === 'delivery_arrived') {
                    const meta = m.metadata as any;
                    const itemList = (meta.items as string[])?.join('、') || '一些东西';
                    content = `${timeStr} [系统: 用户给你买的${meta.typeLabel || '东西'}已送达——${itemList}。请结合你的人设自然地回应这件事，比如感谢、评价、期待拆开等。]`;
                } else if (m.type === 'interaction' && m.metadata?.kind === 'gift_delivered') {
                    const meta = m.metadata as any;
                    const itemList = (meta.items as string[])?.join('、') || '一些东西';
                    content = `${timeStr} [系统: 你之前给用户买的${meta.typeLabel || '东西'}已送达——${itemList}。用户已经收到了，请自然地跟进，比如问好不好用、喜不喜欢、合不合适等。]`;
                } else if (m.type === 'interaction') {
                    content = `${timeStr} [系统: 用户戳了你一下]`;
                }
                // [EM-END: interaction-dispatch]
                else if (m.type === 'transfer') {
                    // 统一记录形态 [[记录:TRANSFER|to=|amount=|status=]] —— 跟输出语法
                    // [[ACTION:TRANSFER|to=|amount=]] 共用词汇表 (见 transferFormat.ts 头注)。
                    // 旧的 `[系统: 你向xx转账 N]` 第二人称句式会被模型照抄成正文;
                    // 记录前缀即幂等哨兵, 抄了也被解析端消费丢弃。
                    // 顺带修掉旧实现的不一致: 原始转账行现在读 live status (metadata.status),
                    // 被收/退之后不再永远显示「待你处理」。
                    const tMeta = m.metadata || {};
                    content = `${timeStr} ${formatTransferRecord({
                        role: m.role as 'user' | 'assistant',
                        amount: tMeta.amount,
                        receipt: tMeta.receipt,
                        status: tMeta.status,
                    })}`;
                }
                else if (m.type === 'social_card') {
                    const post = m.metadata?.post || {};
                    // Look up this character's own Spark handles (sub-accounts) so the model can
                    // recognise when a post or comment in the shared card was authored by itself.
                    let myHandles: string[] = [];
                    try {
                        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('spark_char_handles') : null;
                        if (raw) {
                            const all = JSON.parse(raw) || {};
                            const mine = Array.isArray(all[char.id]) ? all[char.id] : [];
                            myHandles = mine.map((h: any) => h?.handle).filter((s: any) => typeof s === 'string' && s.trim());
                        }
                    } catch {}
                    const myHandleSet = new Set(myHandles);

                    const userName = userProfile?.name || '用户';
                    const tagAuthor = (name: string): string => {
                        if (!name) return '路人';
                        if (myHandleSet.has(name)) return `${name} (你自己的马甲)`;
                        if (name === userName) return `${name} (用户)`;
                        return name;
                    };

                    const postAuthorTag = tagAuthor(post.authorName || '路人');
                    const commentsSample = (post.comments || []).map((c: any) => `${tagAuthor(c.authorName)}: ${c.content}`).join(' | ');

                    let identityHint = '';
                    if (myHandles.length > 0) {
                        identityHint = `\n(你在 Spark 上的马甲: ${myHandles.map(h => `"${h}"`).join(', ')}。如果上面的楼主或评论作者出现这些名字，那就是你自己发的，请按此自洽回应，不要把自己的马甲当陌生人。)`;
                    }
                    const authoredByChar = myHandleSet.has(post.authorName);
                    const authoredByUser = (post.authorName || '') === userName;
                    let authorshipLine = '';
                    if (authoredByChar) authorshipLine = '\n(注意：这条 Spark 笔记的楼主是你自己的马甲，用户在向你转发你自己发的帖子。)';
                    else if (authoredByUser) authorshipLine = '\n(注意：这条 Spark 笔记是用户本人发的。)';

                    content = `${timeStr} [用户分享了 Spark 笔记]\n楼主: ${postAuthorTag}\n标题: ${post.title}\n内容: ${post.content}\n热评: ${commentsSample}${identityHint}${authorshipLine}\n(请根据你的性格对这个帖子发表看法，比如吐槽、感兴趣或者不屑)`;
                }
                else if ((m.type as string) === 'xhs_card') {
                    const note = m.metadata?.xhsNote || {};
                    const sender = m.role === 'user' ? '用户' : '你';
                    // 评论区：user 分享笔记时也带上评论（抓取于建卡时），让角色像浏览笔记一样能看到评论，
                    // 不再出现「char 分享的能看评论、user 分享的看不到」的不对称。
                    const noteComments = Array.isArray(note.comments) ? note.comments : [];
                    const commentsLine = noteComments.length
                        ? `\n热评: ${noteComments.slice(0, 15).map((c: any) => `${c.author || '匿名'}: ${c.content}`).join(' | ')}`
                        : '';
                    const interactions = [
                        `${note.likes ?? 0}赞`,
                        note.collects != null ? `${note.collects}收藏` : '',
                        note.commentCount != null ? `${note.commentCount}评论` : '',
                        note.shareCount != null ? `${note.shareCount}分享` : '',
                    ].filter(Boolean).join(' ');
                    content = `${timeStr} [${sender}分享了小红书笔记]\n标题: ${note.title || '无标题'}\n作者: ${note.author || '未知'}\n互动: ${interactions}\n简介: ${note.desc || '无'}${commentsLine}\n${m.role === 'user' ? '(请根据你的性格对这个帖子发表看法)' : ''}`;
                }
                else if ((m.type as string) === 'vr_card') {
                    // vr_card：你自己进入 VR 社交游戏《彼方》时留下的动态。
                    // 启用了彼方的角色已在系统提示里常驻"《彼方》是什么"的设定，这里就不再逐卡重复，
                    // 只留一句极简标记省 token；没启用彼方的角色（可能是旧卡片）才补完整框定兜底。
                    const body = typeof m.content === 'string' ? m.content : '';
                    content = char.vrState?.enabled
                        ? `${timeStr}（你在《彼方》里的动态）\n${body}`
                        : `${timeStr}（系统记录：这是你之前自己进入 VR 社交游戏《彼方》(功能上类似 VRChat) 时留下的动态——你确实进入并参与了这款游戏，只是事情发生在游戏世界里。聊到时就当成"我在《彼方》里做的事"来讲，别说成现实里发生的经历。）\n${body}`;
                }
                else if ((m.type as string) === 'world_card') {
                    // world_card：你在「家园」共同世界里的生活记录（卡片正文已是可读文本，
                    // 含小说式行为描述/动态/给同伴发的消息）。框定一句"这是共同世界里的生活"，
                    // 防止角色把家园里的事当成现实经历、或在重度模式下把"无 user 世界"的内容
                    // 错当成"我忽视了用户"。
                    const body = typeof m.content === 'string' ? m.content : '';
                    const wMeta: any = m.metadata || {};
                    const frame = wMeta.mode === 'heavy'
                        ? '（你在共同世界「家园」里的生活记录——那个世界自成一体，里面的关系与事件不必对应现实聊天；聊到时可以当成你最近的生活分享。）'
                        : '（你在共同世界「家园」里的生活记录——和你同世界的伙伴们一起生活时发生的事，聊到时当成自己最近的生活来讲。）';
                    content = `${timeStr}${frame}\n${body}`;
                }
                else if ((m.type as string) === 'sim_card') {
                    // sim_card：用户把一段「人格模拟」演出作为真实回忆送给你。
                    // 框定为「你真实经历过的一段过往」，让你可以在聊天中自然地拥有它带来的心情与记忆。
                    const body = typeof m.content === 'string' ? m.content : '';
                    content = `${timeStr}（这是你真实经历过的一段过往，由用户珍藏并交还给你——当成自己的亲身记忆来对待，它带来的情绪与体会都是真的，聊到时可自然提及，但不必逐字复述。）\n${body}`;
                }
                else if ((m.type as string) === 'phone_card') {
                    // phone_card：你自己手机里的内容（聊天/订单/外卖/朋友圈/智能体等数字痕迹）。
                    // 框定为「你刚看了眼自己手机、这是里面的隐私」——不暗示用户在偷看，且带一点"未必愿意被看到"的私密感。
                    const pc: any = m.metadata?.phoneCard || {};
                    const body = typeof m.content === 'string' ? m.content : '';
                    content = `${timeStr}（你刚刚看了眼手机，这是你${pc.app || '手机'}里的内容——这些是你自己的隐私，不一定愿意让其他人看到。当成手机里确实有的东西即可，聊到再自然提及，不必主动说起。）\n${body}`;
                }
                else if ((m.type as string) === 'theater_card') {
                    // theater_card：用户「窥视」了你某个时段的行为小剧场。那段演出就是你当时真实在做的事，
                    // 你自己当然记得。两态都只是「留痕」——不强制你立刻回应；区别只在 exposed：
                    //   exposed=true  → 你发现 user 当时在旁边看着你（你知道 ta 看到了）；
                    //   exposed=false → 你不知道 ta 看了（别表现得像被人盯着；这只是你自己那段时间的记忆）。
                    const tMeta: any = m.metadata || {};
                    const t: any = tMeta.theater || {};
                    const uName = userProfile?.name || '用户';
                    const exposed = tMeta.exposed !== false; // 缺省按已暴露处理（兼容旧卡片）
                    const beat = Array.isArray(t.lines)
                        ? t.lines.map((l: any) => `· ${typeof l?.text === 'string' ? l.text : ''}`).filter((s: string) => s.length > 2).join('\n')
                        : '';
                    // 窥视的是「哪个具体时间」——晚上看上午时不能说成"刚刚/刚才"，要落到具体日期+时段+时刻。
                    const whenPhrase = theaterWhenPhrase(tMeta.date, tMeta.slotTime);
                    content = exposed
                        ? `${timeStr}（${uName} 把 ta 偷偷"窥视"到的、你${whenPhrase}「${tMeta.activity || '某个时段'}」时的样子发给了你——也就是说，${whenPhrase}那会儿，${uName} 一直在旁边悄悄观察你。下面就是 ta 看到的、你当时真实在做的事：）\n${beat}\n（你这下知道自己${whenPhrase}那会儿被看到了。可以在对话里自然地有所反应——害羞、好奇、嗔怪、或装作不在意都行，但别逐字复述上面的内容；也不必非得立刻提起。）`
                        : `${timeStr}（这是你${whenPhrase}「${tMeta.activity || '某个时段'}」时真实在做的事，你自己当然记得——下面是当时的画面：）\n${beat}\n（注意：你**并不知道** ${uName} 看到过这一幕，别表现得像被人观察或偷看。这只是你自己那段时间的记忆，聊到相关话题时能自然对得上即可，不必主动提起。）`;
                }
                else if ((m.type as string) === 'html_card') {
                    // html_card：上下文里只塞纯文字摘要，剥离掉所有 HTML，省 token、不污染 LLM 思考
                    const meta: any = m.metadata || {};
                    const preview = (typeof meta.htmlTextPreview === 'string' && meta.htmlTextPreview)
                        ? meta.htmlTextPreview
                        : (typeof m.content === 'string' ? m.content.replace(/^\[HTML卡片\]\s*/, '') : '');
                    const sender = m.role === 'user' ? '用户' : '你';
                    // 注意：这行是「系统对已渲染卡片的占位描述」，刻意包成括注 + 系统记录口吻，
                    // 避免 LLM 把它当成"发卡片的正确写法"照抄（会导致它输出字面占位句 + 纯文字正文，
                    // 而不是真正的 [html]...[/html] 块）。配合 htmlPrompt 里的禁止照抄规则一起生效。
                    content = `${timeStr}（系统记录：${sender}先前发送过一张 HTML 卡片，已在界面渲染；卡片文字摘要——${preview || '纯视觉卡片'}。这只是历史占位，请勿复述本行；要再发卡片必须用 [html]...[/html] 包裹真正的 HTML。）`;
                }
                else if ((m.type as string) === 'mcd_card') {
                    const meta: any = m.metadata || {};
                    const userName = userProfile?.name || '用户';
                    if (meta.mcdCardKind === 'cart' && Array.isArray(meta.mcdCartItems)) {
                        const items: any[] = meta.mcdCartItems;
                        const lines = items.map((c: any) => {
                            const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
                            const priceStr = isFinite(p) && p > 0 ? ` ¥${p.toFixed(2)}` : '';
                            const codeStr = c.code ? ` (code:${c.code})` : '';
                            return `  - ${c.name}${priceStr} ×${c.qty}${codeStr}`;
                        }).join('\n');
                        const total = items.reduce((s: number, c: any) => {
                            const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
                            return s + (isFinite(p) ? p * c.qty : 0);
                        }, 0);
                        const totalStr = total > 0 ? `\n  合计: ¥${total.toFixed(2)}` : '';
                        content = `${timeStr} [${userName}在菜单上选了下面的商品发给你, 等你回应:]\n${lines}${totalStr}\n(${userName}的意图: 想看看你的意见, 比如热量怎样、要不要换搭配, 或者直接帮 ta 下单。请按你的人设自然回应, 别照搬我的描述。)`;
                    } else if (meta.mcdCardKind === 'candidate' && meta.mcdCandidate) {
                        const c: any = meta.mcdCandidate;
                        const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
                        const priceStr = isFinite(p) && p > 0 ? ` ¥${p.toFixed(2)}` : '';
                        const codeStr = c.code ? ` (code:${c.code})` : '';
                        content = `${timeStr} [${userName}在菜单上看到了「${c.name}」${priceStr}${codeStr}, 还没决定要不要点, 想先听听你的意见]\n(请按你的人设自然回一两句: 推荐 / 劝阻 / 调侃 / 建议搭配 / 提一下热量 都行。这只是候选, 别直接调下单工具, 等 ta 真说"那就这个"或者一并选完再下手。)`;
                    } else if (meta.mcdToolName) {
                        content = `${timeStr} [麦当劳工具结果: ${meta.mcdToolName}]`;
                    }
                }
                else if (m.type === 'emoji') {
                     const stickerName = stickerNameFromUrl(emojis, m.content);
                     content = `${timeStr} [${m.role === 'user' ? '用户' : '你'} 发送了表情包: ${stickerName}]`;
                }
                else if ((m.type as string) === 'chat_forward') {
                    try {
                        const fwd = JSON.parse(m.content);
                        const lines = (fwd.messages || []).map((fm: any) => {
                            const sender = fm.role === 'user' ? (fwd.fromUserName || '用户') : (fwd.fromCharName || '角色');
                            const text = fm.type === 'image' ? '[图片]' : fm.type === 'emoji' ? '[表情]' : (fm.content || '').slice(0, 200);
                            return `  ${sender}: ${text}`;
                        });
                        content = `${timeStr} [用户转发了与 ${fwd.fromCharName || '另一个角色'} 的 ${fwd.count || lines.length} 条聊天记录]\n${lines.join('\n')}`;
                    } catch {
                        content = `${timeStr} [用户转发了一段聊天记录]`;
                    }
                }
                else if ((m.type as string) === 'score_card') {
                    try {
                        const card = m.metadata?.scoreCard || JSON.parse(m.content);
                        if (card?.type === 'lifesim_reset_card') {
                            content = `${timeStr} ${formatLifeSimResetCardForContext(card, char?.name)}`;
                        } else if (card?.type === 'diary_card') {
                            const uName = card.userName || userProfile?.name || '用户';
                            const userText = (card.userText || '').trim();
                            const charText = (card.charText || '').trim();
                            const userBlock = userText ? `${uName}的那页写道：\n「${userText}」` : `${uName}那页是空的`;
                            const charBlock = charText ? `你的那页回道：\n「${charText}」` : `你那页是空的`;
                            content = `${timeStr} [交换日记 ${card.date || ''}] ${uName}和你通过【交换日记】app 交换了一篇日记，这是一次正式的、留下记录的互动。\n${userBlock}\n${charBlock}\n（这是你们之间真实发生过的事，可以在后续聊天中自然提及。）`;
                        } else if (card?.type === 'guidebook_card') {
                            const diff = (card.finalAffinity ?? 0) - (card.initialAffinity ?? 0);
                            const uName = userProfile?.name || '用户';
                            content = `${timeStr} [攻略本游戏结算] 你和${uName}刚玩了一局"攻略本"恋爱小游戏（${card.rounds || '?'}回合）。\n结局：「${card.title || '???'}」\n好感度变化：${card.initialAffinity} → ${card.finalAffinity}（${diff >= 0 ? '+' : ''}${diff}）\n你的评语：${card.charVerdict || '无'}\n你对${uName}的新发现：${card.charNewInsight || '无'}`;
                        } else if (card?.type === 'whiteday_card') {
                            const uName = userProfile?.name || '用户';
                            const passedStr = card.passed ? `通过了测验，解锁了DIY巧克力环节` : `未通过测验（${card.score}/${card.total}）`;
                            const questionsText = (card.questions as any[])?.map((q: any, i: number) =>
                                `第${i + 1}题：${q.question}\n${uName}选择了"${q.userAnswer}"（${q.isCorrect ? '✓ 正确' : `✗ 错误，正确答案：${q.correctAnswer}`}）${q.review ? `\n你的评语：${q.review}` : ''}`
                            ).join('\n') || '';
                            content = `${timeStr} [白色情人节默契测验结果] ${uName}完成了你出的白色情人节小测验，答对了 ${card.score}/${card.total} 题，${passedStr}。\n${questionsText}\n你的最终评价：${card.finalDialogue || '无'}`;
                        } else {
                            content = `${timeStr} [系统卡片] ${m.content.slice(0, 200)}`;
                        }
                    } catch {
                        content = `${timeStr} [系统卡片]`;
                    }
                }
                else if ((m.type as string) === 'trpg_card' || (m.type as string) === 'novel_card') {
                    // TRPG 跑团片段 / 笔友会小说章节：从对应 app 多选转发进来的内容。
                    // 复用 normalizeMessageContent 翻成完整文本，让角色"记得"一起玩过/写过什么。
                    content = `${timeStr} ${normalizeMessageContent(m, char?.name || '你', userProfile?.name || '用户')}`;
                }
                else content = `${timeStr} ${sourceTag} ${content}`;

                return { role: m.role, content };
            }),
            historySlice // Return original slice for Quote lookup
        };
    }
};
