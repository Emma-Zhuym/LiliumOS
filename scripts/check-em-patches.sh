#!/usr/bin/env bash
# EM 个人补丁自检 —— merge 上游后跑一次，确认所有 EM 功能的关键锚点还在。
# 用法: bash scripts/check-em-patches.sh
# 全绿 = EM 功能没丢；有红 = 对照 .claude/CLAUDE.md 的功能清单把丢的补回来。

cd "$(dirname "$0")/.." || exit 1

FAIL=0
PASS=0

check() {
    local desc="$1" file="$2" pattern="$3"
    if [ ! -f "$file" ]; then
        echo "❌ $desc — 文件不存在: $file"
        FAIL=$((FAIL+1))
        return
    fi
    if grep -qF "$pattern" "$file"; then
        PASS=$((PASS+1))
    else
        echo "❌ $desc"
        echo "     文件: $file"
        echo "     缺失: $pattern"
        FAIL=$((FAIL+1))
    fi
}

echo "── EM 独立文件 ──"
check "通讯录组件" components/chat/ContactsList.tsx "ContactsList"
check "单角色聊天记录搜索" components/chat/ChatSearch.tsx "按日期查找"
# 搜索入口 2026-08 搬进了聊天设置页（ChatSearch 组件），原来那句「搜索聊天记录」的文案没了。
# 锚点改钉真正的接线：组件引入 + 打开它的回调，改文案不会再误报功能丢失。
check "聊天页搜索入口" apps/Chat.tsx "import ChatSearch from"
check "聊天页搜索开关" apps/Chat.tsx "setShowChatSearch(true)"
check "双方图片相册同步" utils/galleryMessageSync.ts "syncGalleryImagesFromMessages"
check "提示词附加包" utils/emPromptAddons.ts "emNotionDiarySection"
check "Notion 扩展库配置" utils/notionExtraConfig.ts "NotionExtraDatabase"
check "角色状态核心逻辑" utils/charStatus.ts "availability"
check "角色状态 hook" hooks/useCharStatus.ts "useCharStatus"
check "记账 DB" utils/financeDb.ts "FinanceDB"

echo "── OSContext ──"
check "messageSubView 类型" context/OSContext.tsx "[EM-START: message-sub-view]"
check "messageSubView/appOrder state" context/OSContext.tsx "[EM-START: app-order-and-sub-view-state]"
check "openApp 小组件直达" context/OSContext.tsx "[EM-START: open-app-message-widget]"
check "记账备份导出" context/OSContext.tsx "[EM-START: finance-backup-export]"
check "记账备份恢复" context/OSContext.tsx "[EM-START: finance-backup-restore]"
check "健康备份导出" context/OSContext.tsx "[EM-START: health-backup-export]"
check "健康备份恢复" context/OSContext.tsx "[EM-START: health-backup-restore]"
check "购物备份导出" context/OSContext.tsx "[EM-START: shopping-backup-export]"
check "购物备份恢复" context/OSContext.tsx "[EM-START: shopping-backup-restore]"
check "地图备份导出" context/OSContext.tsx "[EM-START: map-backup-export]"
check "地图备份恢复" context/OSContext.tsx "[EM-START: map-backup-restore]"
check "记账周期规则备份" context/OSContext.tsx "emFinanceRecurringRules"

echo "── Launcher ──"
check "首页三行/普通页五行分页" utils/launcherPagination.ts "STANDARD_LAUNCHER_PAGE_APPS = 20"
check "健康图标" constants.tsx "Health: ({ className }) => <Heartbeat"
check "购物图标" constants.tsx "Shopping: ({ className }) => <Storefront"
check "地图图标" constants.tsx "Map: ({ className }) => <MapPin"
check "外卖店铺与店内双层滚动" apps/ShoppingApp.tsx "[EM-START: shopping-scroll]"
check "投喂站整页触摸滚动" apps/ShoppingApp.tsx "[EM: shopping-page-scroll]"
check "投喂站订单进 TA 查手机淘宝/外卖" apps/CheckPhone.tsx "[EM-START: shopping-family]"
check "家属关联与惊喜礼物进聊天购物感知" utils/shoppingContextBuilder.ts "[EM-START: shopping-family]"
check "心跳订单送达时刻与退款标记" types.ts "[EM-START: shopping-eta]"
check "朋友圈 App 注册" components/PhoneShell.tsx "case AppID.Moments: return <MomentsApp />"
check "朋友圈图标" constants.tsx "Moments: ({ className }) => <Aperture"
check "朋友圈顶栏自理安全区" utils/safeAreaApps.ts "AppID.Moments, // [EM: moments]"
check "查手机条目带日期" apps/CheckPhone.tsx "const fmtWhen = (t: number) => formatMomentTime(t)"
check "查手机刷新朋友圈带亲友评论" apps/CheckPhone.tsx "buildMomentExtrasPrompt(targetChar)"
check "朋友圈备份" context/OSContext.tsx "emMoments: await MomentsDB.exportAll"
check "查手机记录的 moment 字段" types.ts "[EM-START: moments]"

echo "── PhoneShell / ChatHeaderShell ──"
check "Chat 页 subView 切换（丢了会白屏）" components/PhoneShell.tsx "messageSubView === 'contacts'"
check "通讯录返回按钮 prop" components/chat/ChatHeaderShell.tsx "onOpenContacts"
check "Token 面板 prop" components/chat/ChatHeaderShell.tsx "contextComposition"

echo "── Chat.tsx ──"
check "offline 自动补回复" apps/Chat.tsx "[EM-START: offline-auto-reply]"
check "offline 发送拦截" apps/Chat.tsx "[EM-START: offline-send-gate]"
check "写 Notion 快捷操作" apps/Chat.tsx "[EM-START: notion-diary-quick]"
check "语音条发送回调" apps/Chat.tsx "[EM-START: voice-send-callbacks]"

echo "── ChatInputArea / MessageItem ──"
check "语音相关 props" components/chat/ChatInputArea.tsx "[EM-START: voice-props]"
check "语音条发送按钮" components/chat/ChatInputArea.tsx "[EM-START: voice-send-button]"
check "写 Notion 按钮" components/chat/ChatInputArea.tsx "[EM-START: notion-diary-button]"
check "用户语音气泡" components/chat/MessageItem.tsx "[EM-START: user-voice-bubble]"
check "引用与正文独立宽度" components/chat/MessageItem.tsx "[EM: independent-reply-width]"
check "引用气泡自定义 CSS 钩子" components/chat/MessageItem.tsx "sully-quote-bubble"
check "语音消息感知注入" utils/chatPrompts.ts "[EM-START: voice-aware]"
check "语音感知教学" utils/emPromptAddons.ts "emVoiceAwareAddon"

echo "── 提示词 / 请求管线 ──"
check "提示词附加包 import" utils/chatPrompts.ts "emPromptAddons"
check "发照片教学调用点" utils/chatPrompts.ts "emSendPhotoAddon()"
check "引用教学调用点" utils/chatPrompts.ts "emQuoteSection()"
check "Notion 日记调用点" utils/chatPrompts.ts "emNotionDiarySection(userProfile.name)"
check "日记 nudge 处理（须在 interaction 之前，块已并入 interaction-dispatch）" utils/chatPrompts.ts "[EM-START: interaction-dispatch]"
check "contextBreakdown 返回" utils/chatRequestPayload.ts "[EM-START: context-breakdown-return]"
check "Token 面板 set（不能写死0）" hooks/useChatAI.ts "[EM-START: context-composition-set]"
check "日记第四参数 (pendingDiary)" utils/pendingDiary.ts "notionDiaryExtraProperties"
check "日记第四参数 (postProcessing)" utils/applyAssistantPostProcessing.ts "notionDiaryExtraProperties"
check "schedule 时间解析" utils/chatParser.ts "[EM-START: parse-schedule-due-at]"
check "收藏照片处理" utils/applyAssistantPostProcessing.ts "[EM-START: fav-photo]"
check "收藏照片教学调用点" utils/chatPrompts.ts "emFavPhotoAddon()"
check "收藏照片标签兜底剥离" utils/sanitize.ts "[EM: fav-photo-strip]"
check "生活记录入口隐藏开关" apps/UserApp.tsx "[EM-START: hide-life-records]"
check "Apple Health 七日极简角色摘要" utils/healthContextBuilder.ts "[EM-START: apple-health-role-summary]"

echo "── 天气 Open-Meteo ──"
check "openMeteo 独立模块" utils/openMeteo.ts "resolveWeatherCoords"
check "fetchWeather 免 key 改造" utils/realtimeContext.ts "[EM-START: weather-openmeteo]"
check "旧配置迁移" context/OSContext.tsx "[EM-START: weather-openmeteo]"
check "Settings 天气 UI" apps/Settings.tsx "[EM-START: weather-openmeteo]"

echo "── 照片收藏 ──"
check "GalleryImage.favorited 字段" types.ts "favorited?: boolean; // [EM: photo-favorites]"
check "DB 收藏更新方法" utils/db.ts "updateGalleryImageFavorite"
check "相册星标" apps/Gallery.tsx "[EM-START: photo-favorites]"
check "查手机轮播组件" apps/CheckPhone.tsx "PhotoCarouselWidget"

echo "── 地图×日程 Clay UI ──"
check "Map safe-area 自理" utils/safeAreaApps.ts "[EM: map-schedule-clay]"
check "地图世界存储模块" utils/mapWorlds.ts "matchRegionForSlot"
check "ScheduleSlot.regionId 字段" types.ts "regionId?: string;    // [EM: map-region-id]"
check "日程生成注入地点清单" utils/scheduleGenerator.ts "[EM-START: map-region-id]"

echo "── 神经链接 · 日常节律草稿 ──"
check "草稿生成 prompt 构建" utils/scheduleGenerator.ts "[EM-START: daily-rhythm-draft]"
check "角色详情页生成入口" apps/Character.tsx "[EM-START: character-daily-rhythm-draft]"

echo "── 查手机 · 手动添加联系人带描述 ──"
check "关系备注/一句描述输入框" apps/CheckPhone.tsx "[EM-START: contacts-manual-detail]"

echo "── 查手机 · 联系人分组 ──"
check "分组清单与推断" utils/contactGroups.ts "[EM-START: contact-groups]"
check "PhoneContact.group 字段" types.ts "[EM-START: contact-groups]"
check "upsertContact 保护已有分组" utils/relationshipChat.ts "[EM-START: contact-groups]"
check "联系人列表按组分段" apps/CheckPhone.tsx "[EM-START: contact-groups]"

echo "── 查手机 · 工作 App ──"
check "工作数据纯函数" utils/emWork.ts "[EM-START: work-app]"
check "工作 App 界面" components/checkphone/WorkApp.tsx "[EM-START: work-app]"
check "查手机挂载工作 App" apps/CheckPhone.tsx "[EM-START: work-app]"
check "PhoneState.work 字段" types.ts "[EM-START: work-app]"
check "信箱路由工作往来" utils/emAgentBackend.ts "isWorkEpisodeMessage"
check "OSContext 落地工作往来" context/OSContext.tsx "[EM: work-app]"

echo "── 心跳 · 私人生活里的小事 ──"
check "生活小事落地" utils/emLife.ts "[EM-START: agent-life]"
check "OSContext 落地生活小事" context/OSContext.tsx "[EM: agent-life]"
check "信箱路由生活小事" utils/emAgentBackend.ts "isLifeEpisodeMessage"
check "PhoneEvidence 来源 id" types.ts "[EM: agent-life]"

echo "── EM 角色代记 ──"
check "代记核心模块" utils/emScribe.ts "executeEmScribeDirectives"
check "chatPrompts 注入" utils/chatPrompts.ts "[EM-START: em-scribe]"
check "chatParser 解析" utils/chatParser.ts "[EM-START: em-scribe]"
check "Chat 卡片分流" apps/Chat.tsx "[EM-START: em-scribe]"
check "卡片样式 symptom/sleep" components/chat/MessageItem.tsx "[EM-START: em-scribe]"

echo "── Token 面板召回展示 ──"
check "召回简报模块" utils/memoryPalace/recallBrief.ts "getLastRecallBriefs"
check "formatter 简报写入" utils/memoryPalace/formatter.ts "setLastRecallBriefs"
check "payload 简报穿透" utils/chatRequestPayload.ts "recalledMemories: getLastRecallBriefs"
check "⚡ 面板召回小节" components/chat/ChatHeaderShell.tsx "[EM-START: token-panel-recall]"

echo "── 七夕特别时光 ──"
check "七夕完整活动" components/events/qixi/QixiDemoEvent.tsx "QIXI_MODEL_API_CALL_COUNT = 4"
check "七夕角色独立 API" components/ValentineEvent.tsx "[EM: qixi-character-api]"
check "七夕四次调用文案" components/ValentineEvent.tsx "[EM: qixi-api-call-copy]"
check "七夕专用召回上限" utils/memoryPalace/pipeline.ts "[EM: qixi-recall-cap]"
check "七夕聊天上下文" utils/chatPrompts.ts "formatQixiEventCardForContext"

echo "── 换皮 F（全平 / 雾面浮层 / 衬线标题）──"
check "token 全平" utils/clayTokens.ts "raisedSoft:   'none'"
check "token 雾面浮层" utils/clayTokens.ts "export const OVERLAY"
check "动效样式随 token 引入" utils/clayTokens.ts "import './clayMotion.css';"
check "动效关键帧" utils/clayMotion.css "clay-sheet-in"
check "提示条组件" components/os/ClayToast.tsx "OVERLAY.toastBg"
check "PhoneShell 提示条补丁" components/PhoneShell.tsx "[EM: skin-f-toast]"
check "标题衬线字体加载" index.html "Noto+Serif+SC"
check "雾面 sheet" components/os/ClayDialog.tsx "OVERLAY.blur"

echo "── 小红书 MCP 搬到 mini（令牌 / 无状态 / 扫码登录）──"
check "客户端带 Bearer 令牌" utils/xhsMcpClient.ts "const withMcpAuth"
check "客户端认无状态服务器" utils/xhsMcpClient.ts "Stateless: true"
check "客户端扫码登录" utils/xhsMcpClient.ts "const mcpLoginQrcode"
check "配置类型带令牌" types.ts "authToken?: string; // [EM: xhs-mini-mcp]"
check "设置页令牌与扫码" apps/Settings.tsx "fetchXhsLoginQr"
check "令牌随工具配置上云" utils/amsgToolPack.ts "authToken: xhs.authToken"
check "worker 注入令牌" worker/amsg/src/index.ts "XhsMcpClient.setAuthToken(stash.xhsAuthToken)"
check "网关 /xhs 路由" scripts/home-assistant-proxy.mjs "XHS_MCP_TARGET"
check "心跳逛小红书：快照带开关" utils/emAgentSnapshot.ts "[EM: heartbeat-xhs]"
check "心跳逛小红书：落进小红书 App" context/OSContext.tsx "xhsActivitiesFromLife(event, charId)"
check "心跳转发小红书带卡片" utils/emAgentInbox.ts "[EM-START: heartbeat-xhs]"
check "网关停用发帖评论" scripts/home-assistant-proxy.mjs "XHS_BLOCKED_TOOLS"
check "心跳读消息：TA 回过后同步快照" apps/Chat.tsx "[EM-START: agent-backend-reply-sync]"
check "心跳长期记忆：月度总结进快照" utils/emAgentSnapshot.ts "monthlySummaries"
check "心跳丢掉过期日程" server/agent-backend/heartbeat.mjs "withTodaySchedule(getSnapshot(db, character.charId), now())"
check "打开 App 补传快照" context/OSContext.tsx "refreshHeartbeatSnapshots(charactersRef.current"
check "聊天看得到朋友圈" utils/chatPrompts.ts "[EM-START: moments-chat-context]"
check "心跳刷朋友圈：反应落库" utils/emAgentInbox.ts "applyHeartbeatMomentReactions(message.charId"
check "心跳刷朋友圈：快照带阿萌动态" utils/emAgentSnapshot.ts "loadUserMomentsForSnapshot("
check "心跳快照：小红书自由活动记录只留梗概" utils/emAgentSnapshot.ts "compactXhsActivityNote(messageToPlainText"
check "聊天知道自己的约定" utils/chatPrompts.ts "[EM-START: agent-plans]"
check "日历显示角色约定" apps/CalendarApp.tsx "dayPlans.map(renderPlan)"
check "后端约定接口" server/agent-backend/server.mjs "'GET /plans'"
check "角色发的照片只给文字" utils/chatPrompts.ts "[EM-START: assistant-photo-text]"
check "聊天知道对方那边几点" utils/context.ts "userClockNote(charTz)"
check "天气地名带州和国家" utils/openMeteo.ts "displayName: placeName(savedLocation)"
check "即时回复：聊天路由交给 mini" hooks/useChatAI.ts "[EM-START: agent-instant-chat]"
check "即时回复：推送送到的回复落地即销账" utils/activeMsgRuntime.ts "settleLandedAgentReplies(landedMessageIds)"
check "推送失效提示：OSContext 弹说明" context/OSContext.tsx "em-agent-push-stale"
check "社会责任：聊天行为规范" utils/chatPrompts.ts "\${emDutySection(userProfile.name)}"
check "社会责任：心跳提示词" server/agent-backend/heartbeat.mjs "lines.push(DUTY_RULE)"
check "印象档案：回包宽容解析" apps/Character.tsx "normalizeUserImpression(parseImpressionReply(content))"
check "印象档案：提示词格式提醒" apps/Character.tsx "emImpressionJsonNote()"
check "记忆整理：冲突写清起因" utils/memoryPalace/extraction.ts "emMemoryCauseRule(userLabel)"
check "聊天时差：直接给出谁快几小时" utils/emUserClock.ts "timeDifferenceNote(charTz, userTz, now)"
check "即时回复：交给 mini 的这一轮不因常驻工具关思考链" hooks/useChatAI.ts "!instantChatOn && !agentChatRoute"
check "Token 面板：云端回复的用量也更新 ⚡" hooks/useChatAI.ts "[EM-START: token-panel-cloud]"
check "Token 面板：收件箱事件带用量" utils/activeMsgRuntime.ts "[EM: token-panel-cloud]"
check "即时回复：mini 的轮次单独点名" utils/activeMsgRuntime.ts "p.via === 'mini'"
check "即时回复：待收记录带 via" utils/amsgInstantChat.ts "via?: 'mini'"
check "即时回复：信箱回复进收件箱" utils/emAgentInbox.ts "route === 'reply'"
check "即时回复：去取信号" utils/amsgResults.ts "case 'agent-pull'"
check "即时回复：设置开关" components/settings/AgentBackendSection.tsx "聊天交给 Mac mini 回复"
check "即时回复：后端接口" server/agent-backend/server.mjs "'POST /chat/turns'"
check "推送订阅换了自动重新登记给 mini" context/OSContext.tsx "ensureAgentPushRegistered()"
check "SimpleFIN 撤掉的预扣款不计入" utils/simplefinSync.ts "[EM-START: finance-dropped-holds]"
check "SimpleFIN 金额调整过的预扣款" utils/simplefinSync.ts "[EM-START: finance-adjusted-holds]"
check "账本手动不计入 / 已排除列表" apps/BankApp.tsx "[EM-START: finance-manual-exclude]"
check "朋友圈评论带上私聊" apps/MomentsApp.tsx "runCharacterLook(char, items, readInter, characters, userName, api, recentChat)"

echo ""
if [ $FAIL -gt 0 ]; then
    echo "🔴 $FAIL 项缺失（$PASS 项通过）——EM 功能被 merge 冲掉了，对照 .claude/CLAUDE.md 补回来"
    exit 1
else
    echo "🟢 全部 $PASS 项通过，EM 功能完好"
fi
