// [EM-START: settings-subpages-f]
/**
 * 设置 → 生图（聊天里 [[SEND_PHOTO]] 走的独立通道）。原来整页是上游写死的玫红色，换成设置的蓝：
 * 内置免费 / 自定义接口二选一；自定义时再选稳定中转 / 浏览器直连、填地址模型、立绘参考开关。
 * 只管长相：草稿、保存、测试都在 apps/Settings.tsx。读屏标题「生图 API」是测试找这一页用的。
 */

import React from 'react';
import { F, R } from '../../utils/clayTokens';
import { FieldRow, Group, Hero, HeroAction, Page, Row, Segmented, ToggleRow } from './SettingsParts';

type Provider = 'pollinations-free' | 'openai-compatible';
type Mode = 'proxy' | 'direct';

export interface ImageApiPageProps {
    savedProvider: Provider;
    savedModel: string;
    provider: Provider; setProvider: (v: Provider) => void;
    mode: Mode; setMode: (v: Mode) => void;
    url: string; setUrl: (v: string) => void;
    apiKey: string; setApiKey: (v: string) => void;
    model: string;
    onPickModel: () => void;
    onRefreshModels: () => void;
    loadingModels: boolean;
    useReference: boolean; setUseReference: (v: boolean) => void;
    onTest: () => void;
    testing: boolean;
    onSave: () => void;
    statusMsg: string;
    preview: string | null;
}

const ImageApiPage: React.FC<ImageApiPageProps> = p => (
    <Page label="生图 API" testId="settings-image-page">
        <Hero title={p.savedProvider === 'pollinations-free' ? '用的是内置免费生图' : `自定义 · ${p.savedModel || '没选模型'}`}
            sub={p.statusMsg || (p.savedProvider === 'pollinations-free' ? '不用 Key 就能用；只看文字描述，角色的脸可能每次不一样。' : '支持的话会拿角色立绘当脸的参考。')}
            actions={<HeroAction onClick={p.onTest} disabled={p.testing}>{p.testing ? '生成中…' : '测试生图'}</HeroAction>} />

        {p.preview && (
            <img src={p.preview} alt="生图接口测试结果" className="w-full object-cover"
                style={{ aspectRatio: '1 / 1', borderRadius: R.bigCard, border: `1px solid ${F.borderSoft}` }} />
        )}

        <Segmented standalone label="用哪种生图" value={p.provider} onChange={p.setProvider}
            options={[{ value: 'pollinations-free', label: '内置免费' }, { value: 'openai-compatible', label: '自定义接口' }]} />

        {p.provider === 'pollinations-free' ? (
            <Group foot="Pollinations 免费生图。它只读文字，不能把角色立绘当脸的参考。">
                <Row title="保存生图 API" tone="link" onClick={p.onSave} />
            </Group>
        ) : (
            <>
                <Group title="接口" foot={p.mode === 'proxy'
                    ? '经当前的代理 Worker 临时转发，GitHub Pages 上用这个；Key 和提示词不会存在 Worker 上。'
                    : '从浏览器直接请求，适合本机接口；远程接口得允许跨域。'}>
                    <Segmented label="怎么连" value={p.mode} onChange={p.setMode}
                        options={[{ value: 'proxy', label: '稳定中转' }, { value: 'direct', label: '浏览器直连' }]} />
                    <FieldRow label="URL" value={p.url} mono placeholder="https://…/v1" onDraft={p.setUrl} onCommit={() => {}} />
                    <FieldRow label="Key（可选）" value={p.apiKey} secret mono placeholder="sk-…" onDraft={p.setApiKey} onCommit={() => {}} />
                    <Row title="模型" value={p.model || '选一个'} onClick={p.onPickModel} />
                    <Row title={p.loadingModels ? '正在拉模型列表…' : '刷新模型列表'} tone="link" disabled={p.loadingModels || !p.url.trim()} onClick={p.onRefreshModels} />
                </Group>

                <Group foot={p.useReference
                    ? '只在描述里明确有角色、有人脸时才传立绘；饭菜、风景不传。接口不支持图片编辑时会提示，并自动退回纯文字生图。'
                    : '要 OpenAI 风格的 /images/generations 和 /images/edits。'}>
                    <ToggleRow title="用角色立绘保持脸" sub="优先读当前皮肤的普通立绘，不拿 Q 版当脸" checked={p.useReference} onChange={p.setUseReference} />
                </Group>

                <Group>
                    <Row title="保存生图 API" tone="link" onClick={p.onSave} />
                </Group>
            </>
        )}
    </Page>
);

export default ImageApiPage;
// [EM-END: settings-subpages-f]
