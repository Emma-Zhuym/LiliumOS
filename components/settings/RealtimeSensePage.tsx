// [EM-START: settings-subpages-f]
/**
 * 设置 → 实时感知（角色能感知：天气、新闻）。样稿 docs/design/settings-subpages-mock.html。
 * 运动感知 2026-10-22 删了（阿萌不会一边跑步一边打字）。
 */

import React, { useState } from 'react';
import { searchCities, fetchOpenMeteoCurrent, resolveWeatherCoords, formatLocationLabel, type WeatherLocation } from '../../utils/openMeteo';
import { Chips, FieldRow, Group, InlineAction, Page, Row, Segmented, ToggleRow, resultSub, type TestResult } from './SettingsParts';
import { useRealtimeSettings } from './useRealtimeSettings';

/** hot_news（news.orz.ai）可选热榜平台。key 必须与 API 的 ?platform= 完全一致。 */
export const HOTNEWS_PLATFORM_OPTIONS: { value: string; label: string }[] = [
    { value: 'weibo', label: '微博' },
    { value: 'zhihu', label: '知乎' },
    { value: 'baidu', label: '百度' },
    { value: 'bilibili', label: 'B站' },
    { value: 'douyin', label: '抖音' },
    { value: 'jinritoutiao', label: '今日头条' },
    { value: 'tieba', label: '贴吧' },
    { value: 'hupu', label: '虎扑' },
    { value: 'douban', label: '豆瓣' },
    { value: 'tskr', label: '36氪' },
    { value: 'juejin', label: '掘金' },
    { value: 'sspai', label: '少数派' },
    { value: 'vtex', label: 'V2EX' },
    { value: 'github', label: 'GitHub' },
    { value: 'hackernews', label: 'Hacker News' },
    { value: 'sina_finance', label: '新浪财经' },
    { value: 'eastmoney', label: '东方财富' },
    { value: 'xueqiu', label: '雪球' },
    { value: 'cls', label: '财联社' },
    { value: 'tenxunwang', label: '腾讯网' },
];

export const DEFAULT_NEWS_PLATFORMS = ['weibo', 'zhihu', 'baidu', 'bilibili', 'douyin'];

const RealtimeSensePage: React.FC = () => {
    const { config, commit } = useRealtimeSettings();
    const weatherMode = config.weatherMode || 'geo';
    const platforms = config.newsPlatforms || DEFAULT_NEWS_PLATFORMS;
    const [picking, setPicking] = useState(false);
    const [query, setQuery] = useState('');
    const [candidates, setCandidates] = useState<WeatherLocation[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchNote, setSearchNote] = useState('');
    const [weatherResult, setWeatherResult] = useState<TestResult>(null);
    const [braveOpen, setBraveOpen] = useState(false);

    const searchCity = async (q: string) => {
        const text = q.trim();
        if (!text) return;
        setSearching(true);
        setSearchNote('');
        const results = await searchCities(text);
        setCandidates(results);
        setSearching(false);
        if (!results.length) setSearchNote('没找到，试试英文名或换个关键词');
    };

    const pickCity = (location: WeatherLocation) => {
        commit({ weatherLocation: location });
        setCandidates([]);
        setQuery('');
        setPicking(false);
        setWeatherResult(null);
    };

    const testWeather = async () => {
        if (weatherMode === 'city' && !config.weatherLocation) { setWeatherResult({ tone: 'bad', text: '先选一个城市' }); return; }
        setWeatherResult({ tone: 'busy', text: weatherMode === 'geo' ? '正在定位…' : '正在查…' });
        const coords = await resolveWeatherCoords(weatherMode, config.weatherLocation);
        if (!coords) { setWeatherResult({ tone: 'bad', text: '定位失败（可能没给位置权限），可以改用固定城市' }); return; }
        const current = await fetchOpenMeteoCurrent(coords.latitude, coords.longitude);
        setWeatherResult(current
            ? { tone: 'ok', text: `${coords.displayName} · ${current.description} ${current.temp}°C（体感 ${current.feelsLike}°C）` }
            : { tone: 'bad', text: '天气没查到，看看网络再试' });
    };

    const togglePlatform = (key: string) => {
        commit({ newsPlatforms: platforms.includes(key) ? platforms.filter(k => k !== key) : [...platforms, key] });
    };

    const showSearch = weatherMode === 'city' && (picking || !config.weatherLocation);

    return (
        <Page testId="settings-realtime-page">
            <Group foot="免 key（Open-Meteo）。自动定位第一次会问你要不要给位置。">
                <ToggleRow title="天气" sub="角色会知道你那边的天气" checked={!!config.weatherEnabled} onChange={on => commit({ weatherEnabled: on })} />
                {config.weatherEnabled && (
                    <>
                        <Segmented label="天气从哪来" value={weatherMode}
                            options={[{ value: 'geo', label: '自动定位' }, { value: 'city', label: '固定城市' }]}
                            onChange={mode => { commit({ weatherMode: mode }); setWeatherResult(null); }} />
                        {weatherMode === 'city' && config.weatherLocation && !picking && (
                            <Row title="城市" value={formatLocationLabel(config.weatherLocation)} onClick={() => setPicking(true)} />
                        )}
                        {showSearch && (
                            <FieldRow label={config.weatherLocation ? '换一个城市' : '搜索城市'} value={query} onCommit={setQuery} onDraft={setQuery}
                                placeholder="城市名，如 Birmingham / 北京" onEnter={searchCity}
                                trailing={<InlineAction onClick={() => void searchCity(query)} disabled={searching}>{searching ? '在找…' : '搜索'}</InlineAction>} />
                        )}
                        {showSearch && candidates.map(c => (
                            <Row key={`${c.latitude},${c.longitude}`} title={formatLocationLabel(c)} tone="link" onClick={() => pickCity(c)} />
                        ))}
                        {showSearch && searchNote && <Row title={searchNote} />}
                        {showSearch && picking && <Row title="不换了" tone="link" onClick={() => { setPicking(false); setCandidates([]); setQuery(''); }} />}
                        <Row title="测试一下" tone="link" sub={resultSub(weatherResult)} onClick={() => void testWeather()} />
                    </>
                )}
            </Group>

            <Group foot={platforms.length ? '中文多平台热榜，免鉴权。' : '一个平台都没选：会退回 Brave（填了的话）或英文的 Hacker News。'}>
                <ToggleRow title="新闻热点" sub="聊天时角色会顺手捕捉热点" checked={!!config.newsEnabled} onChange={on => commit({ newsEnabled: on })} />
                {config.newsEnabled && <Chips options={HOTNEWS_PLATFORM_OPTIONS} selected={platforms} onToggle={togglePlatform} />}
            </Group>

            {config.newsEnabled && (
                <Group title="高级" foot="只在中文热榜整个拉不到时才用；配了反而可能盖掉中文热点，基本不用填。">
                    <Row title="备用新闻源（Brave）" value={config.newsApiKey ? '已填' : '没填'} onClick={() => setBraveOpen(v => !v)} />
                    {braveOpen && (
                        <FieldRow label="Brave Search API Key" value={config.newsApiKey || ''} secret mono
                            placeholder="brave.com/search/api" onCommit={v => commit({ newsApiKey: v.trim() })} />
                    )}
                </Group>
            )}
        </Page>
    );
};

export default RealtimeSensePage;
// [EM-END: settings-subpages-f]
