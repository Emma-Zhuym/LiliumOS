// [EM-START: settings-subpages-f]
/**
 * 设置 → 个人档案 里的「分角色聊天头像」。上游 PerCharAvatarPicker（档案 App 还在用）是翻页网格卡片，
 * 这里换成分组列表：一个角色一行，右边是你在 TA 那边的头像；点一行在雾面 sheet 里换（图片直链 / 相册 / 用整体头像）。
 * 数据照旧是 userProfile.perCharAvatars，随 user_profile 进备份；群聊始终用整体头像。
 */

import React, { useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { processImage } from '../../utils/file';
import { migrateDataUrlToRef } from '../../utils/blobRef';
import TokenImg from '../os/TokenImg';
import ClayDialog from '../os/ClayDialog';
import { F, OVERLAY, R, STATUS } from '../../utils/clayTokens';
import { SETTINGS_HUE } from './SettingsHome';
import { FieldRow, Group, Row } from './SettingsParts';

const isHttpUrl = (value: string) => {
    try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
};

const Avatar: React.FC<{ value?: string; name: string }> = ({ value, name }) => (
    <span className="shrink-0 overflow-hidden flex items-center justify-center"
        style={{ width: 32, height: 32, borderRadius: R.pill, background: SETTINGS_HUE.tint, color: SETTINGS_HUE.ink, fontSize: 14, fontWeight: 600 }}>
        {value ? <TokenImg value={value} className="w-full h-full object-cover" /> : name.slice(0, 1)}
    </span>
);

const PerCharAvatarRows: React.FC = () => {
    const { characters, userProfile, updateUserProfile, addToast } = useOS();
    const overrides = userProfile.perCharAvatars || {};
    const [query, setQuery] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [urlDraft, setUrlDraft] = useState('');
    const uploadRef = useRef<HTMLInputElement>(null);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? characters.filter(c => c.name.toLowerCase().includes(q)) : characters;
    }, [characters, query]);

    if (!characters.length) return null;

    const editing = editingId ? characters.find(c => c.id === editingId) : null;
    const setOverride = (charId: string, avatar: string | undefined) => {
        const next = { ...overrides };
        if (avatar) next[charId] = avatar; else delete next[charId];
        updateUserProfile({ perCharAvatars: next });
    };

    const open = (charId: string) => {
        setEditingId(charId);
        const cur = overrides[charId];
        // 只有 http(s) 直链才回填：上传来的是令牌，填进去既看不了也改不了
        setUrlDraft(cur && isHttpUrl(cur) ? cur : '');
    };

    const applyUrl = () => {
        if (!editingId) return;
        const url = urlDraft.trim();
        if (!isHttpUrl(url)) { addToast('URL 无效，请填写 http(s) 图片直链', 'error'); return; }
        setOverride(editingId, url);
        addToast('已设置该角色的聊天头像', 'success');
        setEditingId(null);
    };

    const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !editingId) return;
        try {
            setOverride(editingId, await migrateDataUrlToRef(await processImage(file)));
            addToast('已设置该角色的聊天头像', 'success');
            setEditingId(null);
        } catch (err: any) {
            addToast(err?.message || '头像没换成', 'error');
        }
    };

    return (
        <>
            <Group title="分角色聊天头像" foot="和不同角色聊天时，「你」可以顶着不同的头像。没单独设的用上面的整体头像；群聊始终用整体头像。">
                {characters.length > 8 && <FieldRow label="找角色" value={query} placeholder="名字" onDraft={setQuery} onCommit={() => {}} />}
                {filtered.map(c => (
                    <Row key={c.id} title={c.name} sub={overrides[c.id] ? '单独设了' : '用整体头像'}
                        right={<Avatar value={overrides[c.id] || userProfile.avatar} name={userProfile.name || '我'} />}
                        chevron onClick={() => open(c.id)} />
                ))}
            </Group>

            <ClayDialog isOpen={!!editing} title={editing ? `在 ${editing.name} 那边的头像` : ''} onClose={() => setEditingId(null)}
                footer={<button type="button" onClick={applyUrl} disabled={!urlDraft.trim()} className="w-full clay-press disabled:opacity-50"
                    style={{ height: 46, borderRadius: R.button, border: 'none', background: SETTINGS_HUE.main, color: F.surface, fontSize: 15, fontWeight: 600 }}>用这个链接</button>}>
                <div className="flex flex-col" style={{ gap: 12 }}>
                    <label className="block space-y-2 text-xs">
                        <span style={{ color: F.textSecondary }}>图片直链（图床，推荐，轻）</span>
                        <input value={urlDraft} onChange={e => setUrlDraft(e.target.value)} placeholder="https://…" autoComplete="off" spellCheck={false}
                            className="w-full min-h-11 px-3 py-2 text-sm outline-none" style={{ borderRadius: R.input, background: OVERLAY.well, color: F.textPrimary }} />
                    </label>
                    <button type="button" onClick={() => uploadRef.current?.click()} className="text-left active:opacity-40"
                        style={{ minHeight: 44, background: 'transparent', border: 'none', color: SETTINGS_HUE.main, fontSize: 15, fontWeight: 500 }}>从相册选一张</button>
                    {editingId && overrides[editingId] && (
                        <button type="button" onClick={() => { setOverride(editingId, undefined); addToast('改回整体头像了', 'success'); setEditingId(null); }}
                            className="text-left active:opacity-40" style={{ minHeight: 44, background: 'transparent', border: 'none', color: STATUS.danger.ink, fontSize: 15, fontWeight: 500 }}>
                            改回整体头像
                        </button>
                    )}
                    <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={upload} />
                </div>
            </ClayDialog>
        </>
    );
};

export default PerCharAvatarRows;
// [EM-END: settings-subpages-f]
