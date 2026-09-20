import React, { useMemo, useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { X } from '@phosphor-icons/react';
import { isPaperWallpaper, useOS } from '../context/OSContext';
import { INSTALLED_APPS, DOCK_APPS } from '../constants';
import { isDevDebugAvailable, subscribeDevDebugAvailability } from '../utils/devDebug';
import AppIcon from '../components/os/AppIcon';
import TokenImg from '../components/os/TokenImg';
import { useBlobRefUrl } from '../utils/blobRef';
import { DB } from '../utils/db';
import { isChatPreviewMessage } from '../utils/chatMessageVisibility';
import { CharacterProfile, Anniversary, AppID, DailySchedule, LauncherFolder, AppConfig } from '../types';
import { ScheduleHomeWidget, ScheduleFullscreenViewer } from '../components/schedule/ScheduleHomeWidget';
import NowPlayingSquareWidget from '../components/os/NowPlayingSquareWidget';
import LauncherWidgetStack from '../components/os/LauncherWidgetStack'; // [EM: launcher-widget-stack]
import { LauncherFolderIcon, LauncherFolderPanel, LauncherFolderEditor } from '../components/os/LauncherFolder'; // [EM: launcher-folders]
import { normalizeLauncherFolders, rootLauncherIds } from '../utils/launcherFolders'; // [EM: launcher-folders]
import MobileGameHome from '../components/os/MobileGameHome';
import TamagotchiHome from '../components/os/TamagotchiHome';
import { getDailyScheduleForChar } from '../utils/dailySchedule';
import { sortAnniversariesByNextOccurrence } from '../utils/anniversaryNext';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import { resolveCharTimeZone } from '../utils/timezone';
import { DESKTOP_COLUMNS, DESKTOP_ROWS, DESKTOP_WIDGET_IDS, defaultDesktopLayout, desktopItemSize, desktopPageCount, moveDesktopItem, normalizeDesktopLayout, type DesktopLayout } from '../utils/launcherDesktopLayout';
import { useContactRemark } from '../utils/contactRemarks'; // [EM: desktop-contact-remark]
import { F, R, S, SP } from '../utils/clayTokens';

const CompanionHome = React.lazy(() => import('../components/os/CompanionHome'));

// --- Isolated Components to prevent full re-renders ---

// 1. Clock Component (Consumes virtualTime)
const DesktopClock = React.memo(() => {
    const { virtualTime, theme } = useOS();
    const contentColor = theme.contentColor || '#ffffff';
    const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const now = new Date();
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate().toString().padStart(2, '0');
    const yearNum = now.getFullYear();

    // 简单问候（基于虚拟时间）
    const greeting = virtualTime.hours < 5 ? 'Good Night'
        : virtualTime.hours < 12 ? 'Good Morning'
        : virtualTime.hours < 18 ? 'Good Afternoon'
        : 'Good Evening';

    const hh = virtualTime.hours.toString().padStart(2, '0');
    const mm = virtualTime.minutes.toString().padStart(2, '0');

    // 动森彩蛋：NookPhone 主屏时钟 —— 问候 + 大号时间(主角) + 星期·日期
    if (theme.skin === 'animalcrossing') {
        const weekdayTitle = dayName.charAt(0) + dayName.slice(1).toLowerCase();
        const monthTitle = monthName.charAt(0) + monthName.slice(1).toLowerCase();
        return (
            <div className="mt-7 mb-5 text-center animate-fade-in select-none">
                <div className="text-[13px] font-extrabold tracking-wide" style={{ color: '#8a7a5c' }}>
                    🍃 {greeting}, Resident
                </div>
                <div className="text-[clamp(4rem,20vw,6rem)] font-extrabold leading-none mt-1.5 tracking-[2px]" style={{ color: '#8b7355' }}>
                    {hh}<span className="animate-pulse" style={{ color: '#cfcab2' }}>:</span>{mm}
                </div>
                <div className="text-[15px] font-bold mt-1.5" style={{ color: '#725C4E' }}>
                    {weekdayTitle} · {monthTitle} {Number(dateNum)}
                </div>
            </div>
        );
    }

        return (
        <div className="w-full flex flex-col mb-5 mt-5 relative animate-fade-in" style={{ color: contentColor }}>
            {/* 顶部装饰 — 状态胶囊 + 细线 */}
            <div className="flex items-center gap-2 mb-3 opacity-90">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                    style={{
                        background: paper ? 'rgba(224,221,215,0.30)' : 'rgba(255,255,255,0.28)',
                        border: paper ? '1px solid rgba(91,72,51,0.07)' : '1px solid rgba(255,255,255,0.18)',
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: paper ? '#788369' : '#4ade80', boxShadow: paper ? 'none' : '0 0 6px #4ade80' }} />
                    <span className="text-[9px] font-bold tracking-[0.2em] uppercase">System Online</span>
                </div>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-current to-transparent opacity-30" />
                <span className="text-[9px] tracking-[0.2em] uppercase opacity-60">{yearNum}</span>
            </div>

            {/* 问候 */}
            <div className="text-[11px] tracking-[0.25em] uppercase opacity-55 font-semibold mb-1">
                {greeting}
            </div>

            {/* 主时钟 */}
            <div className="flex items-end gap-4">
                <div className="relative">
                    <div className={`${paper ? 'text-[clamp(4rem,19vw,6.5rem)] font-semibold tracking-[-0.055em] drop-shadow-[0_2px_0_rgba(255,255,255,0.34)]' : 'text-[clamp(4.25rem,20vw,7.25rem)] font-black tracking-tighter drop-shadow-2xl'} leading-[0.84]`}
                        style={{ fontFamily: paper ? `'Iowan Old Style', 'Baskerville', 'Times New Roman', serif` : `'Space Grotesk', 'SF Pro Display', sans-serif`, fontFeatureSettings: '"tnum"' }}>
                        <span>{virtualTime.hours.toString().padStart(2, '0')}</span>
                        <span className="opacity-35 font-thin mx-0.5 animate-pulse">:</span>
                        <span>{virtualTime.minutes.toString().padStart(2, '0')}</span>
                    </div>
                    {/* 细光斑 */}
                    {!paper && <div className="absolute -top-2 -right-3 w-8 h-8 rounded-full pointer-events-none"
                        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.4), transparent 70%)' }} />}
                </div>

                <div className="flex flex-col justify-end pb-2.5 gap-0.5">
                    <div className="text-[10px] font-bold tracking-[0.22em] opacity-85">{dayName}</div>
                    <div className="flex items-baseline gap-1">
                        <div className="text-2xl font-black leading-none" style={{ fontFamily: `'Space Grotesk', sans-serif` }}>{dateNum}</div>
                        <div className="text-[10px] font-bold tracking-[0.2em] opacity-70">{monthName}</div>
                    </div>
                </div>
            </div>
        </div>
    );
});

// 2. Character Widget (Consumes Character Data & Messages)
const CharacterWidget = React.memo(({ 
    char, 
    unreadCount, 
    lastMessage, 
    onClick, 
    contentColor,
    paper = false,
}: { 
    char: CharacterProfile | null, 
    unreadCount: number, 
    lastMessage: string, 
    onClick: () => void,
    contentColor: string,
    paper?: boolean,
}) => {
    const { theme } = useOS();
    const contactRemark = useContactRemark(char?.id || ''); // [EM: desktop-contact-remark]
    const acnh = theme.skin === 'animalcrossing'; // 动森彩蛋：会"说话"的村民卡
    // 卡片底的虚化头像画在 CSS background-image 上，吃不到 TokenImg 的解析，这里自己解析一次。
    const avatarUrl = useBlobRefUrl(char?.avatar);

    // 动森：村民头像 + AC 对话气泡（显示最近消息，点开聊天）
    if (acnh) {
        return (
            <div className="mb-4 animate-fade-in" onClick={onClick}>
                <div className="flex items-end gap-2.5 cursor-pointer active:scale-[0.98] transition-transform">
                    {/* 村民头像（圆角方块 + 白边） */}
                    <div className="relative w-[60px] h-[60px] shrink-0 rounded-[26%] overflow-hidden bg-[#e8e2d6]"
                        style={{ border: '3px solid #ffffff', boxShadow: '0 4px 10px -2px rgba(61,52,40,0.28)' }}>
                        {char?.avatar
                            ? <TokenImg value={char.avatar} className="w-full h-full object-cover" alt="char" loading="lazy" />
                            : <div className="w-full h-full flex items-center justify-center text-2xl">🍃</div>}
                        {unreadCount > 0 && (
                            <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#fc736d] rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ border: '2px solid #fff' }}>
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </div>
                        )}
                    </div>
                    {/* AC 对话气泡 */}
                    <div className="relative flex-1 min-w-0 mb-1">
                        <div className="absolute -left-1.5 bottom-3 w-3 h-3 rotate-45"
                            style={{ background: '#FFFBF2', borderLeft: '2px solid #ece0c8', borderBottom: '2px solid #ece0c8' }} />
                        <div className="relative rounded-2xl px-3.5 py-2.5"
                            style={{ background: '#FFFBF2', border: '2px solid #ece0c8', boxShadow: '0 4px 12px -5px rgba(120,90,40,0.25)' }}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[13px] font-extrabold truncate" style={{ color: '#725d42' }}>{contactRemark || char?.name || 'Resident'}</span>
                                <span className="text-[11px] leading-none">{unreadCount > 0 ? '💬' : '🍃'}</span>
                            </div>
                            <div className="text-[11px] leading-snug line-clamp-2" style={{ color: '#9f8b68' }}>{lastMessage}</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-3 group animate-fade-in">
             <div
                className="relative h-24 w-full overflow-hidden rounded-3xl cursor-pointer transition-transform duration-300 active:scale-[0.98]"
                onClick={onClick}
                style={paper ? {
                    background: 'rgba(224,221,215,0.40)',
                    border: '1px solid rgba(91,72,51,0.07)',
                    boxShadow: '0 5px 16px rgba(91,72,51,0.055)',
                } : acnh ? {
                    background: 'rgb(247,243,223)',
                    border: '2px solid #e8e2d6',
                    boxShadow: '0 8px 24px 0 rgba(61,52,40,0.14)',
                } : {
                    background: 'rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(24px) saturate(1.4)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
             >
                 {/* 背景虚化角色头像（动森模式下省略，避免糊在奶油底上） */}
                 {!acnh && !paper && avatarUrl && (
                     <div className="absolute inset-0 opacity-25 pointer-events-none"
                         style={{
                             backgroundImage: `url(${avatarUrl})`,
                             backgroundSize: 'cover',
                             backgroundPosition: 'center',
                             filter: 'blur(30px) saturate(1.6)',
                             transform: 'scale(1.3)',
                         }} />
                 )}

                 <div className="relative flex items-center p-3 gap-3 h-full">
                     {/* 头像 */}
                     <div className={`w-[68px] h-[68px] shrink-0 rounded-2xl overflow-hidden relative ${paper ? 'bg-[#ded2c1]' : 'bg-slate-800'}`}
                         style={{
                             border: paper ? '1px solid rgba(91,72,51,0.14)' : acnh ? '2px solid #e8e2d6' : '1.5px solid rgba(255,255,255,0.25)',
                             boxShadow: paper ? '0 5px 14px rgba(91,72,51,0.13)' : acnh ? '0 4px 12px -4px rgba(61,52,40,0.25)' : '0 4px 14px rgba(0,0,0,0.25)',
                         }}>
                         {char ? (
                             <TokenImg value={char.avatar} className="w-full h-full object-cover" alt="char" loading="lazy" />
                         ) : <div className="w-full h-full bg-white/10 animate-pulse" />}
                         {unreadCount > 0 ? (
                            <div className="absolute bottom-0.5 right-0.5 min-w-[16px] h-[16px] px-1 bg-red-500 rounded-full border border-white/30 shadow-sm flex items-center justify-center text-[9px] font-bold text-white">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </div>
                         ) : (
                            <div className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border-2 border-white/60" style={{ background: paper ? '#788369' : '#4ade80', boxShadow: paper ? 'none' : '0 0 6px #4ade80' }}></div>
                         )}
                     </div>

                     {/* 文本 */}
                     <div className="flex-1 min-w-0 flex flex-col justify-center gap-1" style={{ color: contentColor }}>
                         <div className="flex items-center gap-1.5">
                             <h3 className={`text-[15px] font-bold tracking-wide truncate ${paper ? '' : 'drop-shadow-md'}`}>
                                 {contactRemark || char?.name || 'NO SIGNAL'}
                             </h3>
                             {unreadCount > 0 ? (
                                 <div className="px-1.5 py-px rounded-full text-[8px] font-bold uppercase tracking-[0.15em]"
                                     style={{ background: 'rgba(239,68,68,0.9)', color: 'white' }}>NEW</div>
                             ) : (
                                 <div className="px-1.5 py-px rounded-full text-[8px] font-bold uppercase tracking-[0.15em]"
                                     style={paper ? { background: 'rgba(120,131,105,0.16)', color: '#68725b' } : acnh ? { background: '#7cba4c', color: 'white' } : { background: 'rgba(255,255,255,0.18)' }}>Online</div>
                             )}
                         </div>
                         <div className="text-xs font-medium leading-relaxed opacity-85 flex items-start gap-1.5">
                            <span
                                aria-hidden="true"
                                className="shrink-0 mt-[0.42em] opacity-45"
                                style={{ width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderLeft: '4px solid currentColor' }}
                            />
                            <span className="line-clamp-2">{lastMessage}</span>
                         </div>
                     </div>
                 </div>
             </div>
        </div>
    );
});

const UTILITY_WIDGET_ID = 'widget:utilities';
const FREE_TWO_CELL_HEIGHT = 'calc(2 * var(--launcher-cell) + 10px)';
const FREE_PAGE_HEIGHT = 'calc(6 * var(--launcher-cell) + 90px)';
type LauncherGridItem = { kind: 'app'; app: AppConfig } | { kind: 'folder'; folder: LauncherFolder } | { kind: 'widget' };
// Square image widget, kept separate from the placement grid.
const DesktopSquareImage = React.memo(({ image, contentColor, onClick, acnh = false }: {
    image?: string,
    contentColor: string,
    onClick: () => void,
    acnh?: boolean,
}) => {
    const { theme } = useOS();
    const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);
    return (
        <div
            onClick={onClick}
            className="relative w-full h-full rounded-[1.75rem] overflow-hidden cursor-pointer animate-fade-in transition-transform active:scale-[0.98]"
            style={paper ? {
                background: image ? 'rgba(224,221,215,0.26)' : 'rgba(224,221,215,0.38)',
                border: '1px solid rgba(91,72,51,0.07)',
                boxShadow: '0 5px 16px rgba(91,72,51,0.055)',
                color: contentColor,
            } : acnh ? {
                background: image ? 'rgb(247,243,223)' : 'rgb(247,243,223)',
                border: '2px solid #e8e2d6',
                boxShadow: '0 6px 18px rgba(61,52,40,0.12)',
                color: contentColor,
            } : {
                background: image ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.28)',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.07)',
                color: contentColor,
            }}
        >
            {image ? (
                <TokenImg value={image} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ background: paper ? 'rgba(120,131,105,0.10)' : 'rgba(255,255,255,0.1)', border: paper ? '1px solid rgba(91,72,51,0.12)' : '1px solid rgba(255,255,255,0.16)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="w-4 h-4 opacity-70">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                        </svg>
                    </div>
                    <div className="text-[8.5px] uppercase font-bold tracking-[0.22em] opacity-55">Add Image</div>
                    <div className="text-[8.5px] opacity-40 leading-tight">从 外观 · 启动器组件<br/>设置一张方图</div>
                </div>
            )}
        </div>
    );
});

const CALENDAR_WEEKDAYS = [
    { key: 'sun', label: 'S' },
    { key: 'mon', label: 'M' },
    { key: 'tue', label: 'T' },
    { key: 'wed', label: 'W' },
    { key: 'thu', label: 'T' },
    { key: 'fri', label: 'F' },
    { key: 'sat', label: 'S' },
] as const;

// 4. Widget Page Component (Calendar + Events)
const WidgetsPage = React.memo(({ contentColor, openApp, anniversaries, characters, acnh = false, paper = false }: any) => {
    // 动森：奶油卡片样式（替代暗色玻璃）
    const acCard = acnh ? { background: 'rgb(247,243,223)', border: '2px solid #e8e2d6', boxShadow: '0 6px 18px rgba(61,52,40,0.12)' } : undefined;
    const acDot = acnh ? '#6fba2c' : undefined;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthName = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][currentMonth];
    
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
    
    const totalDays = getDaysInMonth(currentYear, currentMonth);
    const startOffset = getFirstDayOfMonth(currentYear, currentMonth);
    
    const calendarDays = Array.from({ length: totalDays }, (_, i) => i + 1);
    const paddingDays = Array.from({ length: startOffset }, () => null);

    // --- Upcoming events: only today + future, soonest first (non-mutating), paginated ---
    const upcomingAnniversaryRows = useMemo(
        () => sortAnniversariesByNextOccurrence(anniversaries as Anniversary[]),
        [anniversaries]
    );
    const calendarEventDates = useMemo(() => new Set(
        upcomingAnniversaryRows
            .filter(({ next }) => next.getFullYear() === currentYear && next.getMonth() === currentMonth)
            .map(({ next }) => `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`)
    ), [currentMonth, currentYear, upcomingAnniversaryRows]);
    const upcomingEvents = upcomingAnniversaryRows;
    const EVENTS_PER_PAGE = 4;
    const eventPageCount = Math.max(1, Math.ceil(upcomingEvents.length / EVENTS_PER_PAGE));
    const [eventPage, setEventPage] = useState(0);
    // Clamp the page if the list shrinks (e.g. an event passes / is removed)
    useEffect(() => {
        if (eventPage > eventPageCount - 1) setEventPage(eventPageCount - 1);
    }, [eventPageCount, eventPage]);
    const pagedEvents = upcomingEvents.slice(eventPage * EVENTS_PER_PAGE, eventPage * EVENTS_PER_PAGE + EVENTS_PER_PAGE);

    return (
        <div className="w-full flex flex-col gap-6">
              <div className={`rounded-3xl p-6 ${acnh ? 'shadow-sm' : paper ? '' : 'bg-white/25 border border-white/25 shadow-xl'}`} style={paper ? { background: 'rgba(224,221,215,0.36)', border: '1px solid rgba(91,72,51,0.07)', boxShadow: '0 5px 16px rgba(91,72,51,0.05)' } : acCard}>
                  <div className="flex justify-between items-center mb-4" style={{ color: contentColor }}>
                      <h3 className="text-xl font-bold tracking-widest">{monthName} {currentYear}</h3>
                      <div onClick={() => openApp('schedule')} className={`p-2 rounded-full cursor-pointer transition-colors ${acnh ? 'bg-[#82D5BB]/30 hover:bg-[#82D5BB]/50' : paper ? 'bg-[#788369]/10 hover:bg-[#788369]/20' : 'bg-white/20 hover:bg-white/40'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-3 gap-x-1 text-center mb-2">
                      {CALENDAR_WEEKDAYS.map(day => <div key={day.key} className="text-[10px] font-bold opacity-40" style={{ color: contentColor }}>{day.label}</div>)}
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-2 gap-x-1 text-center">
                      {paddingDays.map((_, i) => <div key={`pad-${i}`} />)}
                      {calendarDays.map(day => {
                          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const isToday = day === now.getDate();
                          const hasEvent = calendarEventDates.has(dateStr);
                          
                          return (
                              <div key={day} className="flex flex-col items-center justify-center h-8 relative">
                                  <div
                                    className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium ${isToday ? (acnh ? 'text-white font-bold' : paper ? 'text-white font-bold' : 'bg-white text-black font-bold shadow-lg') : 'opacity-80'}`}
                                    style={isToday ? (acnh ? { background: '#19c8b9' } : paper ? { background: '#788369', boxShadow: '0 4px 10px rgba(91,72,51,0.14)' } : {}) : { color: contentColor }}
                                  >
                                      {day}
                                  </div>
                                  {hasEvent && <div className="w-1.5 h-1.5 rounded-full absolute bottom-0 shadow-sm border border-black/10" style={{ background: acDot || (paper ? '#a66f52' : '#c084fc') }}></div>}
                              </div>
                          );
                      })}
                  </div>
              </div>

              <div className={`rounded-3xl p-5 flex flex-col min-h-[200px] ${acnh ? 'shadow-sm' : paper ? '' : 'bg-white/25 border border-white/25 shadow-xl'}`} style={paper ? { background: 'rgba(224,221,215,0.36)', border: '1px solid rgba(91,72,51,0.07)', boxShadow: '0 5px 16px rgba(91,72,51,0.05)' } : acCard}>
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-bold opacity-60 uppercase tracking-widest flex items-center gap-2" style={{ color: contentColor }}>
                          <span className="w-2 h-2 rounded-full" style={{ background: acDot || (paper ? '#a66f52' : '#c084fc') }}></span> Upcoming Events
                      </h3>
                      {eventPageCount > 1 && (
                          <div className="flex items-center gap-2 shrink-0" style={{ color: contentColor }}>
                              <button
                                  onClick={(e) => { e.stopPropagation(); setEventPage(p => Math.max(0, p - 1)); }}
                                  disabled={eventPage === 0}
                                  className={`w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-25 transition-colors active:scale-90 ${paper ? 'bg-[#788369]/10 hover:bg-[#788369]/20' : 'bg-white/15 hover:bg-white/30'}`}
                                  aria-label="Previous events"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                              </button>
                              <span className="text-[10px] font-mono opacity-60 tabular-nums">{eventPage + 1}/{eventPageCount}</span>
                              <button
                                  onClick={(e) => { e.stopPropagation(); setEventPage(p => Math.min(eventPageCount - 1, p + 1)); }}
                                  disabled={eventPage >= eventPageCount - 1}
                                  className={`w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-25 transition-colors active:scale-90 ${paper ? 'bg-[#788369]/10 hover:bg-[#788369]/20' : 'bg-white/15 hover:bg-white/30'}`}
                                  aria-label="Next events"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                              </button>
                          </div>
                      )}
                  </div>
                  <div className="space-y-3">
                      {upcomingEvents.length > 0 ? pagedEvents.map(({ anni, next }) => (
                          <div key={anni.id} className={`flex items-center gap-3 p-3 rounded-xl ${acnh ? 'bg-[#efe7d4] border border-[#e0d6c0]' : paper ? 'bg-[#f3ecdf]/70 border border-[#5b4833]/10' : 'bg-white/5 border border-white/10'}`}>
                              <div className={`w-10 h-10 shrink-0 rounded-lg flex flex-col items-center justify-center ${acnh ? 'bg-[#82D5BB] text-white border border-[#6cc0a6]' : paper ? 'bg-[#a66f52]/12 text-[#8c5d46] border border-[#a66f52]/15' : 'bg-purple-500/20 text-purple-200 border border-purple-500/30'}`}>
                                  <span className="text-[9px] opacity-70">{String(next.getMonth() + 1).padStart(2, '0')}</span>
                                  <span className="text-sm font-bold leading-none">{String(next.getDate()).padStart(2, '0')}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="text-sm font-bold truncate" style={{ color: contentColor }}>{anni.title}</div>
                                  <div className="text-[10px] opacity-50 truncate" style={{ color: contentColor }}>{characters.find((c: any) => c.id === anni.charId)?.name || 'Unknown'}</div>
                              </div>
                          </div>
                      )) : (
                          <div className="text-center opacity-30 text-xs py-8" style={{ color: contentColor }}>No upcoming events</div>
                      )}
                  </div>
              </div>
        </div>
    );
});

// --- Persist scroll page across remounts (e.g. returning from apps) ---
let _lastPageIndex = 1;

// --- Main Launcher ---

const Launcher: React.FC = () => {
  const { openApp, characters, activeCharacterId, theme, updateTheme, lastMsgTimestamp, isDataLoaded, unreadMessages } = useOS();

  // Local state for widget data to prevent context trashing
  const [widgetChar, setWidgetChar] = useState<CharacterProfile | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
  const [scheduleData, setScheduleData] = useState<DailySchedule | null>(null);
  const [scheduleCharId, setScheduleCharId] = useState<string | null>(null);
  const [scheduleViewerOpen, setScheduleViewerOpen] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null); // [EM: launcher-folders]
  const [editingFolderId, setEditingFolderId] = useState<string | 'new' | null>(null); // [EM: launcher-folders]
  const layoutPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutPointer = useRef<{
      pointerId: number;
      key: string;
      kind: string;
      x: number;
      y: number;
      active: boolean;
      element: HTMLElement;
      ghost?: HTMLElement;
      grabOffsetX?: number;
      grabOffsetY?: number;
      lastTarget?: string;
      targetElement?: HTMLElement;
      originLayout?: DesktopLayout;
      lastCell?: string;
  } | null>(null);
  const suppressLayoutClickUntil = useRef(0);
  const layoutPageTurnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutPageTurnDirection = useRef<-1 | 0 | 1>(0);

  const [activePageIndex, setActivePageIndex] = useState(_lastPageIndex);
  const activePageIndexRef = useRef(_lastPageIndex);
  const initialPageRef = useRef(_lastPageIndex);
  const initialPageReadyRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Mouse Drag Logic refs
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeftRef = useRef(0);
  const dragMoved = useRef(0);

  // Pagination Logic
  // 跟随 DevDebug 可用性：prod 用户在设置页连点 5 下解锁后，CharCreatorDev 立刻出现；
  // 点「关闭」/ 刷新（prod 自动失效）也立刻消失。useMemo deps 没列 devDebugVisible
  // 会让它锁在 mount 时的初值。
  const [devDebugVisible, setDevDebugVisible] = useState(() => isDevDebugAvailable());
  useEffect(() => subscribeDevDebugAvailability(setDevDebugVisible), []);
  const availableGridApps = useMemo(() => {
    return INSTALLED_APPS.filter(app =>
      !DOCK_APPS.includes(app.id)
      // 「捏脸·开发」仅在开发模式（右下角开发徽标可见或手动解锁时）显示
      && (app.id !== AppID.CharCreatorDev || devDebugVisible)
    );
  }, [devDebugVisible]);

  const normalizeOrder = useCallback((saved: string[] | undefined, available: string[]) => {
      const valid = new Set(available);
      return [...(saved || []).filter((id, index, all) => valid.has(id) && all.indexOf(id) === index), ...available.filter(id => !(saved || []).includes(id))];
  }, []);

  const folders = useMemo(() => normalizeLauncherFolders(theme.launcherFolders, availableGridApps.map(app => app.id)), [theme.launcherFolders, availableGridApps]);
  const utilityWidgetEnabled = theme.launcherUtilityWidgetEnabled !== false;
  const availableGridIds = useMemo(() => [
      ...rootLauncherIds(availableGridApps.map(app => app.id), folders),
      ...(utilityWidgetEnabled ? [UTILITY_WIDGET_ID] : []),
  ], [availableGridApps, folders, utilityWidgetEnabled]);
  const [launcherAppOrder, setLauncherAppOrder] = useState<string[]>(() => normalizeOrder(theme.launcherAppOrder, availableGridIds));
  const [launcherDockOrder, setLauncherDockOrder] = useState<string[]>(() => normalizeOrder(theme.launcherDockOrder, DOCK_APPS));
  const launcherAppOrderRef = useRef(launcherAppOrder);
  const launcherDockOrderRef = useRef(launcherDockOrder);

  useEffect(() => {
      setLauncherAppOrder(prev => {
          const next = normalizeOrder(prev.length ? prev : theme.launcherAppOrder, availableGridIds);
          launcherAppOrderRef.current = next;
          return next;
      });
  }, [availableGridIds, normalizeOrder, theme.launcherAppOrder]);
  useEffect(() => { launcherAppOrderRef.current = launcherAppOrder; }, [launcherAppOrder]);
  useEffect(() => { launcherDockOrderRef.current = launcherDockOrder; }, [launcherDockOrder]);
  useEffect(() => {
      if (layoutEditing) return;
      const next = normalizeOrder(theme.launcherDockOrder, DOCK_APPS);
      launcherDockOrderRef.current = next;
      setLauncherDockOrder(next);
  }, [layoutEditing, normalizeOrder, theme.launcherDockOrder]);

  const gridItems = useMemo(() => {
      const byId = new Map(availableGridApps.map(app => [app.id, app]));
      const folderById = new Map(folders.map(folder => [folder.id, folder]));
      return launcherAppOrder.flatMap((id): LauncherGridItem[] => {
          if (id === UTILITY_WIDGET_ID && utilityWidgetEnabled) return [{ kind: 'widget' }];
          const folder = folderById.get(id);
          if (folder) return [{ kind: 'folder', folder }];
          const app = byId.get(id as AppID);
          return app && availableGridIds.includes(id) ? [{ kind: 'app', app }] : [];
      });
  }, [availableGridApps, availableGridIds, folders, launcherAppOrder, utilityWidgetEnabled]);

  // The original clock home stays a fixed composition; later pages remain movable.
  const fixedHomeItems = useMemo(() => gridItems.filter((item): item is Extract<LauncherGridItem, { kind: 'app' | 'folder' }> => item.kind !== 'widget').slice(0, 12), [gridItems]);
  const fixedHomeIds = useMemo(() => new Set(fixedHomeItems.map(item => item.kind === 'app' ? item.app.id : item.folder.id)), [fixedHomeItems]);

  // [EM-START: free-launcher-layout] Every desktop tile uses the same saved 4-column grid.
  const desktopIds = useMemo(() => [
      DESKTOP_WIDGET_IDS.schedule,
      DESKTOP_WIDGET_IDS.music, DESKTOP_WIDGET_IDS.image,
      ...availableGridIds.filter(id => !fixedHomeIds.has(id)),
      ...(['tl', 'tr', 'wide'] as const).filter(slot => !!theme.launcherWidgets?.[slot]).map(slot => `widget:image:${slot}`),
  ], [availableGridIds, fixedHomeIds, theme.launcherWidgets]);
  const desktopDefaults = useMemo(() => {
      const defaults = defaultDesktopLayout(launcherAppOrder, utilityWidgetEnabled, theme.launcherPinwheelOrder);
      delete defaults[DESKTOP_WIDGET_IDS.clock];
      delete defaults[DESKTOP_WIDGET_IDS.character];
      delete defaults[DESKTOP_WIDGET_IDS.agenda];
      for (const id of fixedHomeIds) delete defaults[id];
      defaults['widget:image:tl'] = { page: 3, row: 0, col: 0 };
      defaults['widget:image:tr'] = { page: 3, row: 0, col: 2 };
      defaults['widget:image:wide'] = { page: 3, row: 2, col: 0 };
      return defaults;
  }, [launcherAppOrder, utilityWidgetEnabled, theme.launcherPinwheelOrder, fixedHomeIds]);
  const savedFreeLayout = useMemo(() => Object.fromEntries(Object.entries(theme.launcherDesktopLayout || {}).filter(([, position]) => position.page >= 2)) as DesktopLayout, [theme.launcherDesktopLayout]);
  const [desktopLayout, setDesktopLayout] = useState<DesktopLayout>(() => normalizeDesktopLayout(desktopIds, savedFreeLayout, desktopDefaults));
  const desktopLayoutRef = useRef(desktopLayout);
  useEffect(() => {
      const next = normalizeDesktopLayout(desktopIds, theme.launcherDesktopLayout ? savedFreeLayout : desktopLayoutRef.current, desktopDefaults);
      desktopLayoutRef.current = next;
      setDesktopLayout(next);
  }, [desktopIds, desktopDefaults, theme.launcherDesktopLayout, savedFreeLayout]);
  useEffect(() => { desktopLayoutRef.current = desktopLayout; }, [desktopLayout]);
  const desktopItemById = useMemo(() => new Map(gridItems.map(item => [item.kind === 'app' ? item.app.id : item.kind === 'folder' ? item.folder.id : UTILITY_WIDGET_ID, item])), [gridItems]);
  const desktopPages = desktopPageCount(desktopLayout);
  // [EM-END: free-launcher-layout]

  const dockAppsConfig = useMemo(() => {
      const byId = new Map(INSTALLED_APPS.map(app => [app.id, app]));
      return launcherDockOrder.map(id => byId.get(id as AppID)).filter(Boolean) as typeof INSTALLED_APPS;
  }, [launcherDockOrder]);

  const totalPages = desktopPages;

  useEffect(() => { activePageIndexRef.current = activePageIndex; }, [activePageIndex]);

  useEffect(() => {
      const loadData = async () => {
          // SAFEGUARD: If characters array is empty, reset widget char
          if (!characters || characters.length === 0) {
              setWidgetChar(null);
              setLastMessage('No Character Connected');
              setAnniversaries([]);
              return;
          }

          const targetChar = characters.find(c => c.id === activeCharacterId) || characters[0];
          setWidgetChar(targetChar);

          try {
              const [msgs, annis] = await Promise.all([
                  DB.getMessagesByCharId(targetChar.id),
                  DB.getAllAnniversaries()
              ]);
              
              if (msgs.length > 0) {
                  const visibleMsgs = msgs.filter(isChatPreviewMessage);
                  if (visibleMsgs.length > 0) {
                      const last = visibleMsgs[visibleMsgs.length - 1];
                      const cleanContent = last.content.replace(/\[.*?\]/g, '').trim();
                      setLastMessage(cleanContent || (last.type === 'image' ? '[图片]' : '[消息]'));
                  } else {
                      setLastMessage(targetChar.description || "System Ready.");
                  }
              } else {
                  setLastMessage(targetChar.description || "System Ready.");
              }
              setAnniversaries(annis);
          } catch (e) {
              console.error(e);
          }
      };
      
      if (isDataLoaded) {
          loadData();
      }
  }, [activeCharacterId, lastMsgTimestamp, isDataLoaded, characters]); // Trigger on characters change

  // Schedule widget data loading (shown below SpecialMoments icon)
  const scheduleChar = useMemo(() => {
      if (!characters || characters.length === 0) return null;
      if (scheduleCharId) return characters.find(c => c.id === scheduleCharId) || characters[0];
      return characters.find(c => c.id === activeCharacterId) || characters[0];
  }, [characters, scheduleCharId, activeCharacterId]);
  const scheduleDateKey = useLocalDateKey(resolveCharTimeZone(scheduleChar));

  useEffect(() => {
      if (!scheduleChar || !isDataLoaded) return;
      getDailyScheduleForChar(scheduleChar).then(s => setScheduleData(s)).catch(() => {});
  }, [scheduleChar, isDataLoaded, scheduleDateKey]);

  // Restore scroll position BEFORE paint to avoid visible flash/slide
  useLayoutEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      el.style.scrollBehavior = 'auto';
      el.style.scrollSnapType = 'none';
      const frame = requestAnimationFrame(() => {
          const index = Math.min(initialPageRef.current, Math.max(0, el.children.length - 1));
          el.scrollLeft = el.clientWidth * index;
          requestAnimationFrame(() => {
              el.style.scrollSnapType = 'x mandatory';
              el.style.scrollBehavior = 'smooth';
              initialPageReadyRef.current = true;
              activePageIndexRef.current = index;
              setActivePageIndex(index);
          });
      });
      return () => cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = () => {
      if (initialPageReadyRef.current && scrollContainerRef.current) {
          const width = scrollContainerRef.current.clientWidth;
          const scrollLeft = scrollContainerRef.current.scrollLeft;
          const index = Math.round(scrollLeft / width);
          setActivePageIndex(index);
          activePageIndexRef.current = index;
          _lastPageIndex = index; // Persist across remounts
      }
  };

  // --- Mouse Drag Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
      if (!scrollContainerRef.current || layoutEditing) return;
      isDragging.current = true;
      dragMoved.current = 0;
      startX.current = e.pageX - scrollContainerRef.current.offsetLeft;
      scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
      
      // Disable snap and smooth scroll for direct control
      scrollContainerRef.current.style.scrollBehavior = 'auto';
      scrollContainerRef.current.style.scrollSnapType = 'none';
      scrollContainerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (layoutEditing || !isDragging.current || !scrollContainerRef.current) return;
      e.preventDefault();
      const x = e.pageX - scrollContainerRef.current.offsetLeft;
      const walk = (x - startX.current);
      scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
      
      dragMoved.current = Math.abs(x - (startX.current + scrollContainerRef.current.offsetLeft)); 
  };

  const handleMouseUp = () => {
      if (!isDragging.current || !scrollContainerRef.current) return;
      isDragging.current = false;
      
      // Restore styles
      scrollContainerRef.current.style.scrollBehavior = 'smooth';
      scrollContainerRef.current.style.scrollSnapType = 'x mandatory';
      scrollContainerRef.current.style.cursor = 'grab';
  };

  const handleMouseLeave = () => {
      if (isDragging.current) handleMouseUp();
  };

  const handleClickCapture = (e: React.MouseEvent) => {
      if (dragMoved.current > 5 || Date.now() < suppressLayoutClickUntil.current) {
          e.stopPropagation();
          e.preventDefault();
      }
  };

  const reorderByTarget = useCallback((kind: string, source: string, target: string) => {
      if (source === target) return;
      const reorder = <T extends string>(items: T[]) => {
          const from = items.indexOf(source as T);
          const to = items.indexOf(target as T);
          if (from < 0 || to < 0) return items;
          const next = [...items];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
      };
      if (kind === 'dock') {
          const next = reorder(launcherDockOrderRef.current);
          launcherDockOrderRef.current = next;
          setLauncherDockOrder(next);
      }
  }, []);

  const clearLayoutPressTimer = useCallback(() => {
      if (layoutPressTimer.current) clearTimeout(layoutPressTimer.current);
      layoutPressTimer.current = null;
  }, []);

  const clearLayoutPageTurn = useCallback(() => {
      if (layoutPageTurnTimer.current) clearTimeout(layoutPageTurnTimer.current);
      layoutPageTurnTimer.current = null;
      layoutPageTurnDirection.current = 0;
  }, []);

  const activateLayoutDrag = useCallback((pointer: NonNullable<typeof layoutPointer.current>) => {
      if (pointer.ghost) return;
      const rect = pointer.element.getBoundingClientRect();
      const ghost = pointer.kind === 'desktop' && pointer.key.startsWith('widget:')
          ? document.createElement('div') : pointer.element.cloneNode(true) as HTMLElement;
      if (pointer.kind === 'desktop' && pointer.key.startsWith('widget:')) {
          ghost.textContent = pointer.element.dataset.launcherLabel || '小组件';
          ghost.className = 'flex items-center justify-center text-sm font-semibold';
          ghost.style.background = F.surface;
          ghost.style.border = `1px solid ${F.borderSoft}`;
          ghost.style.borderRadius = `${R.bigCard}px`;
          ghost.style.boxShadow = S.raisedSoft;
      }
      ghost.removeAttribute('data-launcher-item');
      ghost.removeAttribute('data-launcher-kind');
      ghost.classList.remove('launcher-edit-item', 'launcher-drop-target');
      ghost.classList.add('launcher-drag-ghost');
      Object.assign(ghost.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: '0',
          pointerEvents: 'none',
          zIndex: '9999',
          transform: `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1.055)`,
          transformOrigin: 'center',
          transition: 'none',
      });
      document.body.appendChild(ghost);
      pointer.ghost = ghost;
      if (pointer.kind === 'desktop') pointer.originLayout = desktopLayoutRef.current;
      pointer.grabOffsetX = pointer.x - rect.left;
      pointer.grabOffsetY = pointer.y - rect.top;
      pointer.element.classList.add('launcher-dragging');
      pointer.element.style.pointerEvents = 'none';
  }, []);

  const queueLayoutPageTurn = useCallback((direction: -1 | 1) => {
      if (layoutPageTurnDirection.current === direction && layoutPageTurnTimer.current) return;
      clearLayoutPageTurn();
      layoutPageTurnDirection.current = direction;
      const turn = () => {
          const pointer = layoutPointer.current;
          const scroller = scrollContainerRef.current;
          if (!pointer?.active || pointer.kind !== 'desktop' || !scroller || layoutPageTurnDirection.current !== direction) {
              clearLayoutPageTurn();
              return;
          }
          const maxAppPage = Math.max(0, desktopPages - 1);
          const nextPage = Math.max(0, Math.min(maxAppPage, activePageIndexRef.current + direction));
          if (nextPage === activePageIndexRef.current) {
              clearLayoutPageTurn();
              return;
          }
          pointer.targetElement?.classList.remove('launcher-drop-target');
          pointer.targetElement = undefined;
          pointer.lastTarget = undefined;
          activePageIndexRef.current = nextPage;
          setActivePageIndex(nextPage);
          _lastPageIndex = nextPage;
          scroller.scrollTo({ left: scroller.clientWidth * nextPage, behavior: 'smooth' });
          layoutPageTurnTimer.current = setTimeout(turn, 760);
      };
      layoutPageTurnTimer.current = setTimeout(turn, 560);
  }, [desktopPages, clearLayoutPageTurn]);

  useEffect(() => () => {
      clearLayoutPressTimer();
      clearLayoutPageTurn();
      layoutPointer.current?.ghost?.remove();
  }, [clearLayoutPageTurn, clearLayoutPressTimer]);

  const handleLayoutPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const launcherRoot = e.currentTarget;
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-launcher-item]');
      if (!item) return;
      const key = item.dataset.launcherItem;
      const kind = item.dataset.launcherKind;
      if (!key || !kind) return;
      clearLayoutPressTimer();
      if (kind === 'fixed') {
          if (layoutEditing) return;
          layoutPointer.current = { pointerId: e.pointerId, key, kind, x: e.clientX, y: e.clientY, active: false, element: item };
          layoutPressTimer.current = setTimeout(() => {
              if (layoutPointer.current?.pointerId !== e.pointerId) return;
              suppressLayoutClickUntil.current = Date.now() + 700;
              setLayoutEditing(true);
              layoutPointer.current = null;
          }, 520);
          return;
      }
      layoutPointer.current = { pointerId: e.pointerId, key, kind, x: e.clientX, y: e.clientY, active: layoutEditing, element: item };
      if (layoutEditing) {
          activateLayoutDrag(layoutPointer.current);
          launcherRoot.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
      }
      layoutPressTimer.current = setTimeout(() => {
          if (!layoutPointer.current || layoutPointer.current.pointerId !== e.pointerId) return;
          layoutPointer.current.active = true;
          activateLayoutDrag(layoutPointer.current);
          launcherRoot.setPointerCapture(e.pointerId);
          isDragging.current = false;
          suppressLayoutClickUntil.current = Date.now() + 700;
          setLayoutEditing(true);
      }, 520);
  };

  const handleLayoutPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const pointer = layoutPointer.current;
      if (!pointer || pointer.pointerId !== e.pointerId) return;
      if (!pointer.active) {
          if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 9) {
              clearLayoutPressTimer();
              layoutPointer.current = null;
          }
          return;
      }
      e.preventDefault();
      if (pointer.ghost) {
          pointer.ghost.style.transform = `translate3d(${e.clientX - (pointer.grabOffsetX || 0)}px, ${e.clientY - (pointer.grabOffsetY || 0)}px, 0) scale(1.055)`;
      }
      const rootRect = e.currentTarget.getBoundingClientRect();
      if (pointer.kind === 'desktop' && e.clientX <= rootRect.left + 40) queueLayoutPageTurn(-1);
      else if (pointer.kind === 'desktop' && e.clientX >= rootRect.right - 40) queueLayoutPageTurn(1);
      else clearLayoutPageTurn();
      if (pointer.kind === 'desktop') {
          const grid = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-desktop-page]');
          if (!grid || !pointer.originLayout) return;
          const rect = grid.getBoundingClientRect();
          const size = desktopItemSize(pointer.key);
          const page = Number(grid.dataset.desktopPage);
          const col = Math.min(DESKTOP_COLUMNS - size.cols, Math.max(0, Math.floor((e.clientX - rect.left) / (rect.width / DESKTOP_COLUMNS))));
          const styles = getComputedStyle(grid);
          const tracks = styles.gridTemplateRows.split(' ').map(value => Number.parseFloat(value));
          const gap = Number.parseFloat(styles.rowGap) || 0;
          let row = 0;
          let rowBottom = 0;
          while (row < DESKTOP_ROWS - 1 && e.clientY - rect.top >= (rowBottom += (tracks[row] || rect.height / DESKTOP_ROWS) + gap)) row++;
          row = Math.min(DESKTOP_ROWS - size.rows, row);
          const cell = `${page}:${row}:${col}`;
          if (cell === pointer.lastCell) return;
          pointer.lastCell = cell;
          const next = moveDesktopItem(pointer.originLayout, pointer.key, { page, row, col });
          desktopLayoutRef.current = next;
          setDesktopLayout(next);
          return;
      }
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-launcher-item]');
      const targetKey = target?.dataset.launcherItem;
      const targetKind = target?.dataset.launcherKind;
      const validTarget = !!targetKey && targetKind === pointer.kind && targetKey !== pointer.key;
      if (!validTarget) {
          pointer.targetElement?.classList.remove('launcher-drop-target');
          pointer.targetElement = undefined;
          pointer.lastTarget = undefined;
          return;
      }
      if (target === pointer.targetElement) return;
      pointer.targetElement?.classList.remove('launcher-drop-target');
      target?.classList.add('launcher-drop-target');
      pointer.targetElement = target;
      pointer.lastTarget = targetKey;
  };

  const finishLayoutPointer = (e?: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
      const pointer = layoutPointer.current;
      if (e && pointer && pointer.pointerId !== e.pointerId) return;
      clearLayoutPressTimer();
      clearLayoutPageTurn();
      if (pointer?.active) {
          suppressLayoutClickUntil.current = Date.now() + 500;
          pointer.element.style.pointerEvents = '';
          pointer.element.classList.remove('launcher-dragging');
          pointer.ghost?.remove();
          pointer.targetElement?.classList.remove('launcher-drop-target');
          if (pointer.kind === 'desktop') {
              if (cancelled && pointer.originLayout) {
                  desktopLayoutRef.current = pointer.originLayout;
                  setDesktopLayout(pointer.originLayout);
              } else void updateTheme({ launcherDesktopLayout: desktopLayoutRef.current });
          } else {
              if (!cancelled && pointer.lastTarget) reorderByTarget(pointer.kind, pointer.key, pointer.lastTarget);
              if (!cancelled) void updateTheme({ launcherDockOrder: launcherDockOrderRef.current });
          }
      }
      layoutPointer.current = null;
  };

  const finishLayoutEditing = () => {
      finishLayoutPointer();
      setLayoutEditing(false);
  };

  const restoreDefaultDesktopLayout = () => {
      const next = normalizeDesktopLayout(desktopIds, undefined, desktopDefaults);
      desktopLayoutRef.current = next;
      setDesktopLayout(next);
      void updateTheme({ launcherDesktopLayout: next });
  };

  // [EM-START: launcher-folders] Keep folders in the theme backup alongside icon order.
  const activeFolder = folders.find(folder => folder.id === openFolderId);
  const folderBeingEdited = folders.find(folder => folder.id === editingFolderId);
  const editorApps = availableGridApps.filter(app => !folders.some(folder => folder.id !== editingFolderId && folder.appIds.includes(app.id)));
  const saveFolder = (name: string, appIds: AppID[]) => {
      const id = folderBeingEdited?.id || `folder:${crypto.randomUUID()}`;
      const nextFolders = normalizeLauncherFolders(
          folderBeingEdited
              ? folders.map(folder => folder.id === id ? { id, name, appIds } : folder)
              : [...folders, { id, name, appIds }],
          availableGridApps.map(app => app.id),
      );
      const nextRootIds = [...rootLauncherIds(availableGridApps.map(app => app.id), nextFolders), ...(utilityWidgetEnabled ? [UTILITY_WIDGET_ID] : [])];
      const oldOrder = launcherAppOrderRef.current;
      const firstMemberIndex = Math.min(...appIds.map(appId => oldOrder.indexOf(appId)).filter(index => index >= 0));
      const candidate = oldOrder.filter(item => !appIds.includes(item as AppID));
      if (!folderBeingEdited && Number.isFinite(firstMemberIndex)) candidate.splice(Math.min(firstMemberIndex, candidate.length), 0, id);
      const nextOrder = normalizeOrder(candidate, nextRootIds);
      launcherAppOrderRef.current = nextOrder;
      setLauncherAppOrder(nextOrder);
      void updateTheme({ launcherFolders: nextFolders, launcherAppOrder: nextOrder });
      setOpenFolderId(id);
      setEditingFolderId(null);
      setLayoutEditing(false);
  };
  const deleteFolder = () => {
      if (!folderBeingEdited) return;
      const nextFolders = folders.filter(folder => folder.id !== folderBeingEdited.id);
      const nextOrder = normalizeOrder(
          launcherAppOrderRef.current.filter(id => id !== folderBeingEdited.id),
          [...rootLauncherIds(availableGridApps.map(app => app.id), nextFolders), ...(utilityWidgetEnabled ? [UTILITY_WIDGET_ID] : [])],
      );
      launcherAppOrderRef.current = nextOrder;
      setLauncherAppOrder(nextOrder);
      void updateTheme({ launcherFolders: nextFolders, launcherAppOrder: nextOrder });
      setOpenFolderId(null);
      setEditingFolderId(null);
  };
  // [EM-END: launcher-folders]

  // [EM-START: launcher-utility-widget] One movable widget with three manually switched views.
  const addUtilityWidget = () => {
      const next = [...launcherAppOrderRef.current.filter(id => id !== UTILITY_WIDGET_ID), UTILITY_WIDGET_ID];
      launcherAppOrderRef.current = next;
      setLauncherAppOrder(next);
      void updateTheme({ launcherUtilityWidgetEnabled: true, launcherAppOrder: next });
  };
  const removeUtilityWidget = () => {
      const next = launcherAppOrderRef.current.filter(id => id !== UTILITY_WIDGET_ID);
      launcherAppOrderRef.current = next;
      setLauncherAppOrder(next);
      void updateTheme({ launcherUtilityWidgetEnabled: false, launcherAppOrder: next });
  };
  // [EM-END: launcher-utility-widget]

  const contentColor = theme.contentColor || '#ffffff';
  const acnh = theme.skin === 'animalcrossing'; // 动森彩蛋：Dock 换奶油木质底
  const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);
  // 已迁移 App 外壳已收回到可见 viewport 底边，dock 仅需自留视觉间距，无需再 + safe-bottom
  // （否则会比 home 条上方多让 34px，dock 看起来悬空）。
  const launcherBottomInset = '1.25rem';
  
  const totalUnread = Object.values(unreadMessages).reduce((a, b) => a + b, 0);
  const widgetUnread = widgetChar && unreadMessages[widgetChar.id] ? unreadMessages[widgetChar.id] : 0;

  // 手游主题：整页换成二次元手游首页布局（独立组件自渲染），不走下面的默认/动森启动器。
  if (theme.skin === 'mobilegame') {
    return <MobileGameHome />;
  }

  // 电子宠物主题：桌面即养成机——角色真实小屋做舞台 + 四颗糖果实体键（独立组件自渲染）。
  if (theme.skin === 'tamagotchi') {
    return <TamagotchiHome />;
  }

  if (theme.skin === 'companion') {
    return (
      <React.Suspense fallback={<div className="h-full w-full bg-[#100d1c]" />}>
        <CompanionHome />
      </React.Suspense>
    );
  }

  return (
    <div
      className="h-full w-full flex flex-col relative z-10 overflow-hidden font-sans select-none"
      onPointerDown={handleLayoutPointerDown}
      onPointerMove={handleLayoutPointerMove}
      onPointerUp={finishLayoutPointer}
      onPointerCancel={event => finishLayoutPointer(event, true)}
      onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-launcher-item]')) {
              e.preventDefault();
              setLayoutEditing(true);
          }
      }}
    >
      <style>{`
        .launcher-edit-item {
          touch-action: none;
          cursor: grab;
          transition: transform 180ms cubic-bezier(.2,.75,.25,1), opacity 150ms ease, filter 150ms ease;
          will-change: transform;
        }
        .launcher-dragging {
          cursor: grabbing;
          opacity: .18;
        }
        .launcher-drag-ghost {
          opacity: .96;
          filter: drop-shadow(0 12px 14px rgba(75,65,54,.18));
          cursor: grabbing;
        }
        .launcher-drop-target {
          transform: scale(.93);
          opacity: .52;
          outline: 1.5px dashed rgba(75,65,54,.36);
          outline-offset: 5px;
          border-radius: 1.35rem;
        }
      `}</style>

      {layoutEditing && (
          <div className="absolute top-[calc(var(--safe-top)+0.65rem)] left-4 right-4 z-50 flex items-center justify-between rounded-full px-3 py-2"
              style={{ background: 'rgba(75,65,54,0.88)', color: '#fffdf8', boxShadow: '0 8px 24px rgba(75,65,54,0.20)' }}>
              <span className="text-[10px] font-semibold tracking-wide">拖动调整位置</span>
              <div className="flex items-center gap-2">
                {!utilityWidgetEnabled && <button onClick={addUtilityWidget} className="px-2 py-1 rounded-full text-[10px] font-bold bg-white/15">添加小组件</button>}
                <button onClick={restoreDefaultDesktopLayout} className="px-2 py-1 rounded-full text-[10px] font-bold bg-white/15">恢复默认</button>
                <button onClick={() => setEditingFolderId('new')} className="px-2 py-1 rounded-full text-[10px] font-bold bg-white/15">新建文件夹</button>
                <button onClick={finishLayoutEditing} className="px-3 py-1 rounded-full text-[10px] font-bold bg-white/15 active:scale-95">完成</button>
              </div>
          </div>
      )}
      
      {/* Visual Elements (Decorative Background - Static, low-cost gradients instead of blur) */}
      {/* 动森模式跳过：这层冷蓝光斑会污染奶油底 */}
      {!acnh && (
      <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full" style={{ background: paper ? 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, transparent 68%)' : 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%)' }}></div>
          <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full" style={{ background: paper ? 'radial-gradient(circle, rgba(123,104,78,0.06) 0%, transparent 68%)' : 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }}></div>
      </div>
      )}

      {/* Scrollable Content Layer */}
      {/* UPDATE: Added snap-always to children to ensure one-page-at-a-time scrolling on mobile swipe */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClickCapture={handleClickCapture}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory no-scrollbar cursor-grab active:cursor-grabbing"
        style={{
            scrollBehavior: 'smooth',
            overscrollBehaviorX: 'contain',
            overscrollBehaviorY: 'none',
            touchAction: layoutEditing ? 'none' : 'pan-x pan-y',
            willChange: 'scroll-position',
            contain: 'layout paint',
            transform: 'translateZ(0)',
            WebkitOverflowScrolling: 'touch',
        }}
      >
          {/* [EM-START: free-launcher-layout] Fixed clock home, with free grids on the other pages. */}
          {Array.from({ length: desktopPages }, (_, idx) => (
              <div
                key={idx}
                className={`w-full flex-shrink-0 snap-center snap-always flex flex-col h-full overflow-y-auto no-scrollbar ${idx === 0 ? 'px-5 py-8' : idx === 1 ? 'px-6 pt-12 pb-8' : 'px-5 py-8'}`}
                style={{ contentVisibility: 'auto', contain: 'layout paint', transform: 'translateZ(0)', containerType: idx === 0 || idx >= 1 ? 'inline-size' : undefined }}
              >
                  {idx === 0 ? <div className="w-full flex-none my-auto" style={{ height: FREE_PAGE_HEIGHT }}><WidgetsPage contentColor={contentColor} openApp={openApp} anniversaries={anniversaries} characters={characters}
                    acnh={acnh} paper={paper} /></div> : idx === 1 ? <div className="w-full flex-1 flex flex-col" style={{ '--launcher-cell': 'calc((100cqw - 30px) / 4)' } as React.CSSProperties}>
                    <div className="w-full flex-none flex items-center" style={{ height: 'calc(2 * var(--launcher-cell) + 18px)' }}>
                      <DesktopClock />
                    </div>
                    <CharacterWidget char={widgetChar} unreadCount={widgetUnread} lastMessage={lastMessage}
                      onClick={() => { if (!layoutEditing) openApp(AppID.Chat); }} contentColor={contentColor} paper={paper} />
                    <div className="flex-1 grid grid-cols-4 auto-rows-[4.5rem] place-items-center gap-x-2 gap-y-6 animate-fade-in relative">
                    {fixedHomeItems.map(item => {
                      const id = item.kind === 'app' ? item.app.id : item.folder.id;
                      return <div key={id} data-launcher-item={id} data-launcher-kind="fixed" className="min-w-0 flex items-center justify-center">
                        {item.kind === 'app' ? <AppIcon app={item.app} onClick={() => { if (!layoutEditing) openApp(item.app.id); }} size="md" />
                          : <LauncherFolderIcon folder={item.folder} onOpen={() => { if (!layoutEditing) setOpenFolderId(item.folder.id); }} />}
                      </div>;
                    })}
                    </div>
                  </div> : <div data-desktop-page={idx} className="relative grid w-full flex-none my-auto gap-x-2.5 gap-y-[18px]"
                       style={{ '--launcher-cell': 'calc((100cqw - 30px) / 4)', gridTemplateColumns: `repeat(${DESKTOP_COLUMNS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${DESKTOP_ROWS}, var(--launcher-cell))` } as React.CSSProperties}>
                    {Object.entries(desktopLayout).filter(([, position]) => position.page === idx).map(([id, position]) => {
                      const size = desktopItemSize(id);
                      const item = desktopItemById.get(id);
                      const imageSlot = id.startsWith('widget:image:') ? id.slice('widget:image:'.length) : null;
                      const label = item?.kind === 'app' ? item.app.name : item?.kind === 'folder' ? item.folder.name
                        : ({ [DESKTOP_WIDGET_IDS.agenda]: '月历与近期事件', [DESKTOP_WIDGET_IDS.clock]: '时钟', [DESKTOP_WIDGET_IDS.character]: '聊天', [DESKTOP_WIDGET_IDS.schedule]: '日程', [DESKTOP_WIDGET_IDS.music]: '音乐', [DESKTOP_WIDGET_IDS.image]: '图片', [DESKTOP_WIDGET_IDS.utilities]: '功能小组件' } as Record<string, string>)[id] || '图片';
                      return <div key={id} data-launcher-item={id} data-launcher-kind="desktop" data-launcher-label={label}
                        className={`relative min-w-0 min-h-0 ${size.cols === 1 ? 'flex items-center justify-center' : size.rows === 2 ? 'flex items-center' : ''} ${layoutEditing ? 'launcher-edit-item' : ''}`}
                        style={{ gridColumn: `${position.col + 1} / span ${size.cols}`, gridRow: `${position.row + 1} / span ${size.rows}` }}>
                        {item?.kind === 'app' ? <AppIcon app={item.app} onClick={() => { if (!layoutEditing) openApp(item.app.id); }} size="md" />
                          : item?.kind === 'folder' ? <LauncherFolderIcon folder={item.folder} onOpen={() => { if (!layoutEditing) setOpenFolderId(item.folder.id); }} />
                          : id === DESKTOP_WIDGET_IDS.clock ? <DesktopClock />
                          : id === DESKTOP_WIDGET_IDS.character ? <CharacterWidget char={widgetChar} unreadCount={widgetUnread} lastMessage={lastMessage}
                              onClick={() => { if (!layoutEditing) openApp(AppID.Chat); }} contentColor={contentColor} paper={paper} />
                          : id === DESKTOP_WIDGET_IDS.schedule ? scheduleChar && <div className="w-full px-[5px]" style={{ height: `calc(${FREE_TWO_CELL_HEIGHT} - ${SP[1]}px)`, marginTop: SP[1] }}><ScheduleHomeWidget schedule={scheduleData} character={scheduleChar} contentColor={contentColor}
                              onOpen={() => { if (!layoutEditing) setScheduleViewerOpen(true); }} acnh={acnh} paper={paper} /></div>
                          : id === DESKTOP_WIDGET_IDS.music ? <div className="w-full" style={{ height: FREE_TWO_CELL_HEIGHT }}><NowPlayingSquareWidget contentColor={contentColor} /></div>
                          : id === DESKTOP_WIDGET_IDS.image ? <div className="w-full" style={{ height: FREE_TWO_CELL_HEIGHT }}><DesktopSquareImage image={theme.launcherWidgets?.dsq} contentColor={contentColor}
                              onClick={() => { if (!layoutEditing) openApp(AppID.Appearance); }} acnh={acnh} /></div>
                          : id === DESKTOP_WIDGET_IDS.utilities ? <div className="w-full px-[5px]" style={{ height: FREE_TWO_CELL_HEIGHT }}><LauncherWidgetStack /></div>
                          : imageSlot && theme.launcherWidgets?.[imageSlot] ? <div className={`${imageSlot === 'wide' ? 'mx-[5px]' : 'w-full'} overflow-hidden`} style={{ height: FREE_TWO_CELL_HEIGHT, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
                              <TokenImg value={theme.launcherWidgets[imageSlot]} className="w-full h-full object-cover" alt="" loading="lazy" />
                            </div> : null}
                        {id === DESKTOP_WIDGET_IDS.utilities && layoutEditing && <button type="button" aria-label="移除小组件"
                          onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); removeUtilityWidget(); }}
                          className="absolute -top-2 -left-2 z-20 w-8 h-8 flex items-center justify-center"
                          style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.pill, boxShadow: S.raisedSoft }}><X size={16} weight="bold" /></button>}
                      </div>;
                    })}
                    {idx === 2 && theme.desktopDecorations?.map(deco => <img key={deco.id} src={deco.content} alt="" loading="lazy"
                      className="absolute w-16 h-16 object-contain pointer-events-none" style={{ left: `${deco.x}%`, top: `${deco.y}%`,
                        transform: `translate(-50%, -50%) scale(${deco.scale}) rotate(${deco.rotation}deg)${deco.flip ? ' scaleX(-1)' : ''}`,
                        opacity: deco.opacity, zIndex: deco.zIndex }} />)}
                  </div>}
              </div>
          ))}
          {/* [EM-END: free-launcher-layout] */}

      </div>

      {/* Page Indicators */}
      <div
          className="absolute left-0 w-full flex justify-center gap-2 pointer-events-none z-20"
          style={{ bottom: `calc(${launcherBottomInset} + 5.5rem)` }}
      >
          {Array.from({ length: totalPages }).map((_, i) => (
              <div 
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${activePageIndex === i ? 'w-4 opacity-100' : 'w-1.5 opacity-40'}`} 
                style={{ backgroundColor: contentColor }}
              ></div>
          ))}
      </div>

      {/* Floating Dock - Updated Margin and Safe Area handling */}
      <div
           className="mt-auto flex justify-center w-full px-4 relative z-30"
           style={{ paddingBottom: launcherBottomInset }}
      >
           <div
             className={`rounded-[1.75rem] px-4 py-3 flex gap-3 sm:gap-6 items-center mx-auto max-w-full justify-between overflow-x-auto no-scrollbar transform-gpu ${acnh || paper ? '' : 'bg-white/30 border border-white/25 shadow-[0_8px_40px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]'}`}
             style={acnh ? { background: 'transparent' } : paper ? {
               background: 'rgba(224,221,215,0.42)',
               border: '1px solid rgba(91,72,51,0.07)',
               boxShadow: '0 6px 18px rgba(91,72,51,0.065)',
             } : undefined}
           >
               {dockAppsConfig.map(app => (
                   <div key={app.id} data-launcher-item={app.id} data-launcher-kind="dock" className={`relative ${layoutEditing ? 'launcher-edit-item' : ''}`}>
                        <AppIcon app={app} onClick={() => { if (!layoutEditing) openApp(app.id); }} variant="dock" size="md" />
                        {app.id === 'chat' && totalUnread > 0 && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-[9px] flex items-center justify-center border-2 border-white/20 shadow-sm font-bold pointer-events-none animate-pop-in">
                                {totalUnread > 9 ? '9+' : totalUnread}
                            </div>
                        )}
                   </div>
               ))}
           </div>
      </div>

      <ScheduleFullscreenViewer
          open={scheduleViewerOpen}
          onClose={() => setScheduleViewerOpen(false)}
          characters={characters}
          activeCharId={scheduleChar?.id || null}
          onSwitchCharacter={(id) => setScheduleCharId(id)}
          schedule={scheduleData}
          activeCharacter={scheduleChar}
          contentColor={contentColor}
      />

      {activeFolder && !editingFolderId && <LauncherFolderPanel folder={activeFolder} onClose={() => setOpenFolderId(null)}
        onOpenApp={id => { setOpenFolderId(null); openApp(id); }} onEdit={() => setEditingFolderId(activeFolder.id)} />}
      {editingFolderId && <LauncherFolderEditor key={editingFolderId} folder={folderBeingEdited} availableApps={editorApps}
        onClose={() => setEditingFolderId(null)} onSave={saveFolder} onDelete={folderBeingEdited ? deleteFolder : undefined} />}

    </div>
  );
};

export default Launcher;
