/**
 * 本机存储用量面板
 *
 * 摆在「备份与恢复」板块顶部，回答两件事：数据多大、系统会不会随手把它清掉。
 *
 * 总量和持久化状态是秒回的，进来就显示；「都是些什么占的」要翻库，所以折叠起来、
 * 点开才算，算的时候显示进度，别让用户对着空白等。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    readStorageOverview,
    requestPersistentStorage,
    computeStorageBreakdown,
    formatBytes,
    type StorageOverview,
    type StorageBreakdown,
    type BreakdownProgress,
} from '../../utils/storageStats';
import { optimizeResourceStorage, type OptimizeProgress, type OptimizeResult } from '../../utils/storageOptimize';
import { trackEvent } from '../../utils/analytics';
import { F, R, STATUS } from '../../utils/clayTokens'; // [EM: settings-subpages-f]
import { SETTINGS_HUE } from './SettingsHome';
import { Group, Page, Row, resultSub } from './SettingsParts';

/**
 * 算好的结果放模块级缓存：SettingsSection 收起时会把子树整个卸载，
 * 不缓存的话用户每收一次再展开就得重算一遍。要最新数字点「重新计算」。
 */
let cachedBreakdown: StorageBreakdown | null = null;

/**
 * 分类合计和 estimate() 总量差多少才值得单独交代。
 * 绝对值够大、或者占了总量一成以上都算 —— 只看绝对值的话，几百 KB 的小库永远不显示，
 * 用户会盯着「总共 165 KB，细分只有 9 KB」发懵。
 */
const OTHER_USAGE_MIN_BYTES = 1024 * 1024;
const OTHER_USAGE_MIN_RATIO = 0.1;

/** 合并完成后自动刷新前留的一点时间，让用户看清这轮到底做了什么。 */
const MERGE_RELOAD_DELAY_MS = 2500;

/**
 * 合并过重复图片就排一次整页刷新，排过了就不再排。
 *
 * 计时器和标记都放在组件外面，是因为这次刷新是数据一致性动作，不是界面上的顺手事：
 * 合并只改了库里的引用，内存里的 theme / customIcons 还捏着合并前的令牌，带着它导出
 * 备份，同一张图会被写成两份。所以用户在这 2.5 秒里收起板块、退出设置页、或者再点一次
 * 「一键优化」（这些都会把面板卸掉或重置状态），刷新照样得来。
 */
let mergeReloadScheduled = false;
function scheduleMergeReload(): void {
    if (mergeReloadScheduled) return;
    mergeReloadScheduled = true;
    setTimeout(() => window.location.reload(), MERGE_RELOAD_DELAY_MS);
}

type PersistAttempt = 'none' | 'granted' | 'denied';

/**
 * 把优化结果讲成人话。两笔账分开说：转格式是当场就省下的，合并重复要等下一次
 * 孤儿清理才真的把空间还回来（合并只改引用、不删图，见 utils/blobDedupe.ts）。
 */
function describeOptimizeResult(r: OptimizeResult): string {
    const parts: string[] = [];
    if (r.converted > 0) {
        parts.push(`已把 ${r.converted} 张图片转为二进制存储，释放约 ${formatBytes(Math.max(0, r.bytesBefore - r.bytesAfter))}`);
    }
    if (r.mergedDuplicates > 0) {
        parts.push(`把 ${r.mergedDuplicates} 份重复的图片并成了一份，约 ${formatBytes(r.reclaimableBytes)} 会在下次清理时释放`);
    }
    if (r.vectorsCompacted > 0) {
        parts.push(`把 ${r.vectorsCompacted} 条记忆向量压成了紧凑格式`);
    }
    const reloadNote = r.mergedDuplicates > 0 ? '页面即将刷新，让界面和备份都用上合并后的图片。' : '';
    const vectorNote = r.vectorError ? `记忆向量这一步没做完：${r.vectorError}。再点一次可以接着压。` : '';
    if (parts.length === 0) {
        if (r.failed > 0) return `有 ${r.failed} 张图片转换失败（已保留原样），其余没有需要优化的。${vectorNote}`;
        if (vectorNote) return `没有需要优化的图片。${vectorNote}`;
        return r.scanUnavailable
            ? '没有需要优化的图片。这次没能检查重复图片，换个环境再试试。'
            : '没有需要优化的，存储已是最省形态。';
    }
    let text = `${parts.join('；')}。`;
    if (r.failed > 0) text += `另有 ${r.failed} 张转换失败，已保留原样。`;
    if (r.skippedGroups > 0) text += `有 ${r.skippedGroups} 组重复图片没有合并——它们被「换一张就会删掉旧图」的地方用着，并了会误删。`;
    if (r.scanUnavailable) text += '这次没能检查重复图片，换个环境再试试。';
    return text + vectorNote + reloadNote;
}

const StorageUsagePanel: React.FC = () => {
    const [overview, setOverview] = useState<StorageOverview | null>(null);
    const [persisting, setPersisting] = useState(false);
    const [attempt, setAttempt] = useState<PersistAttempt>('none');

    const [expanded, setExpanded] = useState(false);
    const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(cachedBreakdown);
    const [computing, setComputing] = useState(false);
    const [progress, setProgress] = useState<BreakdownProgress | null>(null);
    const [breakdownError, setBreakdownError] = useState(false);

    const [optimizing, setOptimizing] = useState(false);
    const [optimizeProgress, setOptimizeProgress] = useState<OptimizeProgress | null>(null);
    const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
    const [optimizeError, setOptimizeError] = useState<string | null>(null);

    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const refreshOverview = useCallback(async () => {
        const next = await readStorageOverview();
        if (aliveRef.current) setOverview(next);
    }, []);

    useEffect(() => { void refreshOverview(); }, [refreshOverview]);

    const runBreakdown = useCallback(async () => {
        setComputing(true);
        setBreakdownError(false);
        setProgress(null);
        try {
            const result = await computeStorageBreakdown(p => {
                if (aliveRef.current) setProgress(p);
            });
            cachedBreakdown = result;
            if (aliveRef.current) setBreakdown(result);
        } catch {
            if (aliveRef.current) setBreakdownError(true);
        } finally {
            if (aliveRef.current) { setComputing(false); setProgress(null); }
        }
    }, []);

    const handleToggle = useCallback(() => {
        const next = !expanded;
        setExpanded(next);
        if (next) trackEvent('查看存储占用明细');
        if (next && !cachedBreakdown && !computing) void runBreakdown();
    }, [expanded, computing, runBreakdown]);

    const handleOptimize = useCallback(async () => {
        if (optimizing) return;
        setOptimizing(true);
        setOptimizeResult(null);
        setOptimizeError(null);
        setOptimizeProgress(null);
        try {
            const result = await optimizeResourceStorage(p => {
                if (aliveRef.current) setOptimizeProgress(p);
            });
            // 排在面板存活判断之前：引用已经在库里合并了，内存里的旧令牌就得靠刷新换掉，
            // 这件事跟面板还在不在没关系。
            if (result.mergedDuplicates > 0) scheduleMergeReload();
            if (!aliveRef.current) return;
            setOptimizeResult(result);
            // 用量和细分都变了：总量刷新，细分缓存作废（下次展开重算）
            cachedBreakdown = null;
            setBreakdown(null);
            await refreshOverview();
        } catch (error) {
            if (aliveRef.current) setOptimizeError(error instanceof Error ? error.message : String(error));
        } finally {
            if (aliveRef.current) { setOptimizing(false); setOptimizeProgress(null); }
        }
    }, [optimizing, refreshOverview]);

    const handlePersist = useCallback(async () => {
        setPersisting(true);
        try {
            const granted = await requestPersistentStorage();
            // 成败都记一笔：要是这个按钮的通过率常年是 0，那它就是个摆设，得换做法。
            trackEvent('申请持久化存储许可', { 结果: granted ? '通过' : '没通过' });
            if (!aliveRef.current) return;
            setAttempt(granted ? 'granted' : 'denied');
            await refreshOverview();
        } finally {
            if (aliveRef.current) setPersisting(false);
        }
    }, [refreshOverview]);

    const usage = overview?.usageBytes ?? null;
    const quota = overview?.quotaBytes ?? null;
    const percent = usage != null && quota != null && quota > 0
        ? Math.min(100, (usage / quota) * 100)
        : null;

    // estimate() 的总量还包含 Cache Storage（离线缓存的 JS / 图片）这类我们碰不到的东西，
    // 所以分类合计天然会少一截。差得多的时候单独列一行，省得用户以为数字对不上。
    const otherUsage = usage != null && breakdown != null ? usage - breakdown.totalBytes : null;
    const showOtherUsage = otherUsage != null && otherUsage > 0 && (
        otherUsage >= OTHER_USAGE_MIN_BYTES || (usage != null && usage > 0 && otherUsage / usage >= OTHER_USAGE_MIN_RATIO)
    );

    const persisted = overview?.persisted ?? null;

    // [EM-START: settings-subpages-f] 存储空间换成分组列表：状态卡（用了多少 + 进度条）/ 持久化 / 优化 / 都是什么占的
    const barTone = percent == null ? F.borderStrong : percent >= 90 ? STATUS.danger.main : percent >= 70 ? STATUS.warning.main : SETTINGS_HUE.main;
    const overviewSub = overview == null
        ? '正在读取浏览器给出的用量…'
        : !overview.supported
            ? '这个浏览器不提供存储用量信息'
            : quota != null
                ? `上限 ${formatBytes(quota)}${percent != null ? ` · 已占 ${percent.toFixed(1)}%` : ''} · 浏览器估算`
                : '浏览器没给出上限 · 浏览器估算';
    const optimizeText = optimizing
        ? (optimizeProgress ? `正在处理：${optimizeProgress.label}（${optimizeProgress.done}/${optimizeProgress.total}）…` : '正在扫描…')
        : optimizeError
            ? resultSub({ tone: 'bad', text: optimizeError })
            : optimizeResult ? describeOptimizeResult(optimizeResult) : undefined;

    return (
        <Page testId="storage-usage-panel">
            <div className="flex flex-col" style={{ background: SETTINGS_HUE.tint, borderRadius: R.bigCard, padding: 16, gap: 8 }}>
                <div style={{ fontSize: 13, color: F.textSecondary }}>本机数据</div>
                <div style={{ fontSize: 28, lineHeight: '34px', fontWeight: 600, color: SETTINGS_HUE.ink, fontVariantNumeric: 'tabular-nums' }}>
                    {overview == null ? '读取中…' : formatBytes(usage)}
                </div>
                {percent != null && (
                    <div style={{ height: 6, borderRadius: R.pill, background: F.surface, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(1, percent)}%`, height: '100%', borderRadius: R.pill, background: barTone, transition: 'width 200ms' }} />
                    </div>
                )}
                <div style={{ fontSize: 13, lineHeight: '18px', color: F.textSecondary }}>{overviewSub}</div>
            </div>

            <Group foot={persisted === true
                ? '系统清理存储空间时不会动你的数据。'
                : attempt === 'denied'
                    ? '浏览器这次没批准。把 LiliumOS 装到主屏、或者允许通知之后再点一次，通过的概率会高很多。'
                    : '存储吃紧时系统可能把你的数据一起清掉。装到主屏、或者允许通知，能提高申请成功率。'}>
                <Row title="持久化许可" value={persisted === true ? '已获得' : persisted === false ? '没获得' : '查不到'}
                    dot={persisted === true ? 'ok' : persisted === false ? 'bad' : null} valueTone={persisted === false ? 'bad' : 'plain'} />
                {persisted !== true && overview != null && (
                    <Row title={persisting ? '申请中…' : '再申请一次'} tone="link" disabled={persisting} onClick={() => void handlePersist()} />
                )}
            </Group>

            <Group foot="把老数据里还以 base64 存的图片转成二进制、把重复存了几份的同一张图并成一份、把记忆向量压成紧凑格式。做过一次就干净；导入旧备份后可以再点。">
                <Row title={optimizing ? '优化中…' : '一键优化'} sub={optimizeText} tone="link" disabled={optimizing} onClick={() => void handleOptimize()} />
                {/* 合并动的是库里的引用，内存里的 theme / customIcons 还捏着合并前的令牌，不刷新的话导出的备份会把同一张图写两份。
                    优化一跑完就排好了自动刷新（scheduleMergeReload），这一行只是让人不想等的时候立刻走 */}
                {!optimizing && optimizeResult && optimizeResult.mergedDuplicates > 0 && (
                    <Row title="立即刷新" tone="link" onClick={() => window.location.reload()} />
                )}
            </Group>

            <Group title="都是什么占的" foot={breakdown && !computing ? [
                breakdown.categories.some(c => c.estimated) ? '标「约」的是抽样估算' : '',
                breakdown.calibrated ? '各项已按实际占用折算，比数据本身小一些' : '',
                showOtherUsage ? '「网页缓存等」是离线缓存这类系统占用，删不掉也不用管' : '',
                breakdown.failedStores.length > 0 ? `有 ${breakdown.failedStores.length} 张表没读出来` : '',
            ].filter(Boolean).join('；') || undefined : undefined}>
                {!expanded && <Row title="算一下" sub="要翻一遍数据库，几秒钟" tone="link" onClick={handleToggle} />}
                {expanded && computing && (
                    <Row title={progress && progress.total > 0 ? `计算中… 已翻完 ${progress.done}/${progress.total} 张表` : '计算中…'} />
                )}
                {expanded && !computing && breakdownError && (
                    <Row title="重试" sub={resultSub({ tone: 'bad', text: '读不出各项占用（数据库可能正被别的标签页占着）' })} tone="link" onClick={() => void runBreakdown()} />
                )}
                {expanded && !computing && breakdown && breakdown.categories.map(c => (
                    <Row key={c.key} title={c.label} value={`${c.estimated ? '约 ' : ''}${formatBytes(c.bytes)}`} />
                ))}
                {expanded && !computing && breakdown && showOtherUsage && <Row title="网页缓存等" value={`约 ${formatBytes(otherUsage)}`} />}
                {expanded && !computing && breakdown && breakdown.categories.length === 0 && !showOtherUsage && <Row title="还没有存下什么数据" />}
                {expanded && !computing && breakdown && <Row title="重新计算" tone="link" onClick={() => void runBreakdown()} />}
            </Group>
        </Page>
    );
    // [EM-END: settings-subpages-f]
};

export default StorageUsagePanel;
