// [EM-START: settings-subpages-f]
/**
 * 设置 → Worker 代理。只改长相：存 / 恢复默认的逻辑（要顺手把云端那份 tool_config 重传）还在 Settings。
 */

import React from 'react';
import { DEFAULT_PROXY_WORKER } from '../../utils/proxyWorker';
import { FieldRow, Group, Hero, Page, Row } from './SettingsParts';

const ProxySettingsPage: React.FC<{
    current: string;
    onSave: (url: string) => void;
    onReset: () => void;
}> = ({ current, onSave, onReset }) => {
    const isDefault = current === DEFAULT_PROXY_WORKER;
    return (
        <Page testId="settings-proxy-page">
            <Hero title={isDefault ? '用的是默认 Worker' : '用的是你自己的 Worker'}
                sub="联网搜索、备份中转、Notion、网页抓取、出图、小红书 Lite、音乐都经它转发。默认的开箱即用，一般不用动。" />

            <Group foot={<>只填到域名（如 {DEFAULT_PROXY_WORKER}），别带 /search、/api 这些路径。只有自己部署了 worker/index.js 才需要换。音乐播放器里单独填过地址的，以那个为准。</>}>
                <FieldRow label="Worker 地址" value={current} mono placeholder={DEFAULT_PROXY_WORKER} onCommit={v => { if (v.trim() !== current) onSave(v); }} />
            </Group>

            {!isDefault && (
                <Group>
                    <Row title="恢复默认" tone="link" onClick={onReset} />
                </Group>
            )}
        </Page>
    );
};

export default ProxySettingsPage;
// [EM-END: settings-subpages-f]
