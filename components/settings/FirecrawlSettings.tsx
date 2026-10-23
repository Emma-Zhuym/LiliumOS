import React, { useState } from 'react';
import { FieldRow, Group, Hero, Page, Row, resultSub } from './SettingsParts';
import { getFirecrawlApiKey, setFirecrawlApiKey, getFirecrawlCreditUsage, FIRECRAWL_API_KEYS_URL } from '../../utils/firecrawl';

export default function FirecrawlSettings() {
    const [key, setKey] = useState(getFirecrawlApiKey);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const save = async () => {
        setBusy(true);
        setResult(null);
        try {
            const usage = await getFirecrawlCreditUsage(key.trim());
            setFirecrawlApiKey(key.trim());
            setResult({ ok: true, text: `已启用，剩余额度 ${usage.remainingCredits.toLocaleString()} / ${usage.planCredits.toLocaleString()}` });
        } catch (error) {
            setResult({ ok: false, text: error instanceof Error ? error.message : '连接失败，请稍后再试' });
        } finally {
            setBusy(false);
        }
    };
    // [EM: settings-subpages-f] 原来是一张要再点开的折叠卡，网页抓取这一页就它一样东西，直接铺开
    const on = !!getFirecrawlApiKey();
    return (
        <Page testId="settings-webfetch-page">
            <Hero title={on ? 'Firecrawl 已启用' : '没用 Firecrawl'}
                sub={result ? resultSub({ tone: result.ok ? 'ok' : 'bad', text: result.text }) : '可选。普通网页读不出来（要跑脚本的那种）时，才用它再试一次；没配就照旧。'}
                dot={result ? (result.ok ? 'ok' : 'bad') : null} />
            <Group foot="Key 只存在这台手机上。保存时会顺手查一次剩余额度。">
                <FieldRow label="Firecrawl API Key" value={key} secret mono placeholder="fc-…" onDraft={v => { setKey(v.trim()); setResult(null); }} onCommit={() => {}} />
                <Row title={busy ? '正在检查…' : '保存并检查额度'} tone="link" disabled={busy || !key.trim()} onClick={() => void save()} />
                {on && <Row title="停用" tone="danger" disabled={busy} onClick={() => { setFirecrawlApiKey(''); setKey(''); setResult({ ok: true, text: '已停用，网页读取照旧' }); }} />}
            </Group>
            <Group>
                <Row title="去 Firecrawl 拿 Key" tone="link" href={FIRECRAWL_API_KEYS_URL} />
            </Group>
        </Page>
    );
}
