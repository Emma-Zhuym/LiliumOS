// [EM-START: settings-subpages-f]
/**
 * 设置 → 主 API。阿萌最常用的就是这里：增减预设、切主 API。
 *
 * - 顶上状态卡：现在用的是哪条（预设名或模型）、地址，右下「测试连接」
 * - 预设一条一行（按分组），点名字立刻切过去，用着的那条打勾；铅笔进编辑，删除在编辑里
 * - 当前配置：URL / Key / 模型，下面「保存配置」——只更新当前配置，不改预设（保存后要重传云端凭据）
 * - 高级（流式 / 温度）收起来
 *
 * 只管长相：状态、保存、切预设、拉模型列表都还在 apps/Settings.tsx，从 props 进来。
 * 外层 <section> 的读屏标题叫「API 配置」，utils/apiSettingsUi.test.ts 靠它找这一页。
 */

import React from 'react';
import { Check, PencilSimple } from '@phosphor-icons/react';
import type { ApiPreset } from '../../types';
import { F, R, iconButtonBare } from '../../utils/clayTokens';
import { SETTINGS_HUE } from './SettingsHome';
import { FieldRow, Group, Hero, HeroAction, Page, Row, ToggleRow, resultSub } from './SettingsParts';

export interface MainApiPageProps {
    sections: { group: string; presets: ApiPreset[] }[];
    activePresetId: string | null | undefined;
    onApply: (preset: ApiPreset) => void;
    onEdit: (preset: ApiPreset) => void;
    onNew: () => void;
    url: string; setUrl: (v: string) => void;
    apiKey: string; setApiKey: (v: string) => void;
    model: string;
    onPickModel: () => void;
    onRefreshModels: () => void;
    loadingModels: boolean;
    stream: boolean; setStream: (v: boolean) => void;
    temperature: number; setTemperature: (v: number) => void;
    advancedOpen: boolean; setAdvancedOpen: (v: boolean) => void;
    onSave: () => void;
    saveLabel: string;
    onTest: () => void;
    testing: boolean;
    testResult: string | null;
    onOpenLog: () => void;
}

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const MainApiPage: React.FC<MainApiPageProps> = p => {
    const active = p.sections.flatMap(s => s.presets).find(x => x.id === p.activePresetId);
    const canTest = !!(p.url.trim() && p.apiKey.trim() && p.model.trim());
    const result = p.testResult
        ? { tone: p.testResult.startsWith('✅') ? 'ok' as const : 'bad' as const, text: p.testResult.replace(/^[✅❌]\s*/, '') }
        : null;
    const hasPresets = p.sections.some(s => s.presets.length > 0);

    return (
        <Page label="API 配置" testId="settings-api-main-page">
            <Hero title={active ? active.name : (p.model || '还没选模型')}
                sub={result ? resultSub(result) : [active ? p.model : '', host(p.url)].filter(Boolean).join(' · ') || '填上地址、Key 和模型'}
                dot={result ? (result.tone === 'ok' ? 'ok' : 'bad') : null}
                actions={<HeroAction onClick={p.onTest} disabled={p.testing || !canTest}>{p.testing ? '测试中…' : '测试连接'}</HeroAction>} />

            {p.sections.map((section, i) => section.presets.length > 0 && (
                <Group key={section.group || '__ungrouped'} title={section.group || (i === 0 ? '预设' : undefined)}>
                    {section.presets.map(preset => {
                        const on = preset.id === p.activePresetId;
                        return (
                            <div key={preset.id} className="flex items-center" style={{ minHeight: 52, paddingRight: 4 }}>
                                <button type="button" onClick={() => p.onApply(preset)} aria-pressed={on} title={`切换到 ${preset.name}`}
                                    className="flex-1 min-w-0 flex items-center text-left active:opacity-60 transition-opacity"
                                    style={{ minHeight: 52, padding: '8px 0 8px 14px', gap: 10, background: 'transparent', border: 'none' }}>
                                    <span className="flex-1 min-w-0 break-words" style={{ fontSize: 15, lineHeight: '21px', color: F.textPrimary }}>
                                        {preset.name}
                                        <span className="block truncate" style={{ fontSize: 12, lineHeight: '17px', color: F.textTertiary, marginTop: 1 }}>
                                            {preset.config.model || '没填模型'}
                                        </span>
                                    </span>
                                    {on && <Check size={18} weight="bold" color={SETTINGS_HUE.main} className="shrink-0" aria-label="使用中" />}
                                </button>
                                <button type="button" aria-label={`编辑预设 ${preset.name}`} onClick={() => p.onEdit(preset)}
                                    className="shrink-0 flex items-center justify-center active:opacity-40 transition-opacity" style={iconButtonBare}>
                                    <PencilSimple size={18} weight="bold" color={F.textTertiary} />
                                </button>
                            </div>
                        );
                    })}
                </Group>
            ))}
            <Group foot={hasPresets ? '点名字立刻切过去；铅笔里能改名字、分组，也能删。' : '把现在这套地址、Key、模型存成一条预设，以后点一下就能切回来。'}>
                <Row title="用当前配置新建预设" tone="link" onClick={p.onNew} />
            </Group>

            <Group title="当前配置" foot={hasPresets ? '保存只更新当前配置。要改预设，点它的铅笔。' : undefined}>
                <FieldRow label="URL" value={p.url} mono placeholder="https://…/v1" onDraft={p.setUrl} onCommit={() => {}} />
                <FieldRow label="Key" value={p.apiKey} secret mono placeholder="sk-…" onDraft={p.setApiKey} onCommit={() => {}} />
                <Row title="模型" value={p.model || '选一个'} onClick={p.onPickModel} />
                <Row title={p.loadingModels ? '正在拉模型列表…' : '刷新模型列表'} tone="link" disabled={p.loadingModels} onClick={p.onRefreshModels} />
                <Row title={p.saveLabel} tone="link" onClick={p.onSave} />
            </Group>

            <Group foot={p.advancedOpen ? '绝大多数时候保持默认。接口报「only stream supported」才开流式；温度默认 0.85，只作用于聊天和见面的主回复。' : undefined}>
                <Row title="高级（不建议修改）" value={p.advancedOpen ? '收起' : undefined} onClick={() => p.setAdvancedOpen(!p.advancedOpen)} />
                {p.advancedOpen && <ToggleRow title="流式输出" sub="仅在你的 API 强制要求时打开" checked={p.stream} onChange={p.setStream} />}
                {p.advancedOpen && (
                    <div style={{ padding: '12px 14px 14px' }}>
                        <div className="flex justify-between" style={{ fontSize: 15, color: F.textPrimary, marginBottom: 8 }}>
                            <span>温度</span>
                            <span style={{ color: F.textTertiary, fontVariantNumeric: 'tabular-nums' }}>{p.temperature.toFixed(2)}</span>
                        </div>
                        <input type="range" min="0" max="2" step="0.05" value={p.temperature} aria-label="温度"
                            onChange={e => p.setTemperature(parseFloat(e.target.value))}
                            className="w-full" style={{ accentColor: SETTINGS_HUE.main, borderRadius: R.pill }} />
                    </div>
                )}
            </Group>

            <Group>
                <Row title="调用记录" sub="最近 5 天：哪个 API、哪个 App、哪个角色、做什么用" onClick={p.onOpenLog} />
            </Group>
        </Page>
    );
};

export default MainApiPage;
// [EM-END: settings-subpages-f]
