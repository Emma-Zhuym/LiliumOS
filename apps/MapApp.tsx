/**
 * MapApp.tsx — 地图×日程（Clay 版 v4）
 *
 * EM 独有功能。角色按日程 slot.location 在自定义地图上移动。
 * 世界配置存 IndexedDB，用户可增删改，每个区域可在地图上手动选位置。
 *
 * UI 按 2026-07-09 design handoff（design_prototype/mapsystem/mapnew）重建：
 * 暖白 Clay + 紫色主题。三屏 = 主页(彼此的世界) / 地图(凹陷井画布) / 编辑世界，
 * 地图页底部上拉 sheet 展示今日时间线（含内心独白展开）。
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  CaretLeft, CaretUp, CaretDown, Plus, Check, GearSix, Buildings,
  MapPin, ChatTeardrop, Crosshair, MagnifyingGlass, ArrowRight,
  House, Student, Storefront, Trash, ShieldCheck, NavigationArrow, LinkSimple,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, CharacterProfile, DailySchedule, ScheduleSlot } from '../types';
import { DB } from '../utils/db';
import { computeCharStatus, getSlotAvailability, CharAvailability } from '../utils/charStatus';
import { F, S, R, HUE, STATUS } from '../utils/clayTokens';
import { safeFetchJson, extractContent, extractJson } from '../utils/safeApi';
import { MapWorld, MapRegion, MapDB, matchRegionForSlot } from '../utils/mapWorlds';
import {
  addLocationZone,
  defaultZoneName,
  loadLocationAwareness,
  LOCATION_MAX_AGE_MS,
  parseLocationCoordinates,
  refreshCoarseLocation,
  removeLocationZone,
  setLocationAwarenessEnabled,
  type LocationAwarenessState,
  type LocationZoneKind,
} from '../utils/locationService';
import { getCurrentPositionSmart } from '../utils/geo';
import RealLocationPicker from '../components/RealLocationPicker';

const P = HUE.purple; // Product Color = 紫

// 以下取值来自 handoff README（design_handoff_character_map_schedule），
// 是本功能设计稿指定、clayTokens 尚未收录的专用值。不要在别的 App 复用。
const MAPX = {
  well: '#E7E2DA',                       // 地图凹陷井底色
  grid: 'rgba(120,108,88,.11)',          // 街道网格线
  road: 'rgba(247,246,242,.8)',          // 主干道
  roadDiag: 'rgba(247,246,242,.72)',     // 斜向大道
  nowCardBg: '#F7F0FF',                  // 时间线"进行中"卡底
  nowCardBorder: '#E4D6FB',              // 时间线"进行中"卡边
  handle: '#E0D8CE',                     // sheet 把手
  purpleShadow: 'rgba(94,60,184,.28)',   // 紫色投影（Ink 的 rgb）
  sheetShadow: '0 -8px 30px rgba(70,66,58,.16)',
  dangerBorder: '#F3D3DB',
};

// 类型与存储在 utils/mapWorlds.ts（scheduleGenerator 也要读地点清单注入 prompt）

// ══════════════════════════════════════════════════════════════
//  Default / Template data
// ══════════════════════════════════════════════════════════════

const SEED_WORLD: Omit<MapWorld, 'charId'> & { charNameMatch: string } = {
  id: 'chenzhao_default',
  charNameMatch: '陈照',
  genre: '现代都市',
  cityName: '星澜市',
  tag: '同居',
  tagColor: '#8a3251',
  tagBg: '#ffd7e1',
  homeRegionId: 'home',
  regions: [
    { id: 'home', name: '你们的家', glyph: '🏠', color: '#ddd2ec',
      x: 20, y: 32, isHome: true,
      description: '你们同居的公寓，窗台上养着他随手买的绿植。',
      locationKeys: ['家', '卧室', '客厅', '厨房'] },
    { id: 'dinner', name: '街角餐厅', glyph: '🍷', color: '#f4d7c2',
      x: 76, y: 28,
      description: '楼下开了很多年的小馆子，他惦记的水煮鱼在这。',
      locationKeys: ['餐厅', '吃饭', '晚餐', '约会'] },
    { id: 'gym', name: '健身房', glyph: '💪', color: '#c9e3cd',
      x: 86, y: 52,
      description: '下班后固定来撸铁的地方，器械区放着他的歌单。',
      locationKeys: ['健身', '跑步', '运动'] },
    { id: 'studio', name: '棱镜游戏工作室', glyph: '🏢', color: '#cfdcef',
      x: 44, y: 78, isCharDefault: true,
      description: '他所在的独立游戏团队，熬夜赶版本的战场。',
      locationKeys: ['工作室', '棱镜', '晨会', '版本', '开发', '加班', '团队'] },
    { id: 'office', name: '星澜大厦', glyph: '🏙️', color: '#cfdcef',
      x: 56, y: 56,
      description: '客户方的写字楼，数值平衡会常在 27 层会议室。',
      locationKeys: ['公司', '会议', '星澜', '大厦', '客户'] },
  ],
};

const TAG_OPTIONS = ['暧昧', '恋爱', '同居', '订婚', '结婚', '朋友', '同事', '助手'];

// ══════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════

function getCurrentSlot(schedule: DailySchedule | null): ScheduleSlot | undefined {
  if (!schedule?.slots?.length) return undefined;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let current: ScheduleSlot | undefined;
  for (const s of schedule.slots) { if (s.startTime <= hhmm) current = s; }
  return current;
}

function worldTitle(world: MapWorld, char?: CharacterProfile): string {
  return world.cityName || world.genre || `${char?.name || ''}的世界`;
}

/** 状态色映射（busy=amber / 空闲=success绿 / offline=gray，均来自 tokens） */
const STATUS_META: Record<CharAvailability, { text: string; tint: string; main: string; ink: string }> = {
  busy:    { text: '忙碌中', tint: HUE.amber.tint, main: HUE.amber.main, ink: HUE.amber.ink },
  online:  { text: '空闲中', tint: STATUS.success.tint, main: STATUS.success.main, ink: HUE.green.ink },
  offline: { text: '离线',   tint: HUE.gray.tint,  main: HUE.gray.main,  ink: HUE.gray.ink },
};

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// ══════════════════════════════════════════════════════════════
//  Shared small components
// ══════════════════════════════════════════════════════════════

/** 44px 圆形凸起图标钮（APP_CONVENTIONS §0.3） */
const CircleBtn: React.FC<{ onClick: () => void; children: React.ReactNode; style?: React.CSSProperties }> =
  ({ onClick, children, style }) => (
    <button onClick={onClick}
      className="flex items-center justify-center active:translate-y-[1px] transition-transform shrink-0"
      style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised,
               border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, ...style }}>
      {children}
    </button>
  );

/** 头像：img 盖在首字 monogram 上，加载失败自动露出 monogram 兜底。父容器需 flex 居中。 */
const CharAvatar: React.FC<{ char: CharacterProfile; monogramSize: number; monogramColor: string }> =
  ({ char, monogramSize, monogramColor }) => (
    <>
      <span style={{ fontSize: monogramSize, fontWeight: 700, color: monogramColor }}>{char.name.slice(0, 1)}</span>
      {char.avatar && (
        <img src={char.avatar} className="absolute inset-0 w-full h-full object-cover"
          onError={e => { e.currentTarget.style.display = 'none'; }} />
      )}
    </>
  );

/** 状态小徽章：tint 底 + ink 字 + 状态色圆点 */
const StatusBadge: React.FC<{ status: CharAvailability; text?: string; pulse?: boolean }> =
  ({ status, text, pulse }) => {
    const m = STATUS_META[status];
    return (
      <span className="inline-flex items-center gap-[5px] shrink-0"
        style={{ height: 22, padding: '0 9px', borderRadius: R.pill, background: m.tint,
                 color: m.ink, fontSize: 11, fontWeight: 600 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.main,
                       animation: pulse ? 'mapnowpulse 2s infinite' : undefined }} />
        {text || m.text}
      </span>
    );
  };

// ══════════════════════════════════════════════════════════════
//  Map Well — 凹陷井地图画布（地图页 + 编辑器预览共用）
// ══════════════════════════════════════════════════════════════

const MapWell: React.FC<{
  regions: MapRegion[];
  char?: CharacterProfile;
  charRegionId?: string;
  userRegionId?: string;
  userOutsideLabel?: string;
  status?: CharAvailability;
  cityName?: string;
  outsideLocation?: string;   // 当前时段在地图外的地点（如"烧鸟店"）：角色 pin 挂到画布角落显示"在外面"
  atHome?: boolean;           // [EM: default-home-v2] 深夜/清晨无slot且地图无"家"地点：pin 挂角落显示"在家休息"，不再硬安进第一个地点
  showPanels?: boolean;       // 地图页：左上"当前地图"面板 + 右上"虚拟城市" pill
  highlightRegionId?: string; // 编辑器：选中高亮
  placingRegionId?: string;   // 编辑器：定位模式
  onTapMap?: (x: number, y: number) => void;
  onTapRegion?: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}> = ({ regions, char, charRegionId, userRegionId, userOutsideLabel, status, cityName, outsideLocation, atHome, showPanels, highlightRegionId,
        placingRegionId, onTapMap, onTapRegion, className, style }) => {
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleTap = useCallback((e: React.MouseEvent) => {
    if (!onTapMap || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    onTapMap(Math.max(5, Math.min(95, x)), Math.max(5, Math.min(95, y)));
  }, [onTapMap]);

  const charRegion = regions.find(r => r.id === charRegionId);
  const userRegion = regions.find(r => r.id === userRegionId);

  return (
    <div ref={canvasRef} onClick={handleTap}
      className={`overflow-hidden ${className || ''}`}
      style={{
        position: 'relative',
        background: MAPX.well,
        backgroundImage: `repeating-linear-gradient(0deg,transparent 0 46px,${MAPX.grid} 46px 48px),repeating-linear-gradient(90deg,transparent 0 52px,${MAPX.grid} 52px 54px)`,
        boxShadow: 'inset 2px 2px 6px rgba(70,66,58,.12), inset -2px -2px 6px rgba(255,255,255,.65)',
        ...style,
      }}>

      {/* 主干道 ×3 */}
      <span className="absolute pointer-events-none" style={{ left: 0, right: 0, top: '21%', height: 8, background: MAPX.road, zIndex: 1 }} />
      <span className="absolute pointer-events-none" style={{ top: 0, bottom: 0, left: '61%', width: 8, background: MAPX.road, zIndex: 1 }} />
      <span className="absolute pointer-events-none" style={{ left: -60, top: '42%', width: '160%', height: 11, background: MAPX.roadDiag, transform: 'rotate(-22deg)', transformOrigin: 'left center', zIndex: 1 }} />

      {/* 左上"当前地图"面板 + 右上"虚拟城市" pill */}
      {showPanels && (
        <>
          <div className="absolute" style={{ left: 14, top: 14, zIndex: 4, padding: '11px 13px', borderRadius: R.smallCard,
            background: 'rgba(255,254,252,.85)', backdropFilter: 'blur(6px)',
            border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.14em', color: P.ink }}>当前地图</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: F.textPrimary, marginTop: 1 }}>{cityName}</div>
          </div>
          <div className="absolute inline-flex items-center" style={{ right: 14, top: 14, zIndex: 4, height: 30, padding: '0 12px',
            borderRadius: R.pill, background: F.surface, fontSize: 12, fontWeight: 600, color: P.ink,
            boxShadow: '0 2px 6px rgba(70,66,58,.08)' }}>
            虚拟城市
          </div>
        </>
      )}

      {/* 定位模式提示 */}
      {placingRegionId && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 30 }}>
          <div className="animate-pulse" style={{ background: P.main, color: '#fff', fontSize: 12, fontWeight: 700,
            padding: '6px 14px', borderRadius: R.pill, boxShadow: `0 4px 10px ${MAPX.purpleShadow}` }}>
            点击地图放置位置
          </div>
        </div>
      )}

      {/* 地点圆点：白心 + 3px 紫描边 + 地名 pill（角色所在地点由角色标记代显） */}
      {regions.filter(r => r.id !== charRegionId).map(r => {
        const isHi = r.id === highlightRegionId || r.id === placingRegionId;
        return (
          <div key={r.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 select-none flex flex-col items-center transition-all duration-300"
            style={{ left: `${r.x}%`, top: `${r.y}%`, gap: 5, zIndex: isHi ? 20 : 2 }}
            onClick={(e) => { if (onTapRegion && !placingRegionId) { e.stopPropagation(); onTapRegion(r.id); } }}>
            <span style={{ width: 15, height: 15, borderRadius: '50%', background: F.surface,
              border: `3px solid ${P.main}`, boxShadow: `0 2px 6px ${MAPX.purpleShadow}`,
              outline: isHi ? `3px solid ${P.soft}` : undefined }} />
            <span className="whitespace-nowrap" style={{ padding: '2px 9px', borderRadius: R.pill, background: F.surface,
              fontSize: 11.5, fontWeight: 600, color: F.textPrimary, boxShadow: '0 2px 6px rgba(70,66,58,.1)' }}>
              {r.name}
            </span>
          </div>
        );
      })}

      {/* 用户标记：现实围栏先转成语义地点，再映射到这个角色的虚拟世界。 */}
      {(userRegion || userOutsideLabel) && (
        <div className="absolute -translate-x-1/2 -translate-y-1/2 select-none pointer-events-none flex flex-col items-center transition-all duration-500"
          style={{
            left: `${userRegion ? userRegion.x + (userRegion.id === charRegionId ? -7 : 0) : 18}%`,
            top: `${userRegion ? userRegion.y + (userRegion.id === charRegionId ? 6 : 0) : 84}%`,
            gap: 5,
            zIndex: 5,
          }}>
          <div className="flex items-center justify-center"
            style={{ width: 42, height: 42, borderRadius: '50%', border: `3px solid ${F.surface}`,
                     background: HUE.teal.main, boxShadow: `0 5px 13px rgba(33,135,121,.28)` }}>
            <NavigationArrow size={20} weight="fill" style={{ color: F.surface }} />
          </div>
          <span className="whitespace-nowrap" style={{ padding: '3px 10px', borderRadius: R.pill, background: F.surface,
            fontSize: 11.5, fontWeight: 700, color: userRegion ? HUE.teal.ink : F.textSecondary,
            boxShadow: '0 3px 10px rgba(70,66,58,.14)' }}>
            {userRegion ? `你 · ${userRegion.name}` : userOutsideLabel}
          </span>
        </div>
      )}

      {/* 角色标记：圆头像 + 状态点 + pin 尾 + 地名 pill。在清单外的地点时挂画布右下角显示"在外面" */}
      {char && (charRegion || outsideLocation || atHome) && (
        <div className="absolute -translate-x-1/2 -translate-y-1/2 select-none pointer-events-none flex flex-col items-center transition-all duration-500"
          style={{ left: `${charRegion?.x ?? 82}%`, top: `${charRegion?.y ?? 84}%`, gap: 7, zIndex: 3 }}>
          <div className="relative" style={{ width: 60, height: 60 }}>
            <div className="relative overflow-hidden flex items-center justify-center"
              style={{ width: 60, height: 60, borderRadius: '50%', border: `3px solid ${P.main}`,
                       background: P.tint, boxShadow: `0 6px 16px ${MAPX.purpleShadow}` }}>
              <CharAvatar char={char} monogramSize={24} monogramColor={P.ink} />
            </div>
            <span className="absolute" style={{ right: -1, top: 1, width: 15, height: 15, borderRadius: '50%',
              background: STATUS_META[status || 'offline'].main, border: `2.5px solid ${MAPX.well}` }} />
            <span className="absolute" style={{ left: '50%', bottom: -7, transform: 'translateX(-50%)', width: 0, height: 0,
              borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: `10px solid ${P.main}` }} />
          </div>
          <span className="whitespace-nowrap" style={{ padding: '3px 11px', borderRadius: R.pill, background: F.surface,
            fontSize: 12, fontWeight: 700, color: charRegion ? F.textPrimary : F.textSecondary, boxShadow: '0 3px 10px rgba(70,66,58,.14)' }}>
            {charRegion ? charRegion.name : atHome ? '在家休息 🌙' : `在外面 · ${outsideLocation}`}
          </span>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  Schedule Sheet — 今日日程底部上拉 sheet
// ══════════════════════════════════════════════════════════════

/** sheet 收起(peek)时露出的高度。地图画布只画到 sheet 上沿，地点 pin 永远不被挡。 */
const SHEET_PEEK = 208;

const ScheduleSheet: React.FC<{
  char: CharacterProfile;
  regionName?: string;
  status: CharAvailability;
  schedule: DailySchedule | null;
  currentSlot?: ScheduleSlot;
  expanded: boolean;
  onToggle: () => void;
  onGoChat: () => void;
}> = ({ char, regionName, status, schedule, currentSlot, expanded, onToggle, onGoChat }) => {
  const slots = schedule?.slots || [];
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // 默认展开"进行中"时段的内心独白
  useEffect(() => {
    if (currentSlot?.innerThought) setOpen({ [currentSlot.startTime]: true });
  }, [schedule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date();
  const currentEnd = currentSlot
    ? slots[slots.indexOf(currentSlot) + 1]?.startTime
    : undefined;

  return (
    <div className="absolute flex flex-col overflow-hidden"
      style={{
        left: 0, right: 0, bottom: 0, zIndex: 6,
        height: 'calc(100% - var(--chrome-top) - 72px)',
        borderRadius: `${R.sheet}px ${R.sheet}px 0 0`,
        background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: MAPX.sheetShadow,
        transform: expanded ? 'translateY(0)' : `translateY(calc(100% - ${SHEET_PEEK}px))`,
        transition: 'transform .36s cubic-bezier(.2,.8,.2,1)',
      }}>

      {/* 把手 */}
      <div onClick={onToggle} className="flex flex-col items-center shrink-0 cursor-pointer" style={{ padding: '10px 0 8px' }}>
        <span style={{ width: 38, height: 5, borderRadius: R.pill, background: MAPX.handle }} />
      </div>

      {/* 当前状态头（peek 常驻） */}
      <div onClick={onToggle} className="shrink-0 cursor-pointer" style={{ padding: '2px 18px 14px' }}>
        <div className="flex items-center" style={{ gap: 12 }}>
          <div className="flex items-center justify-center shrink-0"
            style={{ width: 46, height: 46, borderRadius: R.medium, background: P.main, boxShadow: `0 4px 10px ${MAPX.purpleShadow}` }}>
            <Buildings size={24} color="#fff" weight="bold" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate" style={{ fontSize: 16, fontWeight: 600, color: F.textPrimary }}>
              {char.name} · {regionName || '未知地点'}
            </div>
            <div className="flex items-center" style={{ gap: 8, marginTop: 3 }}>
              <StatusBadge status={status} pulse={status === 'busy'} />
              {currentSlot && (
                <span style={{ fontSize: 12, color: F.textTertiary }}>
                  {currentSlot.startTime}{currentEnd ? `–${currentEnd}` : ''}
                </span>
              )}
            </div>
          </div>
          <CaretUp size={20} weight="bold" style={{ color: F.textTertiary, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .3s' }} />
        </div>
        <button onClick={(e) => { e.stopPropagation(); onGoChat(); }}
          className="w-full flex items-center justify-center active:translate-y-[1px] transition-transform"
          style={{ marginTop: 14, height: 48, border: 'none', borderRadius: R.button, gap: 8,
                   background: F.textPrimary, color: F.surface, fontSize: 15, fontWeight: 600,
                   boxShadow: '0 2px 6px rgba(70,66,58,.12), 0 8px 18px rgba(70,66,58,.16)' }}>
          <ChatTeardrop size={17} weight="bold" />去找 TA
        </button>
      </div>

      <div className="shrink-0" style={{ height: 1, background: F.divider, margin: '0 18px' }} />

      {/* 可滚动时间线区 */}
      <div className="flex-1 overflow-y-auto scrollbar-none" style={{ padding: '14px 18px 24px', paddingBottom: 'calc(24px + var(--safe-bottom, 0px))' }}>
        <div style={{ lineHeight: 1.2, marginBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', color: F.textPrimary }}>
            {now.getMonth() + 1}月{now.getDate()}日 今日行程
          </div>
          <div style={{ fontSize: 12, color: F.textTertiary, marginTop: 3 }}>
            {WEEKDAYS[now.getDay()]}{slots.length ? ` · ${slots.length} 个时段` : ' · 暂无日程'}
          </div>
        </div>

        {slots.length === 0 && (
          <div className="flex flex-col items-center justify-center"
            style={{ padding: '36px 16px', borderRadius: R.bigCard, background: F.surfaceSunken, boxShadow: S.sunken, gap: 10 }}>
            <MapPin size={18} weight="bold" style={{ color: F.textTertiary }} />
            <div style={{ fontSize: 13, color: F.textTertiary, textAlign: 'center', lineHeight: 1.6 }}>
              今天还没有日程<br />点「去找 TA」在聊天工具栏的「日程/情绪」里生成
            </div>
          </div>
        )}

        {slots.map((slot, i) => {
          const avail = getSlotAvailability(slot);
          const m = STATUS_META[avail];
          const isNow = slot === currentSlot;
          const end = slots[i + 1]?.startTime;
          const hasMono = !!slot.innerThought;
          const isOpen = !!open[slot.startTime];
          return (
            <div key={slot.startTime + i} className="flex" style={{ gap: 12 }}>
              {/* 左侧竖轴：状态色圆点 + 虚线 */}
              <div className="flex flex-col items-center shrink-0" style={{ width: 14, paddingTop: 8 }}>
                <span className="shrink-0" style={{ width: 13, height: 13, borderRadius: '50%', background: m.main,
                  boxShadow: `0 0 0 4px ${F.surface}, 0 1px 3px rgba(70,66,58,.2)` }} />
                {i < slots.length - 1 && (
                  <span className="flex-1" style={{ width: 0, minHeight: 20, borderLeft: `2px dashed ${F.borderStrong}`, marginTop: 4 }} />
                )}
              </div>
              {/* 时间线卡 */}
              <div onClick={() => { if (hasMono) setOpen(prev => ({ ...prev, [slot.startTime]: !prev[slot.startTime] })); }}
                className="flex-1"
                style={{ marginBottom: 12, borderRadius: R.bigCard, padding: '14px 15px',
                         background: isNow ? MAPX.nowCardBg : F.surface,
                         border: `1px solid ${isNow ? MAPX.nowCardBorder : F.borderSoft}`,
                         borderLeft: isNow ? `4px solid ${P.main}` : `1px solid ${F.borderSoft}`,
                         boxShadow: '0 2px 6px rgba(70,66,58,.05)',
                         cursor: hasMono ? 'pointer' : 'default' }}>
                <div className="flex items-center justify-between" style={{ gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: P.ink, letterSpacing: '.01em' }}>
                    {slot.startTime}{end ? `–${end}` : ''}
                  </span>
                  <StatusBadge status={avail} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6, color: F.textPrimary }}>
                  {slot.emoji ? `${slot.emoji} ` : ''}{slot.activity}
                </div>
                <div className="flex items-center" style={{ gap: 8, marginTop: 8 }}>
                  {slot.location && (
                    <span className="inline-flex items-center" style={{ gap: 5, height: 26, padding: '0 10px',
                      borderRadius: R.pill, background: P.tint, color: P.ink, fontSize: 12, fontWeight: 600 }}>
                      <MapPin size={11} weight="bold" style={{ color: P.main }} />{slot.location}
                    </span>
                  )}
                  {hasMono && (
                    <span className="inline-flex items-center ml-auto" style={{ gap: 4, fontSize: 12, fontWeight: 600, color: P.main }}>
                      {isOpen ? '收起' : '内心独白'}
                      <CaretDown size={13} weight="bold" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s' }} />
                    </span>
                  )}
                </div>
                {hasMono && isOpen && (
                  <div className="relative" style={{ marginTop: 12, borderRadius: R.medium, padding: '13px 14px 13px 30px',
                    background: F.surfaceSunken, boxShadow: S.sunken }}>
                    <span className="absolute" style={{ left: 11, top: 7, fontSize: 26, lineHeight: 1, color: '#B7AFA4', fontFamily: 'Georgia,serif' }}>“</span>
                    <span style={{ fontSize: 13.5, fontStyle: 'italic', lineHeight: 1.65, color: F.textSecondary }}>
                      {slot.innerThought}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  Map Screen — 地图页
// ══════════════════════════════════════════════════════════════

const MapScreen: React.FC<{
  world: MapWorld; char: CharacterProfile; schedule: DailySchedule | null;
  onBack: () => void; onEdit: () => void;
}> = ({ world, char, schedule, onBack, onEdit }) => {
  const { openApp } = useOS();
  const [expanded, setExpanded] = useState(false);

  const statusResult = useMemo(() => computeCharStatus(schedule, undefined, char), [schedule, char]);
  const currentSlot = useMemo(() => getCurrentSlot(schedule), [schedule]);
  const locationAwareness = loadLocationAwareness();
  const locationSnapshot = locationAwareness.enabled
    && locationAwareness.lastSnapshot
    && Date.now() - locationAwareness.lastSnapshot.updatedAt <= LOCATION_MAX_AGE_MS
    ? locationAwareness.lastSnapshot
    : null;
  const userRegionId = locationSnapshot?.zoneId
    ? world.locationBindings?.[locationSnapshot.zoneId]
    : undefined;
  const userOutsideLabel = !locationSnapshot
    ? undefined
    : locationSnapshot.zoneId === null
      ? '你 · 在外面'
      : userRegionId ? undefined : `你 · ${locationSnapshot.label}未关联`;

  // 三态：匹配到清单地点→站那 / 有 location 但不在清单（烧鸟店等）→"在外面" / 没 location→站默认位
  const { matchedRegion, outsideLocation, atHomeFallback } = useMemo(() => {
    const m = matchRegionForSlot(world, currentSlot);
    if (m) return { matchedRegion: m, outsideLocation: undefined, atHomeFallback: false };
    if (currentSlot?.location) return { matchedRegion: undefined, outsideLocation: currentSlot.location, atHomeFallback: false };
    // [EM: default-home-v2] 日程外（深夜/清晨无slot）兜底：角色默认位 > 名字含'家'的地点 > "在家休息"状态。
    // 阿萌07-21方案②：深夜默认在家；regions[0] 兜底已废（会把人扔进工作室）。夜猫子角色用 isCharDefault 覆盖。
    const home = world.regions.find(r => r.isCharDefault) || world.regions.find(r => /家|home/i.test(r.name));
    return home ? { matchedRegion: home, outsideLocation: undefined, atHomeFallback: false }
                : { matchedRegion: undefined, outsideLocation: undefined, atHomeFallback: true };
  }, [world, currentSlot]);

  return (
    <div className="relative h-full overflow-hidden" style={{ background: F.appBg }}>
      {/* 浮动导航 */}
      <div className="absolute left-0 right-0" style={{ top: 0, zIndex: 9, paddingTop: 'var(--chrome-top)' }}>
        <div className="flex items-center justify-between" style={{ padding: '8px 18px' }}>
          <CircleBtn onClick={onBack}><CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} /></CircleBtn>
          <div style={{ fontSize: 16, fontWeight: 600, color: F.textPrimary }}>{worldTitle(world, char)}</div>
          <CircleBtn onClick={onEdit}><GearSix size={20} weight="bold" style={{ color: F.textSecondary }} /></CircleBtn>
        </div>
      </div>

      {/* 地图画布：凹陷井 */}
      <MapWell
        regions={world.regions}
        char={char}
        charRegionId={matchedRegion?.id}
        userRegionId={userRegionId}
        userOutsideLabel={userOutsideLabel}
        outsideLocation={outsideLocation}
        atHome={atHomeFallback}
        status={statusResult.status}
        cityName={worldTitle(world, char)}
        showPanels
        style={{ position: 'absolute', top: 'calc(var(--chrome-top) + 60px)', left: 18, right: 18,
                 bottom: `calc(${SHEET_PEEK}px + var(--safe-bottom, 0px) + 12px)`, borderRadius: R.panel }}
      />

      {/* 暗色遮罩 */}
      <div onClick={() => setExpanded(false)}
        className="absolute inset-0"
        style={{ zIndex: 5, background: F.textPrimary, opacity: expanded ? 0.26 : 0,
                 pointerEvents: expanded ? 'auto' : 'none', transition: 'opacity .3s' }} />

      {/* 今日日程 sheet */}
      <ScheduleSheet
        char={char}
        regionName={outsideLocation || matchedRegion?.name}
        status={statusResult.status}
        schedule={schedule}
        currentSlot={currentSlot}
        expanded={expanded}
        onToggle={() => setExpanded(v => !v)}
        onGoChat={() => openApp(AppID.Chat, { messageWidgetCharId: char.id })}
      />
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  World Editor — 编辑世界
// ══════════════════════════════════════════════════════════════

const sunkenInput: React.CSSProperties = {
  background: F.surfaceSunken, boxShadow: S.sunken, borderRadius: R.input,
  border: 'none', outline: 'none', color: F.textPrimary,
};

const WorldEditor: React.FC<{
  world: MapWorld;
  char: CharacterProfile;
  onSave: (w: MapWorld) => void;
  onDelete?: () => void;
  onBack: () => void;
  isNew?: boolean;
  apiConfig: { baseUrl: string; apiKey: string; model: string };
}> = ({ world: initial, char, onSave, onDelete, onBack, isNew, apiConfig }) => {
  const { addToast } = useOS();
  const [w, setW] = useState<MapWorld>({ ...initial });
  const [editingRegion, setEditingRegion] = useState<string | null>(null);
  const [placingRegionId, setPlacingRegionId] = useState<string | null>(null);
  const [importedLocations, setImportedLocations] = useState<{ name: string; emoji: string; keywords: string[]; description?: string }[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const locationZones = loadLocationAwareness().zones;

  // LLM 从人设 + 聊天记录 + 近期日程里提取地点
  const handleImportLocations = useCallback(async () => {
    setImportLoading(true);
    try {
      const textParts: string[] = [];
      if (char.description) textParts.push(`[角色简介] ${char.description}`);
      if (char.systemPrompt) textParts.push(`[角色设定] ${char.systemPrompt.slice(0, 3000)}`);
      if (char.worldview) textParts.push(`[世界观] ${char.worldview.slice(0, 2000)}`);
      if (char.mountedWorldbooks) {
        for (const wb of char.mountedWorldbooks) textParts.push(`[世界书: ${wb.title}] ${wb.content.slice(0, 1500)}`);
      }
      try {
        const msgs = await DB.getRecentMessagesByCharId(char.id, 100);
        const chatSnippets = msgs
          .filter(m => typeof m.content === 'string' && m.type === 'text')
          .map(m => (m.content as string).slice(0, 200))
          .join('\n');
        if (chatSnippets) textParts.push(`[近期聊天]\n${chatSnippets.slice(0, 4000)}`);
      } catch {}
      try {
        const today = new Date();
        const schedParts: string[] = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          const sched = await DB.getDailySchedule(char.id, dateStr);
          if (sched?.slots) {
            for (const s of sched.slots) {
              const parts = [s.startTime, s.activity, s.location, s.description].filter(Boolean).join(' ');
              if (parts) schedParts.push(parts);
            }
          }
        }
        if (schedParts.length) textParts.push(`[近7天日程]\n${schedParts.join('\n')}`);
      } catch {}

      const allText = textParts.join('\n\n').slice(0, 12000);
      const data = await safeFetchJson(
        `${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
          body: JSON.stringify({
            model: apiConfig.model,
            temperature: 0.3,
            max_tokens: 4000,
            messages: [
              {
                role: 'system',
                content: `你是地点提取助手。从下面关于虚构角色"${char.name}"的文本中，提取所有出现过的**具体地点/场所**。

规则：
- 只提取具体的场所名（如"星澜大厦""家""健身房""梧桐苑""露台"），不要提取模糊词（如"这里""那边""外面"）
- 同一个地方的不同说法合并（如"家/卧室/客厅"算同一个地点"家"，但可以把"卧室""客厅"作为 keywords）
- 每个地点给一个合适的 emoji
- 每个地点给出用于匹配日程 location 字段的关键词列表
- 每个地点写一句 12–20 字的描述（这个地方对角色意味着什么）
- 按重要性排序（角色最常出现的地方排前面）

返回 JSON 数组，格式：
[{"name":"地点名","emoji":"🏢","keywords":["关键词1","关键词2"],"description":"一句描述"}]

只返回 JSON，不要其他文字。`,
              },
              { role: 'user', content: allText },
            ],
          }),
        },
        2, 90000,
        { appId: 'map', appName: '地图', charId: char.id, charName: char.name },
      );

      const raw = extractContent(data);
      const parsed = extractJson(raw);
      if (Array.isArray(parsed)) {
        setImportedLocations(parsed.filter((p: any) => p?.name && p?.emoji));
      } else {
        addToast('AI 返回的地点列表没解析出来，可以再试一次', 'error');
      }
      setImportDone(true);
    } catch (e: any) {
      addToast(`地点扫描失败：${String(e?.message || e).slice(0, 120)}`, 'error');
      setImportDone(true);
    }
    setImportLoading(false);
  }, [char, apiConfig, addToast]);

  const update = (patch: Partial<MapWorld>) => setW(prev => ({ ...prev, ...patch }));
  const updateRegion = (regionId: string, patch: Partial<MapRegion>) => {
    setW(prev => ({
      ...prev,
      regions: prev.regions.map(r => r.id === regionId ? { ...r, ...patch } : r),
    }));
  };

  const addRegionFromImport = (loc: { name: string; emoji: string; keywords: string[]; description?: string }) => {
    const idx = w.regions.length;
    const angle = (idx / Math.max(idx + 1, 6)) * Math.PI * 2 - Math.PI / 2;
    const cx = 50, cy = 50, radius = 30;
    const newRegion: MapRegion = {
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      name: loc.name,
      glyph: loc.emoji,
      color: '',
      x: Math.max(10, Math.min(90, Math.round(cx + Math.cos(angle) * radius))),
      y: Math.max(10, Math.min(90, Math.round(cy + Math.sin(angle) * radius))),
      locationKeys: loc.keywords,
      description: loc.description,
    };
    setW(prev => ({ ...prev, regions: [...prev.regions, newRegion] }));
  };

  const addBlankRegion = () => {
    const idx = w.regions.length;
    const angle = (idx / Math.max(idx + 1, 6)) * Math.PI * 2 - Math.PI / 2;
    const cx = 50, cy = 50, radius = 30;
    const newRegion: MapRegion = {
      id: `r_${Date.now()}`,
      name: '新地点',
      glyph: '📍',
      color: '',
      x: Math.max(10, Math.min(90, Math.round(cx + Math.cos(angle) * radius))),
      y: Math.max(10, Math.min(90, Math.round(cy + Math.sin(angle) * radius))),
      locationKeys: [],
    };
    setW(prev => ({ ...prev, regions: [...prev.regions, newRegion] }));
    setEditingRegion(newRegion.id);
    setPlacingRegionId(newRegion.id);
  };

  const removeRegion = (id: string) => {
    setW(prev => ({
      ...prev,
      regions: prev.regions.filter(r => r.id !== id),
      locationBindings: Object.fromEntries(
        Object.entries(prev.locationBindings || {}).filter(([, regionId]) => regionId !== id),
      ),
    }));
    if (placingRegionId === id) setPlacingRegionId(null);
    if (editingRegion === id) setEditingRegion(null);
  };

  const handleMapTap = useCallback((x: number, y: number) => {
    if (placingRegionId) {
      updateRegion(placingRegionId, { x, y });
      setPlacingRegionId(null);
    }
  }, [placingRegionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ fontSize: 13, fontWeight: 600, color: P.ink, letterSpacing: '.06em', margin: '0 2px 10px' }}>{children}</div>
  );

  return (
    <div className="flex flex-col h-full" style={{ background: F.appBg }}>
      {/* 顶栏（§0.2）：返回 + 居中标题 + 保存 */}
      <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
        <div className="relative flex items-center" style={{ padding: '12px 18px' }}>
          <CircleBtn onClick={onBack}><CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} /></CircleBtn>
          <span className="absolute left-0 right-0 flex justify-center pointer-events-none"
            style={{ fontSize: 16, fontWeight: 600, color: F.textPrimary }}>
            {isNew ? '创建世界' : '编辑世界'}
          </span>
          <button onClick={() => onSave(w)}
            className="ml-auto flex items-center justify-center active:translate-y-[1px] transition-transform shrink-0"
            style={{ width: 44, height: 44, border: 'none', borderRadius: R.pill, background: P.main,
                     boxShadow: `0 4px 10px ${MAPX.purpleShadow}` }}>
            <Check size={18} weight="bold" color="#fff" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none" style={{ padding: '4px 18px', paddingBottom: 'calc(40px + var(--safe-bottom, 0px))' }}>

        {/* 城市名（类型字段保留在数据里但不再展示，阿萌 07-10 定） */}
        <div style={{ borderRadius: R.smallCard, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, marginBottom: 16 }}>
          <div className="flex items-center justify-between" style={{ height: 52, padding: '0 16px' }}>
            <span style={{ fontSize: 14, color: F.textSecondary }} className="shrink-0">城市名</span>
            <input value={w.cityName || ''} onChange={e => update({ cityName: e.target.value })}
              className="text-right bg-transparent outline-none border-none flex-1 ml-3"
              style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}
              placeholder="星澜市" />
          </div>
        </div>

        {/* 关系 chips：单选，选中紫 Main，未选紫 Tint */}
        <SectionLabel>关系</SectionLabel>
        <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 16 }}>
          {TAG_OPTIONS.map(t => {
            const sel = w.tag === t;
            return (
              <button key={t} onClick={() => update({ tag: t })}
                className="inline-flex items-center active:translate-y-[1px] transition-transform"
                style={{ height: 34, padding: '0 15px', border: 'none', borderRadius: R.pill,
                         background: sel ? P.main : P.tint,
                         color: sel ? '#fff' : P.ink,
                         fontSize: 13, fontWeight: sel ? 700 : 600,
                         boxShadow: sel ? `0 3px 8px ${MAPX.purpleShadow}` : 'none' }}>
                {t}
              </button>
            );
          })}
        </div>

        {/* 地图预览：定位地点用 */}
        <SectionLabel>
          地图预览{placingRegionId && <span style={{ color: P.main }}>　· 点击放置「{w.regions.find(r => r.id === placingRegionId)?.name}」</span>}
        </SectionLabel>
        <MapWell
          regions={w.regions}
          highlightRegionId={editingRegion || undefined}
          placingRegionId={placingRegionId || undefined}
          onTapMap={handleMapTap}
          onTapRegion={(id) => { if (!placingRegionId) setEditingRegion(editingRegion === id ? null : id); }}
          className="aspect-square"
          style={{ borderRadius: R.bigCard, marginBottom: placingRegionId ? 8 : 18 }}
        />
        {placingRegionId && (
          <button onClick={() => setPlacingRegionId(null)}
            className="w-full active:translate-y-[1px] transition-transform"
            style={{ marginBottom: 18, height: 40, border: `1px solid ${F.borderSoft}`, borderRadius: R.button,
                     background: F.surface, fontSize: 13, fontWeight: 600, color: F.textSecondary, boxShadow: S.raisedSoft }}>
            取消定位
          </button>
        )}

        {/* 从记忆导入地点：凹陷井按钮 */}
        <SectionLabel>从记忆导入地点</SectionLabel>
        {!importDone ? (
          <button onClick={handleImportLocations} disabled={importLoading}
            className="w-full flex items-center justify-center disabled:opacity-60"
            style={{ ...sunkenInput, height: 56, borderRadius: R.smallCard, gap: 9, marginBottom: 18, cursor: 'pointer' }}>
            <MagnifyingGlass size={18} weight="bold" style={{ color: P.main }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: P.ink }}>
              {importLoading ? 'AI 正在扫描聊天记录 + 人设…' : 'AI 扫描记忆中的地名'}
            </span>
          </button>
        ) : (
          <div style={{ borderRadius: R.smallCard, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, padding: 12, marginBottom: 18 }}>
            {importedLocations.length === 0 ? (
              <div className="text-center" style={{ fontSize: 13, color: F.textTertiary, padding: '8px 0' }}>没有找到地名，可手动添加</div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: F.textTertiary, marginBottom: 8 }}>点击添加到地图（添加后可在预览里定位）：</div>
                <div className="flex flex-col" style={{ gap: 6 }}>
                  {importedLocations.map(loc => {
                    const added = w.regions.some(r => r.name === loc.name || r.locationKeys?.some(k => loc.keywords.includes(k)));
                    return (
                      <button key={loc.name} disabled={added}
                        onClick={() => addRegionFromImport(loc)}
                        className="flex items-center text-left"
                        style={{ gap: 10, padding: '8px 12px', border: 'none', borderRadius: R.medium,
                                 background: added ? F.surfaceSunken : P.tint, opacity: added ? 0.5 : 1, cursor: added ? 'default' : 'pointer' }}>
                        <span style={{ fontSize: 17 }} className="shrink-0">{loc.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate" style={{ fontSize: 14, fontWeight: 600, color: added ? F.textTertiary : P.ink, textDecoration: added ? 'line-through' : 'none' }}>{loc.name}</div>
                          <div className="truncate" style={{ fontSize: 10, color: F.textTertiary }}>{loc.keywords.join('、')}</div>
                        </div>
                        {added
                          ? <Check size={14} weight="bold" style={{ color: F.textTertiary }} className="shrink-0" />
                          : <Plus size={14} weight="bold" style={{ color: P.main }} className="shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* 地点列表 */}
        <div className="flex items-center justify-between" style={{ margin: '0 2px 12px' }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: F.textPrimary }}>
            地点 <span style={{ color: F.textTertiary }}>{w.regions.length}</span>
          </span>
          <button onClick={addBlankRegion}
            className="inline-flex items-center bg-transparent border-none"
            style={{ gap: 5, fontSize: 14, fontWeight: 600, color: P.main, cursor: 'pointer' }}>
            <Plus size={16} weight="bold" />添加
          </button>
        </div>

        <div className="flex flex-col" style={{ gap: 12 }}>
          {w.regions.map(r => {
            const isEditing = editingRegion === r.id;
            return (
              <div key={r.id}
                style={{ borderRadius: R.bigCard, padding: '15px 16px', background: F.surface,
                         border: `1px solid ${isEditing ? P.soft : F.borderSoft}`, boxShadow: S.raisedSoft }}>
                {/* 头部行：emoji 座 + 地名 + 你/TA 徽章 + 坐标 pill */}
                <div className="flex items-start justify-between" style={{ gap: 10 }}>
                  <div className="flex items-center min-w-0" style={{ gap: 10 }}>
                    <div className="flex items-center justify-center shrink-0"
                      style={{ width: 40, height: 40, borderRadius: 12, background: P.tint, fontSize: 21 }}>
                      {r.glyph}
                    </div>
                    <div className="flex items-center min-w-0 flex-wrap" style={{ gap: 6 }}>
                      <span className="truncate" style={{ fontSize: 15, fontWeight: 700, color: F.textPrimary }}>{r.name}</span>
                      {r.isHome && (
                        <span className="inline-flex items-center shrink-0" style={{ height: 18, padding: '0 7px', borderRadius: R.pill, background: P.tint, color: P.ink, fontSize: 10, fontWeight: 700 }}>你</span>
                      )}
                      {r.isCharDefault && (
                        <span className="inline-flex items-center shrink-0" style={{ height: 18, padding: '0 7px', borderRadius: R.pill, background: P.tint, color: P.ink, fontSize: 10, fontWeight: 700 }}>TA</span>
                      )}
                    </div>
                  </div>
                  <span className="inline-flex items-center shrink-0" style={{ gap: 4, height: 24, padding: '0 9px', borderRadius: R.pill, background: P.tint, fontSize: 11, fontWeight: 600, color: P.ink }}>
                    <MapPin size={11} weight="bold" style={{ color: P.main }} />{r.x}, {r.y}
                  </span>
                </div>

                {r.description && (
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: F.textSecondary, marginTop: 8 }}>{r.description}</div>
                )}

                {/* 底部行：关键词数 + 编辑/删除 */}
                <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
                  <span style={{ fontSize: 11, color: F.textTertiary }}>{r.locationKeys?.length || 0} 个关键词</span>
                  <div className="flex" style={{ gap: 8 }}>
                    <button onClick={() => setEditingRegion(isEditing ? null : r.id)}
                      className="inline-flex items-center active:translate-y-[1px] transition-transform"
                      style={{ height: 28, padding: '0 13px', borderRadius: R.pill, background: F.surface,
                               border: `1px solid ${F.borderSoft}`, fontSize: 12, fontWeight: 600, color: F.textPrimary }}>
                      {isEditing ? '收起' : '编辑'}
                    </button>
                    {w.regions.length > 1 && (
                      <button onClick={() => removeRegion(r.id)}
                        className="inline-flex items-center active:translate-y-[1px] transition-transform"
                        style={{ height: 28, padding: '0 13px', border: 'none', borderRadius: R.pill,
                                 background: '#FFE6EA', fontSize: 12, fontWeight: 600, color: '#8F2443' }}>
                        删除
                      </button>
                    )}
                  </div>
                </div>

                {/* 展开编辑区 */}
                {isEditing && (
                  <div style={{ borderTop: `1px solid ${F.divider}`, marginTop: 12, paddingTop: 12 }} className="flex flex-col gap-2.5">
                    <div className="flex" style={{ gap: 8 }}>
                      <input value={r.glyph} onChange={e => updateRegion(r.id, { glyph: e.target.value.slice(0, 2) })}
                        className="text-center shrink-0"
                        style={{ ...sunkenInput, width: 44, height: 40, fontSize: 17 }} />
                      <input value={r.name} onChange={e => updateRegion(r.id, { name: e.target.value })}
                        className="flex-1 min-w-0"
                        style={{ ...sunkenInput, height: 40, padding: '0 12px', fontSize: 14, fontWeight: 600 }}
                        placeholder="地点名" />
                    </div>
                    <textarea value={r.description || ''} onChange={e => updateRegion(r.id, { description: e.target.value })}
                      rows={2} className="w-full resize-none"
                      style={{ ...sunkenInput, padding: '9px 12px', fontSize: 12.5, lineHeight: 1.5 }}
                      placeholder="一句话描述这个地方（对 TA 意味着什么）" />
                    <div>
                      <div style={{ fontSize: 10, color: F.textTertiary, marginBottom: 4 }}>位置关键词（逗号分隔，匹配日程 location）</div>
                      <input value={(r.locationKeys || []).join(', ')}
                        onChange={e => updateRegion(r.id, { locationKeys: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}
                        className="w-full"
                        style={{ ...sunkenInput, height: 38, padding: '0 12px', fontSize: 12 }}
                        placeholder="公司, 会议室, 星澜" />
                    </div>
                    <button onClick={() => setPlacingRegionId(placingRegionId === r.id ? null : r.id)}
                      className="w-full flex items-center justify-center active:translate-y-[1px] transition-transform"
                      style={{ gap: 6, height: 40, border: 'none', borderRadius: R.button,
                               background: placingRegionId === r.id ? P.main : P.tint,
                               color: placingRegionId === r.id ? '#fff' : P.ink,
                               fontSize: 13, fontWeight: 600 }}>
                      <Crosshair size={14} weight="bold" />
                      {placingRegionId === r.id ? '在上方预览图点击放置…' : '在地图上定位'}
                    </button>
                    <div className="flex" style={{ gap: 8 }}>
                      <button onClick={() => setW(prev => ({
                          ...prev,
                          regions: prev.regions.map(reg => ({ ...reg, isCharDefault: reg.id === r.id })),
                        }))}
                        style={{ height: 28, padding: '0 12px', border: 'none', borderRadius: R.pill, fontSize: 11, fontWeight: 700,
                                 background: r.isCharDefault ? P.main : P.tint, color: r.isCharDefault ? '#fff' : P.ink }}>
                        TA 的默认位
                      </button>
                      <button onClick={() => setW(prev => ({
                          ...prev,
                          regions: prev.regions.map(reg => ({ ...reg, isHome: reg.id === r.id })),
                          homeRegionId: r.id,
                        }))}
                        style={{ height: 28, padding: '0 12px', border: 'none', borderRadius: R.pill, fontSize: 11, fontWeight: 700,
                                 background: r.isHome ? P.main : P.tint, color: r.isHome ? '#fff' : P.ink }}>
                        你的默认位
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {locationZones.length > 0 && (
          <section style={{ marginTop: 18 }}>
            <SectionLabel>现实地点联动</SectionLabel>
            <div className="overflow-hidden" style={{ borderRadius: R.bigCard, background: F.surface,
              border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
              {locationZones.map((zone, index) => (
                <React.Fragment key={zone.id}>
                  {index > 0 && <div style={{ height: 1, margin: '0 14px', background: F.divider }} />}
                  <div style={{ padding: '12px 14px' }}>
                    <div className="flex items-center" style={{ gap: 8 }}>
                      <NavigationArrow size={16} weight="fill" style={{ color: HUE.teal.main }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: F.textPrimary }}>{zone.name}</span>
                    </div>
                    <select value={w.locationBindings?.[zone.id] || ''}
                      onChange={event => {
                        const regionId = event.target.value;
                        setW(prev => {
                          const nextBindings = { ...(prev.locationBindings || {}) };
                          if (regionId) nextBindings[zone.id] = regionId;
                          else delete nextBindings[zone.id];
                          return { ...prev, locationBindings: nextBindings };
                        });
                      }}
                      style={{ ...sunkenInput, width: '100%', height: 40, marginTop: 8, padding: '0 11px', fontSize: 13 }}>
                      <option value="">不显示在这个世界</option>
                      {w.regions.map(region => (
                        <option key={region.id} value={region.id}>{region.glyph} {region.name}</option>
                      ))}
                    </select>
                  </div>
                </React.Fragment>
              ))}
            </div>
            <div style={{ margin: '8px 2px 0', fontSize: 11, lineHeight: 1.55, color: F.textTertiary }}>
              例如把现实“家”关联到“你们的公寓”。每个角色世界可以有不同对应关系。
            </div>
          </section>
        )}

        {/* 删除这个世界 */}
        {!isNew && onDelete && (
          <button onClick={onDelete}
            className="w-full active:translate-y-[1px] transition-transform"
            style={{ marginTop: 16, height: 50, border: `1px solid ${MAPX.dangerBorder}`, borderRadius: R.smallCard,
                     background: '#FFE6EA', color: '#8F2443', fontSize: 14, fontWeight: 700 }}>
            删除这个世界
          </button>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  Shelf — 主页「彼此的世界」
// ══════════════════════════════════════════════════════════════

const Shelf: React.FC<{
  worlds: MapWorld[];
  characters: CharacterProfile[];
  schedules: Record<string, DailySchedule | null>;
  onOpenWorld: (worldId: string) => void;
  onCreateWorld: (charId: string) => void;
  onOpenMyLocation: () => void;
}> = ({ worlds, characters, schedules, onOpenWorld, onCreateWorld, onOpenMyLocation }) => {
  const { closeApp } = useOS();
  const charsWithWorld = new Set(worlds.map(w => w.charId));
  const charsWithout = characters.filter(c => !charsWithWorld.has(c.id));

  return (
    <div className="flex flex-col h-full" style={{ background: F.appBg }}>
      <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
        <div className="flex items-center" style={{ padding: '12px 20px 0' }}>
          <CircleBtn onClick={() => closeApp()}><CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} /></CircleBtn>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none" style={{ padding: '10px 20px', paddingBottom: 'calc(40px + var(--safe-bottom, 0px))' }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', color: F.textPrimary }}>彼此的世界</div>
        <div style={{ fontSize: 13, color: F.textTertiary, marginTop: 4 }}>你和他们各自的生活 · 每个人有自己的小世界</div>

        <button onClick={onOpenMyLocation}
          className="w-full flex items-center text-left active:translate-y-[1px] transition-transform"
          style={{ marginTop: 16, padding: 14, gap: 12, borderRadius: R.bigCard, background: HUE.teal.tint,
                   border: `1px solid ${HUE.teal.soft}`, boxShadow: S.raisedSoft }}>
          <span className="flex items-center justify-center shrink-0"
            style={{ width: 44, height: 44, borderRadius: R.medium, background: HUE.teal.main }}>
            <NavigationArrow size={21} weight="bold" style={{ color: F.surface }} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block" style={{ fontSize: 15, fontWeight: 700, color: F.textPrimary }}>我的位置</span>
            <span className="block truncate" style={{ marginTop: 2, fontSize: 12, color: F.textSecondary }}>
              家、学校与常去超市的本机围栏
            </span>
          </span>
          <ArrowRight size={18} weight="bold" style={{ color: HUE.teal.ink }} />
        </button>

        {/* 精选角色卡（hero）×每个已建世界 */}
        {worlds.map(world => {
          const char = characters.find(c => c.id === world.charId);
          if (!char) return null;
          const sr = computeCharStatus(schedules[world.charId] || null, undefined, char);
          const m = STATUS_META[sr.status];
          return (
            <div key={world.id} onClick={() => onOpenWorld(world.id)}
              className="flex items-center cursor-pointer active:translate-y-[1px] transition-transform"
              style={{ marginTop: 14, borderRadius: R.bigCard, padding: 14, gap: 12, background: P.tint, boxShadow: S.raisedSoft }}>
              <div className="relative overflow-hidden flex items-center justify-center shrink-0"
                style={{ width: 52, height: 52, borderRadius: R.medium, background: P.main, boxShadow: `0 4px 12px ${MAPX.purpleShadow}` }}>
                <CharAvatar char={char} monogramSize={22} monogramColor="#fff" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span className="truncate" style={{ fontSize: 17, fontWeight: 700, color: F.textPrimary }}>{char.name}</span>
                  {world.tag && (
                    <span className="inline-flex items-center shrink-0"
                      style={{ height: 19, padding: '0 8px', borderRadius: R.pill, background: HUE.amber.tint, color: HUE.amber.ink, fontSize: 11, fontWeight: 600 }}>
                      {world.tag}
                    </span>
                  )}
                </div>
                <div className="flex items-center" style={{ gap: 6, fontSize: 12.5, color: F.textSecondary, marginTop: 3 }}>
                  <span className="truncate">{world.cityName || '未命名城市'} · {world.regions.length} 个地点</span>
                </div>
                <div className="flex items-center" style={{ gap: 6, marginTop: 4 }}>
                  <span className="shrink-0" style={{ width: 7, height: 7, borderRadius: '50%', background: m.main }} />
                  <span className="truncate" style={{ fontSize: 12, fontWeight: 600, color: m.ink }}>
                    {sr.currentActivity ? `${sr.currentActivity}中` : m.text}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-center shrink-0"
                style={{ width: 42, height: 42, borderRadius: '50%', background: F.textPrimary,
                         boxShadow: '0 2px 6px rgba(70,66,58,.12), 0 8px 18px rgba(70,66,58,.16)' }}>
                <ArrowRight size={18} weight="bold" style={{ color: F.surface }} />
              </div>
            </div>
          );
        })}

        {/* 其他角色 */}
        {charsWithout.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: F.textTertiary, letterSpacing: '.06em', margin: '22px 2px 12px' }}>其他角色</div>
            <div className="overflow-hidden" style={{ borderRadius: R.bigCard, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
              {charsWithout.map((c, i) => {
                const sr = computeCharStatus(schedules[c.id] || null, undefined, c);
                const m = STATUS_META[sr.status];
                return (
                  <React.Fragment key={c.id}>
                    {i > 0 && <div style={{ height: 1, background: F.divider, margin: '0 16px' }} />}
                    <div className="flex items-center" style={{ gap: 12, padding: '14px 16px' }}>
                      <div className="relative overflow-hidden flex items-center justify-center shrink-0"
                        style={{ width: 46, height: 46, borderRadius: R.medium, background: P.tint }}>
                        <CharAvatar char={c} monogramSize={20} monogramColor={P.ink} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center" style={{ gap: 6 }}>
                          <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: F.textPrimary }}>{c.name}</span>
                          <span className="shrink-0" style={{ width: 8, height: 8, borderRadius: '50%', background: m.main }} />
                        </div>
                        <div className="truncate" style={{ fontSize: 12, color: F.textTertiary, marginTop: 2 }}>
                          {sr.currentActivity ? `${sr.currentActivity}中` : m.text}
                        </div>
                      </div>
                      <button onClick={() => onCreateWorld(c.id)}
                        className="bg-transparent border-none shrink-0"
                        style={{ fontSize: 13, fontWeight: 600, color: P.main, cursor: 'pointer' }}>
                        创建世界
                      </button>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}

        {characters.length === 0 && (
          <div className="flex flex-col items-center justify-center"
            style={{ marginTop: 24, padding: '48px 16px', borderRadius: R.bigCard, background: F.surfaceSunken, boxShadow: S.sunken, gap: 10 }}>
            <MapPin size={18} weight="bold" style={{ color: F.textTertiary }} />
            <div style={{ fontSize: 13, color: F.textTertiary }}>还没有角色</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  My Location — 真实位置只在本机匹配为粗略语义
// ══════════════════════════════════════════════════════════════

const LOCATION_KIND_META = {
  home: { label: '家', icon: House },
  school: { label: '学校', icon: Student },
  supermarket: { label: '超市', icon: Storefront },
} satisfies Record<LocationZoneKind, { label: string; icon: React.ComponentType<any> }>;

const MyLocationScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [state, setState] = useState<LocationAwarenessState>(() => loadLocationAwareness());
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<LocationZoneKind>('home');
  const [name, setName] = useState(defaultZoneName('home'));
  const [radius, setRadius] = useState(250);
  // 尚未保存任何范围时，先展示阿拉巴马州全貌；选点后地图会自动拉近。
  const [latitude, setLatitude] = useState(32.8067);
  const [longitude, setLongitude] = useState(-86.7911);
  const [coordinateInput, setCoordinateInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loadLocationAwareness().zones.length === 0) return;
    refreshCoarseLocation().then(setState).catch(() => {});
  }, []);

  const runLocationAction = async (action: () => Promise<LocationAwarenessState>) => {
    setBusy(true);
    setError('');
    try {
      setState(await action());
      return true;
    } catch (err: any) {
      setError(err?.message || '定位失败，请检查浏览器的位置权限');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const selectKind = (next: LocationZoneKind) => {
    setKind(next);
    setName(defaultZoneName(next));
    const existing = state.zones.find(zone => zone.kind === next);
    if (existing) {
      setLatitude(existing.latitude);
      setLongitude(existing.longitude);
      setRadius(existing.radiusMeters);
      setName(existing.name);
    }
  };

  const applyCoordinateInput = () => {
    const parsed = parseLocationCoordinates(coordinateInput);
    if (!parsed) {
      setError('没有从这段内容里找到坐标。请粘贴完整地图链接，或输入“纬度, 经度”。');
      return;
    }
    setError('');
    setLatitude(parsed.latitude);
    setLongitude(parsed.longitude);
  };

  const locateSelection = async () => {
    setBusy(true);
    setError('');
    try {
      const position = await getCurrentPositionSmart();
      setLatitude(position.latitude);
      setLongitude(position.longitude);
    } catch (err: any) {
      setError(err?.message || '定位失败，请检查浏览器的位置权限');
    } finally {
      setBusy(false);
    }
  };

  const saveSelectedZone = () => {
    setError('');
    try {
      setState(addLocationZone(kind, name, radius, { latitude, longitude }));
      setAdding(false);
    } catch (err: any) {
      setError(err?.message || '保存失败，请重新选择地点');
    }
  };

  const snapshotText = state.lastSnapshot
    ? `${state.lastSnapshot.zoneId ? `在${state.lastSnapshot.label}` : '在外面'} · ${new Date(state.lastSnapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 更新`
    : '还没有读取当前位置';

  return (
    <div className="flex flex-col h-full" style={{ background: F.appBg }}>
      <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
        <div className="relative flex items-center px-5 py-3">
          <CircleBtn onClick={onBack}><CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} /></CircleBtn>
          <span className="absolute left-0 right-0 flex justify-center text-[16px] font-semibold pointer-events-none"
            style={{ color: F.textPrimary }}>我的位置</span>
          <div className="ml-auto">
            <CircleBtn onClick={() => {
              if (!adding) selectKind(kind);
              setAdding(value => !value);
            }}>
              <Plus size={20} weight="bold" style={{ color: F.textSecondary }} />
            </CircleBtn>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none" style={{ padding: '4px 20px', paddingBottom: 'calc(40px + var(--safe-bottom, 0px))' }}>
        <section style={{ padding: 16, borderRadius: R.bigCard, background: HUE.teal.tint, border: `1px solid ${HUE.teal.soft}` }}>
          <div className="flex items-start" style={{ gap: 12 }}>
            <div className="flex items-center justify-center shrink-0"
              style={{ width: 44, height: 44, borderRadius: R.medium, background: HUE.teal.main }}>
              <NavigationArrow size={21} weight="bold" style={{ color: F.surface }} />
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 18, fontWeight: 700, color: F.textPrimary }}>{snapshotText}</div>
              <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.55, color: F.textSecondary }}>
                经纬度只留在本机。角色只能看到粗略地点和更新时间。
              </div>
            </div>
          </div>
          <button onClick={() => runLocationAction(refreshCoarseLocation)} disabled={busy || state.zones.length === 0}
            className="w-full flex items-center justify-center"
            style={{ height: 46, marginTop: 14, gap: 8, borderRadius: R.button, border: 0,
                     background: state.zones.length === 0 ? F.surfaceSunken : F.textPrimary,
                     color: state.zones.length === 0 ? F.textTertiary : F.surface, fontSize: 14, fontWeight: 700 }}>
            <Crosshair size={19} weight="bold" />
            {busy ? '正在定位…' : '更新当前位置'}
          </button>
        </section>

        <div className="flex items-center" style={{ margin: '18px 2px 10px' }}>
          <div className="flex-1">
            <div style={{ fontSize: 14, fontWeight: 700, color: F.textPrimary }}>允许角色感知</div>
            <div style={{ marginTop: 2, fontSize: 12, color: F.textTertiary }}>关闭后角色无法调用位置工具</div>
          </div>
          <button onClick={() => setState(setLocationAwarenessEnabled(!state.enabled))}
            aria-label="允许角色感知位置" aria-pressed={state.enabled}
            style={{ width: 52, height: 30, padding: 3, border: 0, borderRadius: R.pill,
                     background: state.enabled ? HUE.teal.main : F.surfaceSunken, boxShadow: S.sunken }}>
            <span className="block transition-transform" style={{ width: 24, height: 24, borderRadius: R.pill,
              background: F.surfaceRaised, boxShadow: S.raisedSoft, transform: state.enabled ? 'translateX(22px)' : 'translateX(0)' }} />
          </button>
        </div>

        {adding && (
          <section style={{ marginTop: 14, padding: 16, borderRadius: R.bigCard, background: F.surface,
                            border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: F.textPrimary }}>把这里设为</div>
            <div className="flex" style={{ marginTop: 12, padding: 4, gap: 4, borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}>
              {(Object.keys(LOCATION_KIND_META) as LocationZoneKind[]).map(option => {
                const selected = kind === option;
                return <button key={option} onClick={() => selectKind(option)} className="flex-1"
                  style={{ height: 38, border: 0, borderRadius: R.medium, background: selected ? F.surfaceRaised : 'transparent',
                           boxShadow: selected ? S.raisedSoft : 'none', color: selected ? F.textPrimary : F.textTertiary,
                           fontSize: 13, fontWeight: 600 }}>{LOCATION_KIND_META[option].label}</button>;
              })}
            </div>
            <label className="block" style={{ marginTop: 14, fontSize: 12, color: F.textSecondary }}>地点名称</label>
            <input value={name} onChange={event => setName(event.target.value)}
              style={{ width: '100%', height: 44, marginTop: 6, padding: '0 12px', borderRadius: R.input,
                       border: `1px solid ${F.borderSoft}`, background: F.surfaceSunken, boxShadow: S.sunken,
                       color: F.textPrimary, fontSize: 14 }} />
            <div className="flex items-center" style={{ marginTop: 14 }}>
              <span style={{ fontSize: 12, color: F.textSecondary }}>围栏半径</span>
              <span className="ml-auto" style={{ fontSize: 13, fontWeight: 700, color: HUE.teal.ink }}>{radius} 米</span>
            </div>
            <input type="range" min={50} max={1000} step={50} value={radius}
              onChange={event => setRadius(Number(event.target.value))}
              style={{ width: '100%', marginTop: 8, accentColor: HUE.teal.main }} />
            <div style={{ marginTop: 14, fontSize: 12, color: F.textSecondary }}>在真实地图上点选中心</div>
            <div className="overflow-hidden" style={{ marginTop: 7, borderRadius: R.smallCard, border: `1px solid ${F.borderSoft}` }}>
              <RealLocationPicker
                latitude={latitude}
                longitude={longitude}
                radiusMeters={radius}
                onChange={(nextLatitude, nextLongitude) => {
                  setLatitude(nextLatitude);
                  setLongitude(nextLongitude);
                }}
              />
            </div>
            <div className="flex" style={{ marginTop: 10, gap: 8 }}>
              <input value={coordinateInput} onChange={event => setCoordinateInput(event.target.value)}
                placeholder="地图链接或 33.5, -86.8"
                style={{ flex: 1, minWidth: 0, height: 42, padding: '0 11px', borderRadius: R.input,
                         border: `1px solid ${F.borderSoft}`, background: F.surfaceSunken, boxShadow: S.sunken,
                         color: F.textPrimary, fontSize: 12 }} />
              <button onClick={applyCoordinateInput} aria-label="应用地图链接或坐标"
                className="flex items-center justify-center shrink-0"
                style={{ width: 42, height: 42, border: 0, borderRadius: R.button,
                         background: F.surfaceRaised, boxShadow: S.raisedSoft, color: HUE.teal.ink }}>
                <LinkSimple size={18} weight="bold" />
              </button>
            </div>
            <button disabled={busy} onClick={locateSelection} className="w-full flex items-center justify-center"
              style={{ height: 42, marginTop: 9, gap: 7, borderRadius: R.button, border: `1px solid ${F.borderSoft}`,
                       background: F.surface, color: F.textSecondary, fontSize: 13, fontWeight: 700 }}>
              <Crosshair size={17} weight="bold" />
              {busy ? '正在读取位置…' : '把地图移到当前位置'}
            </button>
            <button disabled={busy} onClick={saveSelectedZone} className="w-full flex items-center justify-center"
              style={{ height: 48, marginTop: 9, gap: 8, borderRadius: R.button, border: 0,
                       background: HUE.teal.main, color: F.surface, fontSize: 14, fontWeight: 700 }}>
              <MapPin size={19} weight="bold" />
              保存这个范围
            </button>
            {kind !== 'supermarket' && state.zones.some(zone => zone.kind === kind) && (
              <div style={{ marginTop: 8, fontSize: 11, color: F.textTertiary }}>保存后会替换原来的{LOCATION_KIND_META[kind].label}范围。</div>
            )}
          </section>
        )}

        {error && <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: R.medium, background: STATUS.danger.tint,
                                color: STATUS.danger.ink, fontSize: 12 }}>{error}</div>}

        <div style={{ margin: '20px 2px 10px', fontSize: 13, fontWeight: 700, color: F.textSecondary }}>已保存范围</div>
        {state.zones.length === 0 ? (
          <div className="flex flex-col items-center justify-center" style={{ padding: '34px 16px', gap: 8,
            borderRadius: R.bigCard, background: F.surfaceSunken, boxShadow: S.sunken }}>
            <ShieldCheck size={20} weight="bold" style={{ color: F.textTertiary }} />
            <div style={{ fontSize: 13, color: F.textTertiary }}>点右上角加号，在地图上选择范围</div>
          </div>
        ) : (
          <div className="overflow-hidden" style={{ borderRadius: R.bigCard, background: F.surface,
            border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
            {state.zones.map((zone, index) => {
              const meta = LOCATION_KIND_META[zone.kind];
              const Icon = meta.icon;
              return <React.Fragment key={zone.id}>
                {index > 0 && <div style={{ height: 1, margin: '0 16px', background: F.divider }} />}
                <div className="flex items-center" style={{ minHeight: 68, padding: '10px 12px', gap: 12 }}>
                  <span className="flex items-center justify-center shrink-0"
                    style={{ width: 44, height: 44, borderRadius: R.medium, background: HUE.teal.main }}>
                    <Icon size={20} weight="bold" style={{ color: F.surface }} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate" style={{ fontSize: 14, fontWeight: 700, color: F.textPrimary }}>{zone.name}</span>
                    <span className="block" style={{ marginTop: 2, fontSize: 12, color: F.textTertiary }}>{meta.label} · 半径 {zone.radiusMeters} 米</span>
                  </span>
                  <CircleBtn onClick={() => {
                    if (window.confirm(`删除“${zone.name}”这个范围？`)) setState(removeLocationZone(zone.id));
                  }} style={{ width: 40, height: 40 }}>
                    <Trash size={18} weight="bold" style={{ color: STATUS.danger.ink }} />
                  </CircleBtn>
                </div>
              </React.Fragment>;
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
//  MapApp — Root
// ══════════════════════════════════════════════════════════════

type View =
  | { type: 'shelf' }
  | { type: 'my-location' }
  | { type: 'map'; worldId: string }
  | { type: 'editor'; worldId: string; isNew: boolean }
  | { type: 'create'; charId: string };

export default function MapApp() {
  const { characters, apiConfig } = useOS();
  const [view, setView] = useState<View>({ type: 'shelf' });
  const [worlds, setWorlds] = useState<MapWorld[]>([]);
  const [schedules, setSchedules] = useState<Record<string, DailySchedule | null>>({});
  const [loaded, setLoaded] = useState(false);

  // Load worlds from DB, seed default if empty
  useEffect(() => {
    (async () => {
      let stored = await MapDB.getAll().catch(() => [] as MapWorld[]);

      if (stored.length === 0) {
        const char = characters.find(c => c.name.includes(SEED_WORLD.charNameMatch));
        if (char) {
          const { charNameMatch: _m, ...seedBase } = SEED_WORLD;
          const seeded: MapWorld = { ...seedBase, charId: char.id };
          await MapDB.save(seeded).catch(() => {});
          stored = [seeded];
        }
      }

      setWorlds(stored);
      setLoaded(true);
    })();
  }, [characters]);

  // Load today's schedules for all characters
  useEffect(() => {
    if (characters.length === 0) return;
    const today = new Date().toISOString().split('T')[0];
    (async () => {
      const result: Record<string, DailySchedule | null> = {};
      for (const c of characters) {
        try { result[c.id] = await DB.getDailySchedule(c.id, today); } catch { result[c.id] = null; }
      }
      setSchedules(result);
    })();
  }, [characters]);

  const handleSaveWorld = useCallback(async (w: MapWorld) => {
    await MapDB.save(w);
    setWorlds(prev => {
      const idx = prev.findIndex(p => p.id === w.id);
      return idx >= 0 ? prev.map((p, i) => i === idx ? w : p) : [...prev, w];
    });
    setView({ type: 'map', worldId: w.id });
  }, []);

  const handleDeleteWorld = useCallback(async (id: string) => {
    await MapDB.remove(id);
    setWorlds(prev => prev.filter(w => w.id !== id));
    setView({ type: 'shelf' });
  }, []);

  if (!loaded) return null;

  let screen: React.ReactNode;

  if (view.type === 'my-location') {
    screen = <MyLocationScreen onBack={() => setView({ type: 'shelf' })} />;
  } else if (view.type === 'create') {
    const char = characters.find(c => c.id === view.charId);
    if (!char) { setView({ type: 'shelf' }); return null; }
    const newWorld: MapWorld = {
      id: `world_${Date.now()}`,
      charId: char.id,
      genre: '',
      tag: '朋友',
      tagColor: '',
      tagBg: '',
      regions: [],
      homeRegionId: undefined,
    };
    screen = <WorldEditor world={newWorld} char={char} isNew apiConfig={apiConfig}
      onSave={handleSaveWorld} onBack={() => setView({ type: 'shelf' })} />;
  } else if (view.type === 'editor') {
    const world = worlds.find(w => w.id === view.worldId);
    const char = world ? characters.find(c => c.id === world.charId) : undefined;
    if (!world || !char) { setView({ type: 'shelf' }); return null; }
    screen = <WorldEditor world={world} char={char} apiConfig={apiConfig}
      onSave={handleSaveWorld} onDelete={() => handleDeleteWorld(world.id)}
      onBack={() => setView({ type: 'map', worldId: world.id })} />;
  } else if (view.type === 'map') {
    const world = worlds.find(w => w.id === view.worldId);
    const char = world ? characters.find(c => c.id === world.charId) : undefined;
    if (!world || !char) { setView({ type: 'shelf' }); return null; }
    screen = <MapScreen world={world} char={char} schedule={schedules[world.charId] || null}
      onBack={() => setView({ type: 'shelf' })}
      onEdit={() => setView({ type: 'editor', worldId: world.id, isNew: false })} />;
  } else {
    screen = <Shelf worlds={worlds} characters={characters} schedules={schedules}
      onOpenWorld={id => setView({ type: 'map', worldId: id })}
      onCreateWorld={charId => setView({ type: 'create', charId })}
      onOpenMyLocation={() => setView({ type: 'my-location' })} />;
  }

  return (
    <div className="h-full">
      {/* 忙碌圆点呼吸动画（amber 光晕，handoff 指定） */}
      <style>{`@keyframes mapnowpulse{0%{box-shadow:0 0 0 0 rgba(245,169,20,.5)}70%{box-shadow:0 0 0 9px rgba(245,169,20,0)}100%{box-shadow:0 0 0 0 rgba(245,169,20,0)}}`}</style>
      {screen}
    </div>
  );
}
