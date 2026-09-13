import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DB } from './db';
import { applyRealConversationToPhoneState, mergePhoneScanResults, upsertContact } from './relationshipChat';
import { stripBackupImages } from './backupExport';
import { assembleV2Backup, createV2ArrayFieldWriter, writeV2Backup } from './backupFormat';
import type { CharacterProfile } from '../types';

const result = {
    partnerName: '乙', partnerCharId: 'b', detail: '我: 晚上见。\n对方: 好呀。', delta: 5,
    learnedNew: '喜欢下雨天', topicStart: 1, timestamp: 1700000000000, recordId: 'a-to-b',
};

describe('查手机对话保存与备份', () => {
    it('异步结果基于最新状态合并，保留期间新加的联系人、记录、备注和话题盒', () => {
        const old = applyRealConversationToPhoneState(undefined, result).phoneState;
        const live = {
            ...old,
            contacts: upsertContact(old.contacts!.map(c => ({ ...c, note: '刚改的备注', affinity: 20,
                topicBox: [{ id: 'topic', text: '一起吃饭', createdAt: 1, span: 100 }], archivedThru: 100 })),
            { name: '丙', kind: 'npc' }),
            records: [...old.records, { id: 'new', type: 'chat', title: '丙', detail: '不会丢失的对话', timestamp: 2 }],
            sendToChat: false,
        };
        const next = applyRealConversationToPhoneState(live, { ...result, detail: '续说', partnerNote: '旧备注' }).phoneState;
        expect(next.records.map(r => r.id)).toEqual(['a-to-b', 'new']);
        expect(next.records[1]).toEqual(live.records[1]);
        expect(next.contacts).toHaveLength(2);
        expect(next.contacts![0]).toMatchObject({ note: '刚改的备注', affinity: 25, archivedThru: 100, topicBox: live.contacts[0].topicBox });
        expect(next.sendToChat).toBe(false);
        expect(live.records[0].detail).toBe(result.detail);
    });

    it.each(['full', 'text_only'] as const)('%s：完整原文、真实/NPC 联系人和话题盒随分片 ZIP 恢复', async mode => {
        const phoneState = applyRealConversationToPhoneState(undefined, result).phoneState;
        phoneState.sendToChat = false; // 不依赖主聊天里的 phone_card 副本
        phoneState.contacts = upsertContact(phoneState.contacts!, { name: '丙', kind: 'npc' });
        phoneState.contacts[0].topicBox = [{ id: 'topic', text: '归档总结', createdAt: 1, span: 100 }];
        phoneState.contacts[0].archivedThru = 100;
        phoneState.contacts[0].avatar = 'data:image/png;base64,AAAA';
        phoneState.records[0].detail = Array.from({ length: 110 }, (_, i) => `${i % 2 ? '对方' : '我'}: 消息 ${i}`).join('\n');
        phoneState.records.push({ id: 'npc', contactId: phoneState.contacts[1].id, type: 'chat', title: '丙', detail: '我: 你好\n对方: 在呢', timestamp: 2 });
        const char = { id: 'a', name: '甲', phoneState } as CharacterProfile;
        await DB.importFullData({ characters: [char], messages: [] } as any);

        const zip = new JSZip();
        let manifest;
        if (mode === 'text_only') {
            // 与设置页相同：游标逐条剥图、写预分片，不能只测 DB.exportFullData。
            const writer = createV2ArrayFieldWriter(zip, 'characters');
            await DB.streamRawStoreData('characters', item => { writer.appendSync([stripBackupImages(item)]); });
            manifest = await writeV2Backup(zip, {}, { mode, prewrittenStores: { characters: await writer.finish() } });
        } else {
            manifest = await writeV2Backup(zip, { characters: await DB.getRawStoreData('characters') }, { mode });
        }
        const bytes = await zip.generateAsync({ type: 'uint8array' });
        const data = await assembleV2Backup(await JSZip.loadAsync(bytes), manifest);
        await DB.importFullData({ characters: [], messages: [] } as any);
        expect(await DB.getAllCharacters()).toEqual([]);
        await DB.importFullData(data as any);
        const restored = (await DB.getAllCharacters()).find(c => c.id === char.id)!;
        expect(restored.phoneState).toEqual(mode === 'text_only' ? stripBackupImages(phoneState) : phoneState);
        expect(restored.phoneState!.records[0].detail.split('\n')).toHaveLength(110);
    });
});

describe('phone result concurrency boundaries', () => {
    it('does not refill a deliberately cleared existing note or duplicate a renamed real contact', () => {
        const current = applyRealConversationToPhoneState(undefined, result).phoneState;
        current.contacts![0].name = '新名字';
        current.contacts![0].note = '';
        const next = applyRealConversationToPhoneState(current, { ...result, partnerNote: '旧备注' }).phoneState;
        expect(next.contacts).toHaveLength(1);
        expect(next.contacts![0].name).toBe('新名字');
        expect(next.contacts![0].note).toBe('');
    });
});

describe('phone scan merges against live contacts', () => {
    it('keeps newly added contacts, cleared notes, topic-box edits and live affinity while retaining new records', () => {
        const old = applyRealConversationToPhoneState(undefined, result).phoneState;
        const baseline = old.contacts!;
        const generated = { ...baseline[0], note: 'old note', affinity: 50, lastInteraction: 999 };
        const live = { ...baseline[0], note: '', affinity: -10,
            topicBox: [{ id: 'new', text: 'new memory', createdAt: 2, span: 100 }] };
        const unrelated = { ...live, id: 'other', name: 'Other', linkedCharId: 'c' };
        const current = { ...old, sendToChat: false, contacts: [live, unrelated] };
        const record = { ...old.records[0], id: 'new-record' };
        const next = mergePhoneScanResults(current, baseline, [generated], [record]);
        expect(next.contacts).toEqual([live, unrelated]);
        expect(next.records).toEqual([...old.records, record]);
        expect(next.sendToChat).toBe(false);
        expect(baseline[0].note).toBeUndefined();
    });
    it('does not resurrect removed contacts and remaps a newly discovered contact to the current identity', () => {
        const old = applyRealConversationToPhoneState(undefined, result).phoneState;
        const removed = mergePhoneScanResults({ records: [], contacts: [] }, old.contacts!, old.contacts!, old.records);
        expect(removed.contacts).toEqual([]); expect(removed.records).toEqual([]);
        const live = { ...old.contacts![0], id: 'live-contact', affinity: 45 };
        const next = mergePhoneScanResults({ records: [], contacts: [live] }, [], old.contacts!, old.records);
        expect(next.contacts).toEqual([live]);
        expect(next.records[0].contactId).toBe('live-contact');
    });
});
