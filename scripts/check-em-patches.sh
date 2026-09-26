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

echo ""
if [ $FAIL -gt 0 ]; then
    echo "🔴 $FAIL 项缺失（$PASS 项通过）——EM 功能被 merge 冲掉了，对照 .claude/CLAUDE.md 补回来"
    exit 1
else
    echo "🟢 全部 $PASS 项通过，EM 功能完好"
fi
