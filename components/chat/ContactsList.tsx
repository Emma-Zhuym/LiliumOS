import React, { useEffect, useState, useCallback } from 'react';
import TokenImg from '../os/TokenImg'; // [EM: token-img-avatars]
import { CaretLeft, ChatCircle } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { useContactRemark } from '../../utils/contactRemarks';
import { DB } from '../../utils/db';
import { CharacterProfile, DailySchedule } from '../../types';
import { useCharStatus } from '../../hooks/useCharStatus';
import { F, MOTION, R, S } from '../../utils/clayTokens';

type RowMeta = {
  char: CharacterProfile;
  preview: string;
  lastAt: number;
};

// 每行独立加载日程 + 计算状态，避免父组件批量请求
const ContactRow: React.FC<{
  meta: RowMeta;
  unread: number;
  onClick: () => void;
}> = ({ meta, unread, onClick }) => {
  const { char, preview } = meta;
  const remark = useContactRemark(char.id); // [EM: private-contact-remark]
  const today = new Date().toISOString().split('T')[0];
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);

  useEffect(() => {
    DB.getDailySchedule(char.id, today).then(s => setSchedule(s ?? null)).catch(() => {});
  }, [char.id, today]);

  const { status } = useCharStatus(schedule, char);

  const dotColor =
    status === 'online'  ? 'bg-emerald-400' :
    status === 'busy'    ? 'bg-amber-400'   :
                           'bg-slate-400';
  const dotGlow =
    status === 'online'  ? '0 0 5px #4ade80' :
    status === 'busy'    ? '0 0 5px #fbbf24' :
                           'none';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 mb-2 rounded-2xl bg-white/90 border border-slate-200/80 shadow-sm active:scale-[0.99] transition-transform text-left"
    >
      <div className="relative shrink-0">
        <TokenImg value={char.avatar} alt="" className="w-14 h-14 rounded-2xl object-cover shadow-sm" />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : (
          <span
            className={`absolute bottom-0.5 right-0.5 w-3 h-3 ${dotColor} rounded-full border-2 border-white`}
            style={{ boxShadow: dotGlow }}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-slate-800 truncate">{remark || char.name}</div>
        <div className="text-xs text-slate-500 truncate mt-0.5">{preview}</div>
      </div>
    </button>
  );
};

/**
 * Dock Message 通讯录：列出角色 + 未读红点 + 最后一条预览。
 */
const ContactsList: React.FC = () => {
  const {
    characters,
    unreadMessages,
    setActiveCharacterId,
    setMessageSubView,
    clearUnread,
    closeApp,
    registerBackHandler,
    lastMsgTimestamp,
  } = useOS();

  const [rows, setRows] = useState<RowMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPreviews = useCallback(async () => {
    if (characters.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const metas = await Promise.all(
        characters.map(async (char) => {
          try {
            const { messages, totalCount } = await DB.getRecentMessagesWithCount(char.id, 1);
            const last = messages[messages.length - 1];
            let preview = '';
            let lastAt = 0;
            if (last) {
              lastAt = last.timestamp ?? last.id ?? 0;
              if (last.type === 'image') preview = '[图片]';
              else if (last.content) {
                preview = last.content.replace(/\[.*?\]/g, '').trim().slice(0, 80);
                if (!preview) preview = '[消息]';
              } else preview = totalCount > 0 ? '…' : '';
            } else {
              preview = char.description?.slice(0, 60) || '暂无消息';
            }
            return { char, preview, lastAt };
          } catch {
            return { char, preview: '…', lastAt: 0 };
          }
        })
      );
      metas.sort((a, b) => {
        const ua = unreadMessages[a.char.id] || 0;
        const ub = unreadMessages[b.char.id] || 0;
        if (ua !== ub) return ub - ua;
        return b.lastAt - a.lastAt;
      });
      setRows(metas);
    } finally {
      setLoading(false);
    }
  }, [characters, unreadMessages, lastMsgTimestamp]);

  useEffect(() => {
    loadPreviews();
  }, [loadPreviews]);

  useEffect(() => {
    const un = registerBackHandler(() => {
      closeApp();
      return true;
    });
    return un;
  }, [registerBackHandler, closeApp]);

  const handleSelect = (charId: string) => {
    setMessageSubView('chat');
    setActiveCharacterId(charId);
    clearUnread(charId);
  };

  const handleClose = () => {
    closeApp();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden relative font-sans" style={{ background: F.appBg }}>
      <div className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
        <div className="relative flex items-center px-5 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex items-center justify-center active:translate-y-[1px] transition-transform"
            style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surfaceRaised, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, transitionDuration: MOTION.tap }}
            aria-label="返回"
          >
            <CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} />
          </button>
          <span className="absolute left-0 right-0 flex justify-center text-[16px] font-semibold pointer-events-none" style={{ color: F.textPrimary }}>通讯录</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-3" style={{ paddingBottom: 'calc(2rem + var(--safe-bottom))' }}>{/* [EM: safe-bottom] */}
        {loading && characters.length > 0 && (
          <div className="flex justify-center py-12 text-slate-400 text-sm">加载中…</div>
        )}
        {!loading && characters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-slate-500">
            <ChatCircle className="w-14 h-14 opacity-30 mb-3" weight="duotone" />
            <p className="text-sm font-medium">暂无角色</p>
            <p className="text-xs mt-2 opacity-70">请先在「神经链接」里创建角色</p>
          </div>
        )}
        {rows.map((meta) => (
          <ContactRow
            key={meta.char.id}
            meta={meta}
            unread={unreadMessages[meta.char.id] || 0}
            onClick={() => handleSelect(meta.char.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default ContactsList;
