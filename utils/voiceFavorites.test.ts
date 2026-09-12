import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import {
    VOICE_FAVORITES_INDEX_ASSET_ID,
    getVoiceFavoriteBlob,
    listVoiceFavorites,
    makeVoiceFavoriteId,
    removeVoiceFavorite,
    saveVoiceFavorite,
    sortVoiceFavorites,
    voiceFavoriteAudioAssetId,
    type VoiceFavorite,
} from './voiceFavorites';

const base = {
    source: 'chat' as const,
    sourceKey: 'char-1:message-1',
    charId: 'char-1',
    charName: 'Sully',
    sourceTimestamp: 100,
    originalText: '你好',
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

beforeEach(async () => {
    const prior = await listVoiceFavorites();
    await Promise.all(prior.map(item => DB.deleteAsset(voiceFavoriteAudioAssetId(item.id))));
    await DB.deleteAsset(VOICE_FAVORITES_INDEX_ASSET_ID);
});

describe('voice favorites repository', () => {
    it('saves text-only user voice without audio, network or synthesis configuration', async () => {
        const fetchMock = vi.fn(() => { throw new Error('unexpected network'); });
        vi.stubGlobal('fetch', fetchMock);
        const saved = await saveVoiceFavorite({ ...base, originalText: '第一句\n第二句', speakerRole: 'user', speakerName: '我' });
        expect(await listVoiceFavorites()).toEqual([expect.objectContaining({
            id: saved.id, audioState: 'none', speakerRole: 'user', speakerName: '我', originalText: '第一句\n第二句',
        })]);
        expect(await getVoiceFavoriteBlob(saved.id)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('text-only upsert keeps existing audio and original favorite time', async () => {
        const saved = await saveVoiceFavorite({ ...base, blob: new Blob(['existing']), favoritedAt: 10 });
        const updated = await saveVoiceFavorite({ ...base, originalText: '新文字' });
        expect(updated).toMatchObject({ id: saved.id, favoritedAt: 10, audioState: 'stored' });
        expect(await (await getVoiceFavoriteBlob(saved.id))?.text()).toBe('existing');
        expect(await listVoiceFavorites()).toHaveLength(1);
    });

    it('rolls back new audio when saving its index fails', async () => {
        const saved = await saveVoiceFavorite({ ...base, blob: new Blob(['old']) });
        const originalPut = IDBObjectStore.prototype.put;
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
            if (value.id === VOICE_FAVORITES_INDEX_ASSET_ID) throw new DOMException('quota', 'QuotaExceededError');
            return originalPut.call(this, value, key);
        });
        await expect(saveVoiceFavorite({ ...base, originalText: '更新', blob: new Blob(['new']) })).rejects.toThrow('quota');
        put.mockRestore();
        expect((await listVoiceFavorites())[0].originalText).toBe(base.originalText);
        expect(await (await getVoiceFavoriteBlob(saved.id))?.text()).toBe('old');
    });

    it('preserves source audio and unrelated assets when removing a favorite', async () => {
        await DB.saveAssetRaw('voice_msg_source', { blob: new Blob(['source']) });
        await DB.saveAssetRaw('content_favorites_preservation_probe', { owners: ['user', 'char-1'] });
        await saveVoiceFavorite(base);
        await removeVoiceFavorite(base.source, base.sourceKey);
        expect(await (await DB.getAssetRaw('voice_msg_source')).blob.text()).toBe('source');
        expect(await DB.getAssetRaw('content_favorites_preservation_probe')).toEqual({ owners: ['user', 'char-1'] });
        await DB.deleteAsset('voice_msg_source');
        await DB.deleteAsset('content_favorites_preservation_probe');
    });

    it('reads old v1 audio entries and refuses to overwrite a corrupt index', async () => {
        const id = makeVoiceFavoriteId(base.source, base.sourceKey);
        await DB.saveAssetRaw(VOICE_FAVORITES_INDEX_ASSET_ID, { version: 1, items: [{ ...base, id, favoritedAt: 10 }] });
        expect((await listVoiceFavorites())[0].audioState).toBe('stored');
        await DB.saveAssetRaw(VOICE_FAVORITES_INDEX_ASSET_ID, { version: 1, items: 'corrupt' });
        await expect(saveVoiceFavorite(base)).rejects.toThrow('索引无法读取');
        expect(await DB.getAssetRaw(VOICE_FAVORITES_INDEX_ASSET_ID)).toEqual({ version: 1, items: 'corrupt' });
        await DB.deleteAsset(VOICE_FAVORITES_INDEX_ASSET_ID);
    });

    it('does not turn a database read failure into an empty list', async () => {
        vi.spyOn(DB, 'getAssetRaw').mockRejectedValueOnce(new Error('read failed'));
        await expect(listVoiceFavorites()).rejects.toThrow('read failed');
    });

    it('uses a stable id and keeps metadata newest-first without loading audio', async () => {
        expect(makeVoiceFavoriteId('chat', base.sourceKey)).toBe(makeVoiceFavoriteId('chat', base.sourceKey));
        expect(makeVoiceFavoriteId('chat', base.sourceKey)).not.toBe(makeVoiceFavoriteId('call', base.sourceKey));

        await saveVoiceFavorite({ ...base, favoritedAt: 10, blob: new Blob(['a'], { type: 'audio/mpeg' }) });
        await saveVoiceFavorite({ ...base, source: 'date', sourceKey: 'date-1', favoritedAt: 20, blob: new Blob(['b'], { type: 'audio/ogg' }) });

        const items = await listVoiceFavorites();
        expect(items.map(item => item.source)).toEqual(['date', 'chat']);
        expect(items[0]).not.toHaveProperty('blob');
        expect((await getVoiceFavoriteBlob(items[0].id))?.type).toBe('audio/ogg');
    });

    it('upserts one source item and removes its separate audio asset', async () => {
        await saveVoiceFavorite({ ...base, favoritedAt: 10, blob: new Blob(['old']) });
        const updated = await saveVoiceFavorite({ ...base, originalText: '更新', blob: new Blob(['new']) });

        expect((await listVoiceFavorites())).toHaveLength(1);
        expect((await listVoiceFavorites())[0].originalText).toBe('更新');
        expect(await (await getVoiceFavoriteBlob(updated.id))?.text()).toBe('new');

        expect(await removeVoiceFavorite('chat', base.sourceKey)).toBe(true);
        expect(await listVoiceFavorites()).toEqual([]);
        expect(await getVoiceFavoriteBlob(updated.id)).toBeNull();
    });

    it('sorts by the source message time', () => {
        const favorite = (id: string, sourceTimestamp: number): VoiceFavorite => ({
            ...base,
            id,
            favoritedAt: id === 'old' ? 100 : 1,
            sourceTimestamp,
            audioState: 'none',
        });
        expect(sortVoiceFavorites([favorite('old', 1), favorite('new', 2)]).map(item => item.id)).toEqual(['new', 'old']);
    });
});
