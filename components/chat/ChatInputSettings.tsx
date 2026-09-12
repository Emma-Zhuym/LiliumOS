import React, { useState } from 'react';
import { Question } from '@phosphor-icons/react';
import { F, S, R, HUE } from '../../utils/clayTokens'; // [EM: input-preferences-clay]
import type { ChatInputPreferences } from '../../utils/chatInputPreferences';

interface ChatInputSettingsProps {
    value: ChatInputPreferences;
    onChange: (value: ChatInputPreferences) => void;
    scope?: 'private' | 'group';
}

const ChatInputSettings: React.FC<ChatInputSettingsProps> = ({ value, onChange, scope = 'private' }) => {
    const [openHelp, setOpenHelp] = useState<keyof ChatInputPreferences | null>(null);
    return (
        <div className="overflow-hidden p-4" style={{ background: F.surface, borderRadius: R.bigCard, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
            <p className="mb-2 text-xs" style={{ color: F.textTertiary }}>以下输入习惯对当前设备的私聊和群聊生效</p>
            {([
                {
                    key: 'sendButtonGenerates',
                    label: '发送按钮代替生成按钮',
                    help: '开启后，不用够右上角的闪电了。输入框里有光标时，右下角发文字；点一下聊天空白处，右下角就变成闪电，让对方回复已发送的消息。只收起键盘可能还留着光标，点一下空白处就好。没发出的草稿会保留。',
                },
                {
                    key: 'enterToSend',
                    label: '回车发送文字',
                    help: '勾选时，按回车发送文字，Shift + 回车换行；不勾选时，回车只换行，点发送按钮发出文字。输入法选字时按回车不会误发。',
                },
                {
                    key: 'autoReply',
                    label: '发完后自动生成回复',
                    help: '发过文字、图片或表情后，等输入框没有草稿和光标、加号等底部面板全部收起，再等 2 秒让对方回复。继续输入、打开面板或发送新消息，就重新等待。倒计时可以取消。' + (scope === 'group' ? '群聊沿用本群的导演或轮询模式；退出群聊会取消等待。' : '这项开启时，Instant Push 的发送即回复也会按这里等。'),
                },
                {
                    key: 'emojiSuggestions',
                    label: '表情包智能匹配',
                    help: '输入“抱”就会联想名称里有“抱”的表情包，点击候选即可发送。私聊匹配当前角色可见的所有分类，群聊匹配群聊表情库的所有分类，文字草稿会保留。两者共用开关，默认关闭。',
                },
            ] as const).map(({ key, label, help }) => (
                <div key={key} style={{ borderTop: `1px solid ${F.divider}` }}>
                    <div className="flex min-h-16 items-center gap-1">
                        <label style={{ color: F.textSecondary }} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
                            <span>{label}</span>
                            <input type="checkbox" role="switch" checked={value[key]}
                                onChange={event => onChange({ ...value, [key]: event.target.checked })}
                                className="peer sr-only" />
                            <span aria-hidden="true" className="relative h-7 w-11 shrink-0 peer-focus-visible:outline peer-focus-visible:outline-2"
                                style={{ borderRadius: R.pill, background: value[key] ? HUE.indigo.main : F.surfaceSunken, boxShadow: S.sunken }}>
                                <span className="absolute top-1 h-5 w-5" style={{ left: value[key] ? 20 : 4, borderRadius: R.pill, background: F.surfaceRaised, boxShadow: S.raisedSoft }} />
                            </span>
                        </label>
                        <button
                            type="button"
                            aria-label={`${label}说明`}
                            aria-expanded={openHelp === key}
                            aria-controls={`chat-input-help-${key}`}
                            onClick={() => setOpenHelp(openHelp === key ? null : key)}
                            className="flex h-11 w-11 shrink-0 items-center justify-center" style={{ borderRadius: R.pill, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft, color: openHelp === key ? HUE.indigo.ink : F.textSecondary }}
                        >
                            <Question size={18} weight="bold" />
                        </button>
                    </div>
                    <p id={`chat-input-help-${key}`} hidden={openHelp !== key} className="px-3 py-2 text-xs leading-relaxed" style={{ borderRadius: R.input, background: F.surfaceSunken, color: F.textSecondary, boxShadow: S.sunken }}>{help}</p>
                </div>
            ))}
        </div>
    );
};

export default ChatInputSettings;
