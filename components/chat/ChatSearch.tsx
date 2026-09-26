import React, { useEffect, useMemo, useState } from 'react';
import {
  CaretLeft,
  CaretRight,
  Cards,
  ChatCircleText,
  LinkSimple,
  MagnifyingGlass,
  Microphone,
  X,
} from '@phosphor-icons/react';
import type { CharacterProfile, Message } from '../../types';
import { DB } from '../../utils/db';
import {
  buildChatSearchSnippet,
  searchChatMessages,
  type ChatSearchCategory,
} from '../../utils/chatSearch';
import {
  buildChatCalendarMonth,
  getChatDateKeys,
  shiftChatCalendarMonth,
} from '../../utils/chatSearchCalendar';
import { F, FONT, HUE, MOTION, R, S, STATUS } from '../../utils/clayTokens';

type ChatSearchProps = {
  character: CharacterProfile;
  onClose: () => void;
  onOpenMessage: (message: Message) => void;
};

type VisibleSearchCategory = Exclude<ChatSearchCategory, 'text'>;
type SearchMode = VisibleSearchCategory | 'date';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const TYPE_META: Record<string, { label: string; Icon: typeof ChatCircleText }> = {
  text: { label: '文字', Icon: ChatCircleText },
  voice: { label: '语音', Icon: Microphone },
  webpage_card: { label: '链接', Icon: LinkSimple },
  html_card: { label: 'HTML', Icon: Cards },
  xhs_card: { label: '小红书', Icon: Cards },
};

function formatResultTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function formatDateTabLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}/${day}`;
}

const RaisedIconButton = ({ onClick, label, children, disabled = false }: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className="flex shrink-0 items-center justify-center active:opacity-40 transition-opacity"
    style={{
      width: 44,
      height: 44,
      borderRadius: R.pill,
      background: 'transparent',
      border: 'none',
      boxShadow: 'none',
      opacity: disabled ? 0.3 : 1,
    }}
  >
    {children}
  </button>
);

const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string; ariaLabel?: string; ariaExpanded?: boolean }>;
  value: T;
  onChange: (value: T) => void;
}) => (
  <div
    className="flex min-w-max items-center gap-1 p-1"
    style={{ borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}
  >
    {options.map(option => {
      const selected = option.id === value;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-label={option.ariaLabel || option.label}
          aria-expanded={option.ariaExpanded}
          className="h-9 whitespace-nowrap px-4 text-xs font-semibold active:translate-y-[1px] transition-all"
          style={{
            borderRadius: R.medium,
            color: selected ? F.textPrimary : F.textTertiary,
            background: selected ? F.surfaceRaised : 'transparent',
            boxShadow: selected ? S.raisedSoft : 'none',
            transitionDuration: MOTION.hover,
          }}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

const ChatSearch: React.FC<ChatSearchProps> = ({ character, onClose, onOpenMessage }) => {
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<VisibleSearchCategory>('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    DB.getMessagesByCharId(character.id, true)
      .then(messages => {
        if (!alive) return;
        setAllMessages(messages);
        const latest = messages
          .filter(message => message.role !== 'system')
          .reduce((max, message) => Math.max(max, message.timestamp || 0), 0);
        if (latest > 0) {
          const latestDate = new Date(latest);
          setCalendarMonth(new Date(latestDate.getFullYear(), latestDate.getMonth(), 1));
        }
        setError('');
      })
      .catch(searchError => {
        if (!alive) return;
        setError(searchError instanceof Error ? searchError.message : '聊天记录读取失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [character.id]);

  const activeDateKeys = useMemo(() => getChatDateKeys(allMessages), [allMessages]);
  const searchModeOptions = useMemo<Array<{
    id: SearchMode;
    label: string;
    ariaLabel?: string;
    ariaExpanded?: boolean;
  }>>(() => [
    { id: 'all', label: '全部' },
    {
      id: 'date',
      label: selectedDate ? formatDateTabLabel(selectedDate) : '日期',
      ariaLabel: selectedDate ? `日期，已选${formatDateLabel(selectedDate)}` : '按日期查找',
      ariaExpanded: calendarOpen,
    },
    { id: 'voice', label: '语音' },
    { id: 'link', label: '链接' },
    { id: 'card', label: '卡片' },
  ], [calendarOpen, selectedDate]);
  const activeMode: SearchMode = selectedDate ? 'date' : category;
  const calendarCells = useMemo(() => buildChatCalendarMonth(
    calendarMonth.getFullYear(),
    calendarMonth.getMonth(),
    activeDateKeys,
  ), [activeDateKeys, calendarMonth]);

  const results = useMemo(() => searchChatMessages(allMessages, {
    keyword,
    category,
    dateFrom: selectedDate,
    dateTo: selectedDate,
    limit: 200,
  }), [allMessages, keyword, category, selectedDate]);

  const handleModeChange = (nextMode: SearchMode) => {
    if (nextMode === 'date') {
      setCalendarOpen(open => !open);
      return;
    }
    setCalendarOpen(false);
    setSelectedDate('');
    setCategory(nextMode);
  };

  const earliestMonth = useMemo(() => {
    if (activeDateKeys.size === 0) return null;
    const earliest = [...activeDateKeys].sort()[0];
    const [year, month] = earliest.split('-').map(Number);
    return year * 12 + month - 1;
  }, [activeDateKeys]);
  const now = new Date();
  const currentMonth = now.getFullYear() * 12 + now.getMonth();
  const visibleMonth = calendarMonth.getFullYear() * 12 + calendarMonth.getMonth();
  const canGoPrevious = earliestMonth !== null && visibleMonth > earliestMonth;
  const canGoNext = visibleMonth < currentMonth;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: F.appBg, color: F.textPrimary }}>
      <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
        <div className="relative flex items-center px-5 py-3">
          <RaisedIconButton onClick={onClose} label="返回聊天">
            <CaretLeft size={22} weight="bold" style={{ color: F.textPrimary }} />
          </RaisedIconButton>
          <span className="pointer-events-none absolute left-0 right-0 flex justify-center" style={{ ...FONT.navTitle, fontFamily: FONT.heading }}>
            查找聊天记录
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 no-scrollbar" style={{ paddingBottom: 'calc(2rem + var(--safe-bottom))' }}>
        <p className="mb-3 mt-1 text-xs" style={{ color: F.textTertiary }}>只查找与 {character.name} 的私聊</p>
        <div
          className="flex h-12 items-center gap-3 px-4"
          style={{
            borderRadius: R.input,
            background: F.surfaceSunken,
            border: `1px solid ${inputFocused ? F.accent : F.borderSoft}`,
            boxShadow: S.sunken,
          }}
        >
          <MagnifyingGlass size={20} weight="bold" style={{ color: F.textTertiary }} />
          <input
            type="search"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="搜关键词"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-70"
            style={{ color: F.textPrimary }}
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword('')}
              aria-label="清空关键词"
              className="flex h-8 w-8 items-center justify-center active:translate-y-[1px]"
              style={{ borderRadius: R.pill, color: F.textTertiary }}
            >
              <X size={16} weight="bold" />
            </button>
          )}
        </div>

        <div className="mt-4 overflow-x-auto no-scrollbar">
          <SegmentedControl options={searchModeOptions} value={activeMode} onChange={handleModeChange} />
        </div>

        {calendarOpen && (
          <div className="mt-4">
            <div className="mb-4 flex items-center justify-between px-1">
              <RaisedIconButton
                onClick={() => setCalendarMonth(month => shiftChatCalendarMonth(month, -1))}
                label="上一个月"
                disabled={!canGoPrevious}
              >
                <CaretLeft size={20} weight="bold" style={{ color: F.textPrimary }} />
              </RaisedIconButton>
              <div className="text-center">
                <div className="text-base font-semibold tabular-nums">
                  {calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月
                </div>
                <div className="mt-1 text-[11px]" style={{ color: F.textTertiary }}>亮起的日期有聊天记录</div>
              </div>
              <RaisedIconButton
                onClick={() => setCalendarMonth(month => shiftChatCalendarMonth(month, 1))}
                label="下一个月"
                disabled={!canGoNext}
              >
                <CaretRight size={20} weight="bold" style={{ color: F.textPrimary }} />
              </RaisedIconButton>
            </div>

            <div className="px-3 pb-5 pt-4" style={{ borderRadius: R.bigCard, background: F.surface, boxShadow: S.raisedSoft }}>
              <div className="grid grid-cols-7 pb-3">
                {WEEK_LABELS.map(label => (
                  <span key={label} className="text-center text-[11px] font-medium" style={{ color: F.textTertiary }}>{label}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-2">
                {calendarCells.map((cell, index) => {
                  if (!cell) return <span key={`blank-${index}`} className="aspect-square" />;
                  const selected = selectedDate === cell.dateKey;
                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      disabled={!cell.active}
                      onClick={() => {
                        setCategory('all');
                        setSelectedDate(cell.dateKey);
                        setCalendarOpen(false);
                      }}
                      aria-label={`${formatDateLabel(cell.dateKey)}${cell.active ? '，有聊天' : '，无聊天'}`}
                      className="relative mx-auto flex aspect-square w-10 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-all disabled:cursor-default"
                      style={{
                        color: selected ? F.surfaceRaised : (cell.active ? F.textPrimary : F.textTertiary),
                        background: selected ? F.accent : 'transparent',
                        boxShadow: selected ? S.raisedSoft : 'none',
                        opacity: cell.active || selected ? 1 : 0.34,
                        transitionDuration: MOTION.hover,
                      }}
                    >
                      {cell.day}
                      {cell.today && (
                        <span className="absolute bottom-1 h-1 w-1 rounded-full" style={{ background: selected ? F.surfaceRaised : F.accent }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 px-1 text-center text-xs leading-5" style={{ color: F.textTertiary }}>
              图片也会让日期亮起，但图片本身仍统一在角色相册查看。
            </div>
          </div>
        )}

        <div className="mb-2 mt-6 flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: F.textPrimary }}>结果</span>
          {!loading && !error && <span className="text-xs tabular-nums" style={{ color: F.textTertiary }}>{results.length} 条</span>}
        </div>

        {loading && (
          <div style={{ borderRadius: R.bigCard, background: F.surface, boxShadow: S.raisedSoft, overflow: 'hidden' }}>
            {[0, 1, 2].map(index => (
              <div key={index} className="flex animate-pulse gap-3 p-4" style={{ borderTop: index ? `1px solid ${F.divider}` : undefined }}>
                <div className="h-10 w-10 shrink-0" style={{ borderRadius: R.small, background: F.surfaceSunken }} />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 w-24" style={{ borderRadius: R.tiny, background: F.surfaceSunken }} />
                  <div className="h-3 w-full" style={{ borderRadius: R.tiny, background: F.surfaceSunken }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex min-h-28 items-center justify-center px-5 text-center text-sm" style={{ borderRadius: R.large, background: STATUS.danger.tint, color: STATUS.danger.ink, boxShadow: S.sunken }}>
            {error}
          </div>
        )}

        {!loading && !error && results.length === 0 && (
          <div className="flex min-h-36 flex-col items-center justify-center gap-3 px-5 text-center" style={{ borderRadius: R.large, background: F.surfaceSunken, boxShadow: S.sunken }}>
            <MagnifyingGlass size={18} weight="bold" style={{ color: F.textTertiary }} />
            <span className="text-sm leading-5" style={{ color: F.textTertiary }}>
              {selectedDate && activeDateKeys.has(selectedDate)
                ? '这天没有可搜索的文字、语音、链接或卡片，图片请到相册查看'
                : '没有找到符合条件的聊天'}
            </span>
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <div style={{ borderRadius: R.bigCard, background: F.surface, boxShadow: S.raisedSoft, overflow: 'hidden' }}>
            {results.map((message, index) => {
              const typeMeta = TYPE_META[message.type] || TYPE_META.text;
              const TypeIcon = typeMeta.Icon;
              const senderName = message.role === 'user' ? '我' : character.name;
              return (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => onOpenMessage(message)}
                  className="flex w-full items-start gap-3 p-4 text-left active:translate-y-[1px] transition-transform"
                  style={{ borderTop: index ? `1px solid ${F.divider}` : undefined, transitionDuration: MOTION.tap }}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center" style={{ borderRadius: R.small, background: HUE.brown.tint, color: HUE.brown.main }}>
                    <TypeIcon size={20} weight="bold" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <strong className="min-w-0 flex-1 truncate text-sm">{senderName}</strong>
                      <span className="shrink-0 text-[11px] tabular-nums" style={{ color: F.textTertiary }}>{formatResultTime(message.timestamp)}</span>
                    </span>
                    <span className="mt-1 block text-[11px]" style={{ color: F.textTertiary }}>{typeMeta.label}</span>
                    <span className="mt-1.5 block text-[13px] leading-5" style={{ color: F.textSecondary }}>
                      {buildChatSearchSnippet(message, keyword)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatSearch;
