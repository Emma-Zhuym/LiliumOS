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

echo ""
if [ $FAIL -gt 0 ]; then
    echo "🔴 $FAIL 项缺失（$PASS 项通过）——EM 功能被 merge 冲掉了，对照 .claude/CLAUDE.md 补回来"
    exit 1
else
    echo "🟢 全部 $PASS 项通过，EM 功能完好"
fi
