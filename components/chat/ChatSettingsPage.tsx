import React, { useEffect, useState } from 'react';
import { CaretLeft, CaretRight, MagnifyingGlass, Check, Trash } from '@phosphor-icons/react';
import { CharacterProfile } from '../../types';
import { F, HUE, R, S, STATUS } from '../../utils/clayTokens';
import { saveContactRemark, useContactRemark } from '../../utils/contactRemarks';
import TokenImg from '../os/TokenImg';
import { PRESET_THEMES } from './ChatConstants';
import { useOS } from '../../context/OSContext';

export type ChatSettingsGroup = 'input' | 'background' | 'memory' | 'voice' | 'extensions' | 'records' | 'display';
export const CHAT_SETTINGS_TITLES: Record<ChatSettingsGroup, string> = {
    input: '输入与回复', background: '聊天背景', memory: '上下文与记忆', voice: '语言与语音',
    extensions: '扩展能力', records: '管理与清理记录', display: '系统消息显示',
};

export function ChatSettingsFrame({ title, onClose, children, footer, isOpen = true }: {
    title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; isOpen?: boolean;
}) {
    const { registerBackHandler } = useOS();
    useEffect(() => {
        if (!isOpen) return;
        return registerBackHandler(() => { onClose(); return true; });
    }, [isOpen, onClose, registerBackHandler]);
    if (!isOpen) return null;
    return <section className="absolute inset-0 z-[45] flex flex-col overflow-hidden" style={{ background: F.appBg, color: F.textPrimary }} aria-label={title}>
        <header className="shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
            <div className="relative flex items-center px-4 py-3">
                <button type="button" aria-label={`返回${title === '聊天设置' ? '聊天' : '聊天设置'}`} onClick={onClose}
                    className="flex items-center justify-center shrink-0" style={{ width: 44, height: 44, borderRadius: R.pill, background: F.surface, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
                    <CaretLeft size={20} weight="bold" color={F.textSecondary} />
                </button>
                <h1 className="absolute inset-x-16 text-center text-base font-semibold pointer-events-none">{title}</h1>
            </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-2 pb-6">{children}</div>
        {footer && <div className="shrink-0 px-4 pt-3 pb-4">{footer}</div>}
    </section>;
}

function Row({ title, subtitle, value, onClick, search = false }: { title: string; subtitle?: string; value?: string; onClick: () => void; search?: boolean }) {
    return <button type="button" onClick={onClick} className="flex w-full min-h-16 items-center gap-3 text-left py-3">
        {search && <MagnifyingGlass size={20} weight="bold" color={HUE.purple.ink} />}
        <span className="flex-1 min-w-0"><span className="block text-sm">{title}</span>{subtitle && <span className="block mt-1 text-xs" style={{ color: F.textTertiary }}>{subtitle}</span>}</span>
        {value && <span className="max-w-[45%] truncate text-xs" style={{ color: F.textSecondary }}>{value}</span>}
        <CaretRight size={16} color={F.textTertiary} className="shrink-0" />
    </button>;
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
    return <section className="mb-4">{title && <h2 className="px-3 pt-3 pb-2 text-xs" style={{ color: F.textTertiary }}>{title}</h2>}
        <div className="px-4" style={{ background: F.surface, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
            {React.Children.toArray(children).map((child, index) => <div key={index} style={index ? { borderTop: `1px solid ${F.divider}` } : undefined}>{child}</div>)}
        </div>
    </section>;
}

export default function ChatSettingsPage({ character, onClose, onCharacter, onSearch, onGroup, onAction, onError, mcdActivated, mcdConfigured }: {
    character: CharacterProfile; onClose: () => void; onCharacter: () => void; onSearch: () => void;
    onGroup: (group: ChatSettingsGroup) => void; onAction: (action: string) => void; onError: () => void;
    mcdActivated: boolean; mcdConfigured: boolean;
}) {
    const { customThemes, updateCharacter, removeCustomTheme } = useOS();
    const [bubbleSearch, setBubbleSearch] = useState('');
    const [deletingTheme, setDeletingTheme] = useState<string | null>(null);
    const remark = useContactRemark(character.id);
    const [view, setView] = useState<'home' | 'remark' | 'proactive' | 'appearance' | 'extensions' | 'display' | 'bubbles'>('home');
    const [draft, setDraft] = useState(remark);
    const titles = { home: '聊天设置', remark: '设置备注', proactive: '主动与定时消息', appearance: '背景与聊天装扮', extensions: '扩展能力', display: '思考与系统消息', bubbles: '气泡样式' };
    const save = () => { try { saveContactRemark(character.id, draft); setView('home'); } catch { onError(); } };
    return <ChatSettingsFrame title={titles[view]} onClose={() => view === 'home' ? onClose() : setView(view === 'bubbles' ? 'appearance' : 'home')}
        footer={view === 'remark' ? <button type="button" onClick={save} className="h-12 w-full text-sm font-semibold" style={{ background: F.textPrimary, color: F.surface, borderRadius: R.button }}>保存备注</button> : undefined}>
        {view === 'home' && <>
            <Group>
                <button type="button" aria-label="打开角色设定" onClick={onCharacter} className="flex items-center w-full gap-3 py-3 text-left">
                    <TokenImg value={character.avatar} className="w-12 h-12 object-cover shrink-0" style={{ borderRadius: R.pill }} alt="角色头像" />
                    <span className="min-w-0 flex-1"><strong className="block truncate text-base font-semibold">{remark || character.name}</strong><span className="block text-xs mt-1" style={{ color: F.textTertiary }}>原名：{character.name}</span></span>
                    <CaretRight size={16} color={F.textTertiary} />
                </button>
                <Row title="设置备注" value={remark || '未设置'} onClick={() => { setDraft(remark); setView('remark'); }} />
            </Group>
            <Group><Row title="查找聊天记录" search onClick={onSearch} /></Group>
            <Group title="聊天方式">
                <Row title="输入与回复" subtitle="发送方式、回复触发、表情联想" onClick={() => onGroup('input')} />
                <Row title="主动与定时消息" subtitle="主动消息、定时消息、主动消息 2.0" onClick={() => setView('proactive')} />
                <Row title="语言与语音" subtitle="翻译、语音显示与相关偏好" onClick={() => onGroup('voice')} />
            </Group>
            <Group title="记忆与能力">
                <Row title="上下文与记忆" subtitle="原文读取范围、语境与归档设置" onClick={() => onGroup('memory')} />
                <Row title="扩展能力" subtitle="HTML 模式、小红书、麦当劳等" onClick={() => setView('extensions')} />
            </Group>
            <Group title="聊天外观">
                <Row title="背景与聊天装扮" subtitle="背景、气泡、字体与细节微调" onClick={() => setView('appearance')} />
                <Row title="白框自定义" onClick={() => onAction('chrome-css')} />
                <Row title="思考与系统消息" subtitle="思考展示、系统日志显示" onClick={() => setView('display')} />
            </Group>
            <Group title="聊天记录"><Row title="管理与清理记录" onClick={() => onGroup('records')} /></Group>
        </>}
        {view === 'remark' && <><label htmlFor="contact-remark" className="block text-sm mb-3">备注名</label><input id="contact-remark" value={draft} onChange={e => setDraft(e.target.value)} placeholder={character.name} className="w-full p-4 outline-none" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken }} /><p className="text-xs mt-3 leading-relaxed" style={{ color: F.textSecondary }}>只在你的联系人列表和聊天页面显示，不发送给 AI。清空后恢复原名。</p></>}
        {view === 'proactive' && <Group><Row title="主动消息" onClick={() => onAction('proactive')} /><Row title="定时消息" onClick={() => onAction('active-msg-2')} /><Row title="主动消息 2.0" onClick={() => onAction('active-msg-2')} /></Group>}
        {view === 'appearance' && <Group><Row title="聊天背景" onClick={() => onGroup('background')} /><Row title="聊天装扮" onClick={() => onAction('fine-tune')} /><Row title="气泡样式" onClick={() => setView('bubbles')} /></Group>}
        {view === 'extensions' && <Group><Row title="HTML、小红书与照片风格" onClick={() => onGroup('extensions')} /><Row title={mcdActivated ? '结束麦请求' : '麦当劳'} onClick={() => onAction(mcdActivated ? 'mcd-end' : mcdConfigured ? 'mcd-request' : 'mcd-not-configured')} /></Group>}
        {view === 'bubbles' && <>
            <input aria-label="搜索气泡样式" value={bubbleSearch} onChange={e => setBubbleSearch(e.target.value)} placeholder="搜索气泡样式…" className="w-full p-3 mb-4 text-sm outline-none" style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken }} />
            <p className="text-xs mb-3" style={{ color: F.textTertiary }}>选择后立即应用。新气泡可以到「气泡工坊」制作。</p>
            <div role="radiogroup" aria-label="气泡样式" className="p-2 space-y-2" style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}>
                {[...Object.values(PRESET_THEMES), ...customThemes].filter(theme => theme.name.toLowerCase().includes(bubbleSearch.trim().toLowerCase())).map(theme => {
                    const selected = (character.bubbleStyle || 'default') === theme.id;
                    const custom = customThemes.some(item => item.id === theme.id);
                    return <div key={theme.id} className="flex items-center gap-2 px-3" style={{ borderRadius: R.button, background: selected ? F.surface : 'transparent', boxShadow: selected ? S.raisedSoft : undefined }}>
                        <button type="button" role="radio" aria-checked={selected} className="flex-1 min-h-16 flex items-center justify-between text-left text-sm" onClick={() => updateCharacter(character.id, { bubbleStyle: theme.id })}>{theme.name}{selected && <Check size={18} color={HUE.purple.ink} />}</button>
                        {custom && (deletingTheme === theme.id ? <button type="button" className="h-11 px-3 text-xs" style={{ color: STATUS.danger.ink, background: STATUS.danger.tint, borderRadius: R.button }} onClick={() => { removeCustomTheme(theme.id); setDeletingTheme(null); }}>确认删除</button> : <button type="button" aria-label={`删除气泡 ${theme.name}`} onClick={() => setDeletingTheme(theme.id)} className="w-11 h-11 flex items-center justify-center" style={{ background: F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.pill, boxShadow: S.raisedSoft }}><Trash size={18} color={F.textSecondary} /></button>)}
                    </div>;
                })}
            </div>
        </>}
        {view === 'display' && <Group><Row title="展示思考" onClick={() => onAction('thinking-settings')} /><Row title="系统消息显示" onClick={() => onGroup('display')} /></Group>}
    </ChatSettingsFrame>;
}
