import { describe, expect, it } from 'vitest';
import {
    VOICE_BACKUP_DIR,
    VOICE_BACKUP_MARKER,
    externalizeVoiceMessageBlobs,
    restoreVoiceMessageBlobs,
    shouldIncludeVoiceRelatedAssetInBackup,
    markVoiceFavoriteAudioOmitted,
} from './voiceMessageBackup';
import { VOICE_FAVORITE_AUDIO_PREFIX, VOICE_FAVORITES_INDEX_ASSET_ID } from './voiceFavorites';
import { listVoiceFavorites, saveVoiceFavorite } from './voiceFavorites';
import { DB } from './db';


describe('chat voice backup binary lane', () => {
    it('imports text favorites without replacing unrelated assets or source audio', async () => {
        await DB.deleteAsset(VOICE_FAVORITES_INDEX_ASSET_ID);
        const favorite = await saveVoiceFavorite({ source: 'chat', sourceKey: 'round-trip', charId: 'c', charName: '角色', sourceTimestamp: 10, originalText: '保留文字' });
        const index = { version: 1 as const, items: [favorite] };
        await DB.saveAssetRaw('voice_backup_asset_probe', { value: 'keep' });
        await DB.deleteAsset(VOICE_FAVORITES_INDEX_ASSET_ID);
        await DB.importFullData({ voiceFavoritesIndex: JSON.parse(JSON.stringify(index)) } as any);
        expect((await listVoiceFavorites())[0].originalText).toBe('保留文字');
        expect(await DB.getAssetRaw('voice_backup_asset_probe')).toEqual({ value: 'keep' });
        await expect(DB.importFullData({ assets: [], voiceFavoritesIndex: { items: 'bad' } } as any)).rejects.toThrow('索引无法读取');
        expect(await DB.getAssetRaw('voice_backup_asset_probe')).toEqual({ value: 'keep' });
        await expect(DB.importFullData({ voiceFavoritesIndex: null } as any)).rejects.toThrow('索引无法读取');
        expect((await listVoiceFavorites())[0].originalText).toBe('保留文字');
        await DB.importFullData({ voiceFavoritesIndex: { version: 1, items: [] } } as any);
        expect(await listVoiceFavorites()).toEqual([]);
        expect(await DB.getAssetRaw('voice_backup_asset_probe')).toEqual({ value: 'keep' });
        await DB.deleteAsset('voice_backup_asset_probe');
        await DB.deleteAsset(VOICE_FAVORITES_INDEX_ASSET_ID);
    });

    it('keeps all text favorites in text backups without changing the source index', async () => {
        const source = [
            { id: VOICE_FAVORITES_INDEX_ASSET_ID, data: { version: 1, items: [
                { id: 'text', originalText: '纯文字', audioState: 'none', speakerRole: 'user' },
                { id: 'audio', originalText: '有音频', audioState: 'stored' },
                { id: 'legacy', originalText: '旧收藏' },
            ] } },
            { id: `${VOICE_FAVORITE_AUDIO_PREFIX}audio`, data: { blob: new Blob(['audio']) } },
        ];
        const exported = structuredClone(source).filter(asset => shouldIncludeVoiceRelatedAssetInBackup(asset, false));
        markVoiceFavoriteAudioOmitted(exported);
        const restored = JSON.parse(JSON.stringify(exported));
        expect(restored).toHaveLength(1);
        expect(restored[0].data.items.map((item: any) => item.audioState)).toEqual(['none', 'omitted', 'omitted']);
        expect(restored[0].data.items[0].speakerRole).toBe('user');
        expect(source[0].data.items?.[1].audioState).toBe('stored');
        expect(source[0].data.items?.[2]).not.toHaveProperty('audioState');
        let reads = 0;
        expect(await restoreVoiceMessageBlobs(restored, async () => { reads++; return null; })).toBe(0);
        expect(reads).toBe(0);
    });

    it('round-trips per-message audio as a real Blob', async () => {
        const bytes = new Uint8Array([1, 4, 9, 16]);
        const assets: any[] = [
            { id: 'voice_msg_42', data: { blob: new Blob([bytes], { type: 'audio/mpeg' }), favorite: true, originalText: 'hello' } },
            { id: 'ordinary_setting', data: { enabled: true } },
        ];
        const files = new Map<string, Uint8Array>();

        expect(await externalizeVoiceMessageBlobs(assets, (path, data) => { files.set(path, data); })).toBe(1);
        expect(assets[0].data.blob[VOICE_BACKUP_MARKER]).toBe(true);
        expect(assets[0].data.blob.path).toMatch(new RegExp(`^${VOICE_BACKUP_DIR}/`));
        expect(JSON.parse(JSON.stringify(assets))[0].data.blob.size).toBe(bytes.byteLength);

        expect(await restoreVoiceMessageBlobs(assets, async path => files.get(path) || null)).toBe(1);
        expect(assets[0].data.blob).toBeInstanceOf(Blob);
        expect(assets[0].data.blob.type).toBe('audio/mpeg');
        expect(Array.from(new Uint8Array(await assets[0].data.blob.arrayBuffer()))).toEqual(Array.from(bytes));
        expect(assets[0].data.originalText).toBe('hello');
    });

    it('externalizes unified favorites from every source without loading ordinary voice cache', async () => {
        const assets: any[] = [
            { id: `${VOICE_FAVORITE_AUDIO_PREFIX}call_1`, data: { blob: new Blob(['call'], { type: 'audio/mpeg' }) } },
            { id: VOICE_FAVORITES_INDEX_ASSET_ID, data: { version: 1, items: [{ source: 'call' }] } },
            { id: 'voice_msg_ordinary', data: { blob: new Blob(['ordinary']), favorite: false } },
        ];
        const files = new Map<string, Uint8Array>();

        expect(await externalizeVoiceMessageBlobs(assets, (path, data) => { files.set(path, data); })).toBe(1);
        expect(files.size).toBe(1);
        expect(assets[0].data.blob[VOICE_BACKUP_MARKER]).toBe(true);
        expect(shouldIncludeVoiceRelatedAssetInBackup(assets[0])).toBe(true);
        expect(shouldIncludeVoiceRelatedAssetInBackup(assets[1])).toBe(true);
        expect(shouldIncludeVoiceRelatedAssetInBackup(assets[2])).toBe(false);
    });

    it('does not duplicate the reproducible shared TTS cache', async () => {
        const assets: any[] = [
            { id: 'tts_abc', data: { blob: new Blob([new Uint8Array([7])], { type: 'audio/mpeg' }) } },
            { id: 'voice_msg_9', data: { blob: new Blob([new Uint8Array([8])], { type: 'audio/mpeg' }), favorite: false } },
        ];
        const files = new Map<string, Uint8Array>();

        expect(await externalizeVoiceMessageBlobs(assets, (path, data) => { files.set(path, data); })).toBe(0);
        expect(files.size).toBe(0);
        expect(assets[0].data.blob).toBeInstanceOf(Blob);
        expect(assets[1].data.blob).toBeInstanceOf(Blob);
    });

    it('includes only explicit favorites among voice-related asset rows', () => {
        expect(shouldIncludeVoiceRelatedAssetInBackup({ id: 'tts_hash', data: {} })).toBe(false);
        expect(shouldIncludeVoiceRelatedAssetInBackup({ id: 'voice_msg_1', data: { favorite: false } })).toBe(false);
        expect(shouldIncludeVoiceRelatedAssetInBackup({ id: 'voice_msg_2', data: { favorite: true } })).toBe(true);
        expect(shouldIncludeVoiceRelatedAssetInBackup({ id: `${VOICE_FAVORITE_AUDIO_PREFIX}chat_1`, data: {} }, false)).toBe(false);
        expect(shouldIncludeVoiceRelatedAssetInBackup({ id: VOICE_FAVORITES_INDEX_ASSET_ID, data: {} }, false)).toBe(true);
        expect(shouldIncludeVoiceRelatedAssetInBackup({ id: 'wallpaper', data: 'x' })).toBe(true);
    });

    it('rejects a missing or truncated voice file before import', async () => {
        const marker = (size: number) => ({
            [VOICE_BACKUP_MARKER]: true,
            path: `${VOICE_BACKUP_DIR}/voice_msg_1_0.bin`,
            mimeType: 'audio/mpeg',
            size,
        });

        await expect(restoreVoiceMessageBlobs(
            [{ id: 'voice_msg_1', data: { blob: marker(4) } }],
            async () => null,
        )).rejects.toThrow('缺少语音文件');

        await expect(restoreVoiceMessageBlobs(
            [{ id: 'voice_msg_1', data: { blob: marker(4) } }],
            async () => new Uint8Array([1, 2]),
        )).rejects.toThrow('大小不符');

        let reads = 0;
        await expect(restoreVoiceMessageBlobs(
            [{ id: 'voice_msg_1', data: { blob: { ...marker(4), size: '4' } } }],
            async () => { reads++; return new Uint8Array([1, 2, 3, 4]); },
        )).rejects.toThrow('附件标记无效');
        expect(reads).toBe(0);
    });
});
