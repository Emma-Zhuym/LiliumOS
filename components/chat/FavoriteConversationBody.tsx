import React, { useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { PRESET_THEMES } from './ChatConstants';
import { resolveChatTheme } from '../../utils/groupChat/theme';
import type { ConversationFavoriteLine } from '../../utils/contentFavorites';
import type { Message } from '../../types';
import { F } from '../../utils/clayTokens';
import MessageItem from './MessageItem';

const noop = () => {};
/** 收起时露出的条数；更长的对话点「展开」再看全。 */
const COLLAPSED_LINES = 4;

/** 一段对话收藏：每一行仍用聊天气泡渲染，跟收藏那一刻聊天里看到的一样。 */
export default function FavoriteConversationBody({ charId, charName, lines }: { charId: string; charName: string; lines: ConversationFavoriteLine[] }) {
    const { characters, customThemes, userProfile } = useOS();
    const char = characters.find(item => item.id === charId);
    const theme = useMemo(() => resolveChatTheme(char?.bubbleStyle || 'default', customThemes, PRESET_THEMES), [char?.bubbleStyle, customThemes]);
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
    return <div className="min-w-0 pt-3" data-favorite-kind="conversation">
        {shown.map((line, index) => {
            const message: Message = {
                id: line.messageId, charId, role: line.role, type: line.type, content: line.content,
                timestamp: line.timestamp, replyTo: line.replyTo, metadata: line.metadata,
            };
            const previous = shown[index - 1];
            const next = shown[index + 1];
            return <MessageItem key={`${line.messageId}-${index}`} msg={message} activeTheme={theme} charAvatar={char?.avatar || ''} charName={charName}
                userAvatar={userProfile.avatar || ''} isFirstInGroup={previous?.role !== line.role} isLastInGroup={next?.role !== line.role}
                onLongPress={noop} onReply={noop} selectionMode={false} isSelected={false} onToggleSelect={noop}
                showTimestamp="never" suppressEntranceAnimation onPlayVoice={noop} isVoicePlaying={false} />;
        })}
        {lines.length > COLLAPSED_LINES && <button type="button" onClick={() => setExpanded(value => !value)} className="min-h-11 text-xs" style={{ color: F.textSecondary }}>
            {expanded ? '收起' : `展开全部 ${lines.length} 条`}
        </button>}
    </div>;
}
