// [EM-START: settings-subpages-f]
/**
 * 设置 → 识图。给不能直接看图的主模型（DeepSeek 这类）补一个视觉模型：每张图只识一次，
 * 结果写成 [图片：…] 再交给主 API。
 *
 * 只管长相：草稿、保存、开关（关掉立即只存 enabled=false）都在 apps/Settings.tsx。
 * 关着时配置照样留在页面上——切开关不该把填了一半的东西藏起来。
 * 读屏标题「识图 API」是 utils/apiSettingsUi.test.ts 找这一页用的。
 */

import React from 'react';
import type { ApiPreset } from '../../types';
import { Chips, FieldRow, Group, Hero, HeroAction, Page, Row, ToggleRow, resultSub } from './SettingsParts';

export interface VisionApiPageProps {
    enabled: boolean;
    savedEnabled: boolean;
    onToggle: () => void;
    presets: ApiPreset[];
    selectedPresetId: string | null;
    onLoadPreset: (preset: ApiPreset) => void;
    url: string; setUrl: (v: string) => void;
    apiKey: string; setApiKey: (v: string) => void;
    model: string;
    onPickModel: () => void;
    onRefreshModels: () => void;
    loadingModels: boolean;
    onTest: () => void;
    testing: boolean;
    testResult: string | null;
    onSave: () => void;
    statusMsg: string;
}

const VisionApiPage: React.FC<VisionApiPageProps> = p => {
    const canTest = p.enabled && !!(p.url.trim() && p.apiKey.trim() && p.model.trim());
    const result = p.testResult
        ? { tone: p.testResult.startsWith('✅') ? 'ok' as const : 'bad' as const, text: p.testResult.replace(/^[✅❌]\s*/, '') }
        : null;
    return (
        <Page label="识图 API" testId="settings-vision-page">
            <Hero title={p.savedEnabled ? `已接入 · ${p.model || '没选模型'}` : '没接入'}
                sub={result ? resultSub(result) : p.statusMsg || '主模型看不了图时用。每张图只识一次，之后聊天、重 roll 都直接用结果。'}
                dot={result ? (result.tone === 'ok' ? 'ok' : 'bad') : null}
                actions={<HeroAction onClick={p.onTest} disabled={p.testing || !canTest}>{p.testing ? '识图测试中…' : '测试识图'}</HeroAction>} />

            <Group foot="测试会发一张内置的小圆点图，确认这个模型真的看得见，花一次很小的请求。">
                <ToggleRow title="接入独立识图 API" sub="DeepSeek 这类不能直接看图的主模型用" checked={p.enabled} onChange={() => p.onToggle()} />
            </Group>

            {p.presets.length > 0 && (
                <Group title="从模型预设载入" foot="只是把那条预设的地址、Key、模型填进下面，不会切换主 API。">
                    <Chips options={p.presets.map(x => ({ value: x.id, label: x.name }))}
                        selected={p.selectedPresetId ? [p.selectedPresetId] : []}
                        onToggle={id => { const preset = p.presets.find(x => x.id === id); if (preset) p.onLoadPreset(preset); }} />
                </Group>
            )}

            <Group title="识图模型">
                <FieldRow label="URL" value={p.url} mono placeholder="https://…/v1" onDraft={p.setUrl} onCommit={() => {}} />
                <FieldRow label="Key" value={p.apiKey} secret mono placeholder="sk-…" onDraft={p.setApiKey} onCommit={() => {}} />
                <Row title="模型" value={p.model || '选一个'} onClick={p.onPickModel} />
                <Row title={p.loadingModels ? '正在拉模型列表…' : '刷新模型列表'} tone="link" disabled={p.loadingModels} onClick={p.onRefreshModels} />
                <Row title="保存识图 API" tone="link" disabled={p.loadingModels || p.testing} onClick={p.onSave} />
            </Group>
        </Page>
    );
};

export default VisionApiPage;
// [EM-END: settings-subpages-f]
