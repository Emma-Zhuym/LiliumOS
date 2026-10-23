// [EM-START: settings-subpages-f]
/**
 * 设置 → 日记同步（角色能用的工具）。只剩 Notion：飞书日记 2026-10-22 删了（阿萌用不上）。
 *
 * 日记附加列（角色名 / 心情）和只读库（TAG 系统）是 EM 的：
 * - `notionDiaryExtraProperties` 只认 ${char} / ${mood} 两条，其余自己加的列原样留着
 * - 只读库 `notionExtraDatabases`：「我的笔记」是 NOTION_USER_NOTES_TAG 那一行，其余每行 name / tag / databaseId，
 *   新建必须带 id: crypto.randomUUID()；tag 或 ID 没填的行先只留在这一页，不存进配置
 */

import React, { useMemo, useState } from 'react';
import type { NotionDiaryExtraProperty, NotionExtraDatabase } from '../../types';
import { NotionManager } from '../../utils/realtimeContext';
import { trackEvent } from '../../utils/analytics';
import {
    dedupeNotionReadNoteRows, migrateLegacyNotionNotesToExtra, normalizeNotionExtraTag, NOTION_USER_NOTES_TAG,
} from '../../utils/notionExtraConfig';
import { FieldRow, Group, Hero, HeroAction, Page, Row, ToggleRow, resultSub, type TestResult } from './SettingsParts';
import { useRealtimeSettings } from './useRealtimeSettings';

const CHAR = '${char}';
const MOOD = '${mood}';

const DiarySyncPage: React.FC = () => {
    const { config, commit, latest } = useRealtimeSettings();
    const extra = config.notionDiaryExtraProperties || [];
    const charProp = extra.find(p => (p.valueTemplate || '').includes(CHAR));
    const moodProp = extra.find(p => (p.valueTemplate || '').includes(MOOD));

    // 只读库：进页时读一次（顺手把旧版「笔记数据库 ID」并进来），之后这一页自己管
    const initial = useMemo(() => {
        const { config: merged } = migrateLegacyNotionNotesToExtra(config);
        const notes = merged.notionNotesDatabaseId?.trim()
            || merged.notionExtraDatabases?.find(d => normalizeNotionExtraTag(d.tag) === NOTION_USER_NOTES_TAG)?.databaseId?.trim() || '';
        const others = (merged.notionExtraDatabases || []).filter(d => normalizeNotionExtraTag(d.tag) !== NOTION_USER_NOTES_TAG).map(d => ({ ...d }));
        return { notes, others };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const [notesId, setNotesId] = useState(initial.notes);
    const [dbs, setDbs] = useState<NotionExtraDatabase[]>(initial.others);
    const [openDb, setOpenDb] = useState<string | null>(null);
    const [result, setResult] = useState<TestResult>(null);

    const saveExtraColumns = (next: { char?: string | null; mood?: string | null }) => {
        const kept = (latest.current.notionDiaryExtraProperties || []).filter(p => !(p.valueTemplate || '').includes(CHAR) && !(p.valueTemplate || '').includes(MOOD));
        const char = next.char !== undefined ? next.char : (charProp ? charProp.propertyName : null);
        const mood = next.mood !== undefined ? next.mood : (moodProp ? moodProp.propertyName : null);
        const arr: NotionDiaryExtraProperty[] = [...kept];
        if (char !== null) arr.push({ propertyName: char.trim() || 'Character', notionType: 'rich_text', valueTemplate: CHAR });
        if (mood !== null) arr.push({ propertyName: mood.trim() || 'Mood', notionType: 'rich_text', valueTemplate: MOOD });
        commit({ notionDiaryExtraProperties: arr.length ? arr : undefined });
    };

    const saveDbs = (notes: string, others: NotionExtraDatabase[]) => {
        const id = notes.trim();
        const notesEntry: NotionExtraDatabase[] = id ? [{ id: NOTION_USER_NOTES_TAG, name: '用户笔记', tag: NOTION_USER_NOTES_TAG, databaseId: id }] : [];
        const filled = others.filter(d => normalizeNotionExtraTag(d.tag) !== NOTION_USER_NOTES_TAG && d.tag && d.databaseId);
        const merged = dedupeNotionReadNoteRows([...notesEntry, ...filled]);
        commit({ notionNotesDatabaseId: id || undefined, notionExtraDatabases: merged.length ? merged : undefined });
    };

    const updateDb = (id: string, patch: Partial<NotionExtraDatabase>) => {
        const next = dbs.map(d => d.id === id ? { ...d, ...patch } : d);
        setDbs(next);
        saveDbs(notesId, next);
    };

    const addDb = () => {
        const db: NotionExtraDatabase = { id: crypto.randomUUID(), name: '', tag: '', databaseId: '' };
        setDbs(prev => [...prev, db]);
        setOpenDb(db.id);
    };

    const removeDb = (id: string) => {
        const next = dbs.filter(d => d.id !== id);
        setDbs(next);
        setOpenDb(null);
        saveDbs(notesId, next);
    };

    const test = async () => {
        const { notionApiKey, notionDatabaseId } = latest.current;
        if (!notionApiKey || !notionDatabaseId) { setResult({ tone: 'bad', text: '先填 Token 和日记数据库 ID' }); return; }
        setResult({ tone: 'busy', text: '正在连 Notion…' });
        try {
            const r = await NotionManager.testConnection(notionApiKey, notionDatabaseId);
            trackEvent('测试 Notion 连接', { result: r.success ? 'ok' : 'failed' });
            setResult({ tone: r.success ? 'ok' : 'bad', text: r.message });
        } catch (e: any) {
            trackEvent('测试 Notion 连接', { result: 'network-error' });
            setResult({ tone: 'bad', text: `网络错误：${e?.message || e}` });
        }
    };

    const on = !!config.notionEnabled;
    const filled = !!(config.notionApiKey && config.notionDatabaseId);
    const heroTitle = !on ? 'Notion 没开'
        : result?.tone === 'ok' ? 'Notion 已连上'
        : result?.tone === 'bad' ? 'Notion 连不上'
        : filled ? 'Notion 已开' : 'Notion 还差两样';
    const heroSub = !on ? '打开后，角色能把日记写进你的 Notion，也能翻你给的库'
        : result ? resultSub(result)
        : filled ? '还没测过，点右下角测一下' : '填上 Token 和日记数据库 ID';

    return (
        <Page testId="settings-diary-page">
            <Hero title={heroTitle} sub={heroSub} dot={on && result?.tone === 'ok' ? 'ok' : on && result?.tone === 'bad' ? 'bad' : null}
                actions={on ? <HeroAction onClick={() => void test()} disabled={result?.tone === 'busy'}>测试连接</HeroAction> : undefined} />

            <Group title="连接" foot={on ? 'Token 在 Notion 开发者页面建 Integration 拿（ntn_ 或 secret_ 开头都行）；数据库 ID 从数据库网址里复制，数据库要有 Name（标题）和 Date（日期）两列，并在右上角菜单里 Connect 这个 Integration。' : undefined}>
                <ToggleRow title="写 Notion 日记" sub="聊天里点「写 Notion」，角色会写一篇" checked={on} onChange={next => { commit({ notionEnabled: next }); setResult(null); }} />
                {on && (
                    <>
                        <FieldRow label="Integration Token" value={config.notionApiKey || ''} secret mono placeholder="ntn_… 或 secret_…"
                            onCommit={v => { commit({ notionApiKey: v.trim() }); setResult(null); }} />
                        <FieldRow label="日记数据库 ID" value={config.notionDatabaseId || ''} mono placeholder="从数据库网址里复制"
                            onCommit={v => { commit({ notionDatabaseId: v.trim() }); setResult(null); }} />
                    </>
                )}
            </Group>

            {on && (
                <Group title="日记附加列" foot="写日记时顺手填上，Notion 里就能按角色、按心情筛。列名要跟数据库里一字不差。">
                    <ToggleRow title="角色名" checked={!!charProp} onChange={next => saveExtraColumns({ char: next ? (charProp?.propertyName || 'Character') : null })} />
                    {charProp && <FieldRow label="写进哪一列" value={charProp.propertyName} placeholder="Character" onCommit={v => saveExtraColumns({ char: v })} />}
                    <ToggleRow title="心情" checked={!!moodProp} onChange={next => saveExtraColumns({ mood: next ? (moodProp?.propertyName || 'Mood') : null })} />
                    {moodProp && <FieldRow label="写进哪一列" value={moodProp.propertyName} placeholder="Mood" onCommit={v => saveExtraColumns({ mood: v })} />}
                </Group>
            )}

            {on && (
                <Group title="角色能读的库" foot="只读：角色按标签翻这些库，不会往里写。标签用大写英文，比如 BOOK。">
                    <Row title="我的笔记" sub="角色偶尔会看到标题，提起你写的东西" value={notesId ? '已设置' : '没填'} onClick={() => setOpenDb(openDb === NOTION_USER_NOTES_TAG ? null : NOTION_USER_NOTES_TAG)} />
                    {openDb === NOTION_USER_NOTES_TAG && (
                        <FieldRow label="笔记数据库 ID" value={notesId} mono placeholder="留空就不让看" onCommit={v => { setNotesId(v); saveDbs(v, dbs); }} />
                    )}
                    {dbs.map(db => (
                        <React.Fragment key={db.id}>
                            <Row title={db.name || '没起名的库'} sub={db.tag ? `标签 ${db.tag}` : '还没填标签'}
                                value={db.tag && db.databaseId ? undefined : '没填完'} valueTone="bad"
                                onClick={() => setOpenDb(openDb === db.id ? null : db.id)} />
                            {openDb === db.id && (
                                <>
                                    <FieldRow label="叫什么" value={db.name} placeholder="比如 读书摘抄" onCommit={v => updateDb(db.id, { name: v })} />
                                    <FieldRow label="标签" value={db.tag} mono placeholder="BOOK"
                                        onCommit={v => updateDb(db.id, { tag: v.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
                                    <FieldRow label="数据库 ID" value={db.databaseId} mono placeholder="从数据库网址里复制" onCommit={v => updateDb(db.id, { databaseId: v.trim() })} />
                                    <Row title="删掉这个库" tone="danger" onClick={() => removeDb(db.id)} />
                                </>
                            )}
                        </React.Fragment>
                    ))}
                    <Row title="添加一个库" tone="link" onClick={addDb} />
                </Group>
            )}

            <Group>
                <Row title="去 Notion 开发者页面" tone="link" href="https://www.notion.so/my-integrations" />
            </Group>
        </Page>
    );
};

export default DiarySyncPage;
// [EM-END: settings-subpages-f]
