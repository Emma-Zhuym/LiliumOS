import type { GalleryImage, Message } from '../types';
import { DB } from './db';
import { getLocalDateKey } from './localDate';

export async function hideGalleryMessageImages(sourceMessageIds: Array<number | undefined>): Promise<void> {
  const ids = sourceMessageIds.filter(
    (sourceMessageId): sourceMessageId is number => Number.isInteger(sourceMessageId) && Number(sourceMessageId) > 0,
  );
  await Promise.all(ids.map(async sourceMessageId => {
    try {
      await DB.updateMessageMetadata(sourceMessageId, previous => ({
        ...(previous || {}),
        galleryHidden: true,
      }));
    } catch {
      // Gallery imports may not have a surviving source message; deletion should still succeed.
    }
  }));
}

export function isGalleryEligibleImageMessage(message: Message): boolean {
  if (message.type !== 'image' || !message.content?.trim()) return false;
  if (message.metadata?.galleryHidden === true) return false;
  const status = message.metadata?.imageGenerationStatus;
  return status !== 'pending' && status !== 'failed';
}

function makeGalleryImage(message: Message): GalleryImage {
  return {
    id: `chat-image-${message.id}`,
    charId: message.charId,
    url: message.content,
    timestamp: message.timestamp || message.id,
    sourceMessageId: message.id,
    sourceRole: message.role === 'assistant' ? 'assistant' : 'user',
    savedDate: getLocalDateKey(new Date(message.timestamp || Date.now())),
  };
}

/**
 * Save one completed private-chat image into Gallery.
 * Gallery failures intentionally stay non-fatal because the chat message is the source of truth.
 */
export async function saveChatImageMessageToGallery(message: Message): Promise<GalleryImage | null> {
  if (!isGalleryEligibleImageMessage(message) || message.groupId) return null;

  const existing = await DB.findGalleryImageBySourceMessageId(message.charId, message.id);
  const sourceRole: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user';
  if (existing) {
    if (existing.sourceRole !== sourceRole || existing.url !== message.content) {
      const updated = { ...existing, url: message.content, sourceRole };
      await DB.saveGalleryImage(updated);
      return updated;
    }
    return existing;
  }

  const created = makeGalleryImage(message);
  await DB.saveGalleryImage(created);
  return created;
}

/**
 * Reconcile old private image messages into Gallery. This covers role-generated photos created
 * before the two write paths were unified. Deleted gallery rows stay deleted via message metadata.
 */
export async function syncGalleryImagesFromMessages(charId: string): Promise<number> {
  const [messages, galleryImages] = await Promise.all([
    DB.getImageMessagesByCharId(charId),
    DB.getGalleryImages(charId),
  ]);
  const bySourceId = new Map(
    galleryImages
      .filter(image => Number.isInteger(image.sourceMessageId))
      .map(image => [image.sourceMessageId as number, image]),
  );
  let added = 0;

  for (const message of messages) {
    if (!isGalleryEligibleImageMessage(message)) continue;
    const existing = bySourceId.get(message.id);
    const sourceRole: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user';
    if (existing) {
      if (existing.sourceRole !== sourceRole || existing.url !== message.content) {
        await DB.saveGalleryImage({ ...existing, url: message.content, sourceRole });
      }
      continue;
    }
    await DB.saveGalleryImage(makeGalleryImage(message));
    added += 1;
  }

  return added;
}
