// [EM-START: settings-subpages-f]
/**
 * 设置 → 语音与写歌（非 LLM 的 API，不跟预设切换）。原来一长条：MiniMax / 鱼声字段、两张单选卡、
 * 渐变的写歌教程卡、语音提示词折叠。换成：用哪家（分段，立刻生效）/ MiniMax / 鱼声 / 写歌 / 高级。
 * 只管长相：草稿和「保存其他 API」都在 apps/Settings.tsx；读屏标题「其他 API」是测试找这一页用的。
 */

import React from 'react';
import { Check } from '@phosphor-icons/react';
import { F } from '../../utils/clayTokens';
import { SETTINGS_HUE } from './SettingsHome';
import { FieldRow, Group, Hero, Page, Row, Segmented } from './SettingsParts';

type Provider = 'minimax' | 'fishaudio';

export interface VoicePromptField {
    key: string;
    title: string;
    hint: string;
    value: string;
    setValue: (v: string) => void;
    defaultText: string;
}

export interface VoiceApiPageProps {
    provider: Provider; onProvider: (p: Provider) => void;
    region: 'domestic' | 'overseas'; setRegion: (r: 'domestic' | 'overseas') => void;
    miniMaxKey: string; setMiniMaxKey: (v: string) => void;
    miniMaxGroupId: string; setMiniMaxGroupId: (v: string) => void;
    fishKey: string; setFishKey: (v: string) => void;
    fishModel: string; onFishModel: (m: string) => void;
    aceStepKey: string; setAceStepKey: (v: string) => void;
    guideOpen: boolean; setGuideOpen: (v: boolean) => void;
    promptsOpen: boolean; setPromptsOpen: (v: boolean) => void;
    prompts: VoicePromptField[];
    onSave: () => void;
    saveLabel: string;
}

const FISH_MODELS: { value: string; title: string; sub: string }[] = [
    { value: 's2.1-pro-free', title: 's2.1-pro-free', sub: '免费，同款模型；不保证首字延迟，自用够了' },
    { value: 's2.1-pro', title: 's2.1-pro', sub: '付费，质量和延迟更好' },
    { value: 's2-pro', title: 's2-pro', sub: '上一代，多说话人、自然语言控制' },
    { value: 's1', title: 's1', sub: '旧版，（圆括号）情绪标签' },
];

const VoiceApiPage: React.FC<VoiceApiPageProps> = p => (
    <Page label="其他 API" testId="settings-voice-page">
        <Hero title={p.provider === 'minimax' ? '语音用 MiniMax' : '语音用鱼声 Fish'}
            sub="聊天语音条、电话、见面都用这一家。两边的 Key 都会留着，切换立刻生效。" />

        <Group foot={p.provider === 'fishaudio' ? '鱼声要科学上网，不然会一直合成失败。' : 'MiniMax 国内能直连。'}>
            <Segmented label="当前语音引擎" value={p.provider} onChange={p.onProvider}
                options={[{ value: 'minimax', label: 'MiniMax' }, { value: 'fishaudio', label: '鱼声 Fish' }]} />
        </Group>

        <Group title="MiniMax" foot={p.region === 'overseas'
            ? '海外站（api.minimax.io），要用海外账号签的 Key。Group ID 控制台给了才填。'
            : '国服（api.minimaxi.com）。Key 空着时回退通用 Key；Group ID 控制台给了才填。'}>
            <Segmented label="MiniMax 服务器" value={p.region} onChange={p.setRegion}
                options={[{ value: 'domestic', label: '国服' }, { value: 'overseas', label: '海外' }]} />
            <FieldRow label="MiniMax Key（可选）" name="minimax-api-secret" value={p.miniMaxKey} secret mono placeholder="留空就用通用 Key" onDraft={p.setMiniMaxKey} onCommit={() => {}} />
            <FieldRow label="Group ID（可选）" value={p.miniMaxGroupId} mono placeholder="group_id" onDraft={p.setMiniMaxGroupId} onCommit={() => {}} />
        </Group>

        <Group title="鱼声 Fish" foot="角色的音色在「角色 → 语音」里填 reference_id，也能单独换模型。模型点了就生效。">
            <FieldRow label="Fish Audio Key" name="fish-api-key" value={p.fishKey} secret mono placeholder="fish.audio 控制台签发" onDraft={p.setFishKey} onCommit={() => {}} />
            {FISH_MODELS.map(m => (
                <Row key={m.value} title={m.title} sub={m.sub} onClick={() => p.onFishModel(m.value)} chevron={false}
                    right={p.fishModel === m.value ? <Check size={18} weight="bold" color={SETTINGS_HUE.main} className="shrink-0" aria-label="正在用" /> : undefined} />
            ))}
            <Row title="去 fish.audio 拿 Key" tone="link" href="https://fish.audio/zh-CN/developers/" />
        </Group>

        <Group title="写歌" foot="填了之后，写歌 App 歌词页能调 ACE-Step 出真人声整首歌（约 ¥0.1 一首，走代理不用梯子）。">
            <FieldRow label="Replicate Token（可选）" name="ace-step-api-token" value={p.aceStepKey} secret mono placeholder="r8_…" onDraft={p.setAceStepKey} onCommit={() => {}} />
            <Row title="怎么拿 Token" value={p.guideOpen ? '收起' : undefined} onClick={() => p.setGuideOpen(!p.guideOpen)} />
            {p.guideOpen && (
                <ol style={{ margin: 0, padding: '10px 14px 10px 32px', fontSize: 13, lineHeight: '21px', color: F.textSecondary }}>
                    <li>注册 Replicate（GitHub 一键登录最快）。</li>
                    <li>Account → API Tokens，复制 r8_ 开头那一串。</li>
                    <li>绑卡充值：没有免费额度，国内卡基本不行，建议美区 Visa / MC；最低 $1 大约 50–100 首。</li>
                    <li>粘到上面，点「保存其他 API」，到写歌 App 的歌曲预览页点「AI 出歌」。</li>
                </ol>
            )}
            {p.guideOpen && <Row title="打开注册页" tone="link" href="https://replicate.com/signin" />}
            {p.guideOpen && <Row title="打开 Token 页" tone="link" href="https://replicate.com/account/api-tokens" />}
        </Group>

        <Group title="高级" foot={p.promptsOpen ? '这是给模型的格式说明（停顿、情绪标签、动作词），不是人设。改坏了语音标记可能解析失败，拿不准就清空回默认。改完记得保存。' : '教模型写出有情绪、有停顿的语音台词。留空就用内置的。'}>
            <Row title="语音提示词" value={p.promptsOpen ? '收起' : (p.prompts.some(x => x.value.trim()) ? '已自定义' : '默认')} onClick={() => p.setPromptsOpen(!p.promptsOpen)} />
            {p.promptsOpen && p.prompts.flatMap(field => [
                <FieldRow key={`${field.key}-text`} label={`${field.title} · ${field.hint}`} value={field.value} mono multiline rows={6}
                    placeholder="留空 → 用内置默认" onDraft={field.setValue} onCommit={() => {}} />,
                <Row key={`${field.key}-load`} title={`载入默认模板（${field.title}）`} tone="link" onClick={() => field.setValue(field.defaultText)} />,
                ...(field.value.trim() ? [<Row key={`${field.key}-clear`} title={`清空，回到默认（${field.title}）`} tone="danger" onClick={() => field.setValue('')} />] : []),
            ])}
        </Group>

        <Group>
            <Row title={p.saveLabel} tone="link" onClick={p.onSave} />
        </Group>
    </Page>
);

export default VoiceApiPage;
// [EM-END: settings-subpages-f]
