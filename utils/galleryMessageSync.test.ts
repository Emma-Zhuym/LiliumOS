import { beforeEach, describe, expect, it } from 'vitest';
import { DB, openDB } from './db';
import {
  hideGalleryMessageImages,
  isGalleryEligibleImageMessage,
  syncGalleryImagesFromMessages,
} from './galleryMessageSync';

async function clearStore(name: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(name, 'readwrite');
    transaction.objectStore(name).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

beforeEach(async () => {
  await clearStore('messages');
  await clearStore('gallery');
});

describe('galleryMessageSync', () => {
  it('accepts completed user and assistant photos but skips pending or failed generations', () => {
    const base = { id: 1, charId: 'char-a', role: 'assistant' as const, type: 'image' as const, content: 'blobref:image', timestamp: Date.now() };
    expect(isGalleryEligibleImageMessage(base)).toBe(true);
    expect(isGalleryEligibleImageMessage({ ...base, metadata: { imageGenerationStatus: 'pending' } })).toBe(false);
    expect(isGalleryEligibleImageMessage({ ...base, metadata: { imageGenerationStatus: 'failed' } })).toBe(false);
  });

  it('backfills both sides of an old private chat without duplicating existing user gallery rows', async () => {
    const userId = await DB.saveMessage({ charId: 'char-a', role: 'user', type: 'image', content: 'blobref:user' });
    const assistantId = await DB.saveMessage({ charId: 'char-a', role: 'assistant', type: 'image', content: 'blobref:assistant', metadata: { aiGenerated: true, imageGenerationStatus: 'generated' } });
    const userMessage = await DB.getMessageById(userId);
    await DB.saveGalleryImage({
      id: 'existing-user-photo',
      charId: 'char-a',
      url: 'blobref:user',
      timestamp: userMessage!.timestamp,
      sourceMessageId: userId,
    });

    expect(await syncGalleryImagesFromMessages('char-a')).toBe(1);
    const images = await DB.getGalleryImages('char-a');
    expect(images).toHaveLength(2);
    expect(images.find(image => image.sourceMessageId === userId)?.sourceRole).toBe('user');
    expect(images.find(image => image.sourceMessageId === assistantId)?.sourceRole).toBe('assistant');
  });

  it('does not resurrect a gallery row that the user deleted', async () => {
    const messageId = await DB.saveMessage({ charId: 'char-a', role: 'assistant', type: 'image', content: 'blobref:assistant' });
    await syncGalleryImagesFromMessages('char-a');
    const [image] = await DB.getGalleryImages('char-a');
    await hideGalleryMessageImages([messageId]);
    await DB.deleteGalleryImage(image.id);

    expect(await syncGalleryImagesFromMessages('char-a')).toBe(0);
    expect(await DB.getGalleryImages('char-a')).toEqual([]);
    expect((await DB.getMessageById(messageId))?.metadata?.galleryHidden).toBe(true);
  });
});
