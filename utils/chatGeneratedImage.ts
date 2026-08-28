import type { CharacterProfile, ImageGenerationApiConfig } from '../types';
import { migrateDataUrlToRef } from './blobRef';
import { DB } from './db';
import { generateChatImage, type GeneratedChatImage } from './imageGeneration';
import { getPhotoStylePrompt } from './photoStylePresets';
import { saveChatImageMessageToGallery } from './galleryMessageSync';

export type ChatImageGenerationStatus = 'pending' | 'generated' | 'failed';

interface GeneratePersistedChatImageInput {
  messageId: number;
  char: CharacterProfile;
  config?: ImageGenerationApiConfig;
  prompt: string;
  photoStyle?: string;
}

export async function generatePersistedChatImage(
  input: GeneratePersistedChatImageInput,
): Promise<GeneratedChatImage> {
  await DB.updateMessageMetadata(input.messageId, prev => ({
    ...(prev || {}),
    imageGenerationStatus: 'pending' satisfies ChatImageGenerationStatus,
    imageGenerationFailed: false,
    imageGenerationError: undefined,
  }));

  try {
    const stylePrompt = getPhotoStylePrompt(input.photoStyle);
    const generated = await generateChatImage({
      prompt: stylePrompt ? `${input.prompt}, ${stylePrompt}` : input.prompt,
      // 身份参考只看角色写下的原始场景，不能被“电影写真”等画风词误触发。
      scenePrompt: input.prompt,
      char: input.char,
      config: input.config,
    });
    const persistedContent = generated.url.startsWith('data:image/')
      ? await migrateDataUrlToRef(generated.url)
      : generated.url;

    await DB.updateMessage(input.messageId, persistedContent);
    await DB.updateMessageMetadata(input.messageId, prev => ({
      ...(prev || {}),
      imageGenerationStatus: 'generated' satisfies ChatImageGenerationStatus,
      imageGenerationFailed: false,
      imageGenerationError: undefined,
      imageGenerationProvider: generated.provider,
      imageGenerationModel: generated.model,
      characterReferenceUsed: generated.referenceUsed,
    }));
    try {
      const completedMessage = await DB.getMessageById(input.messageId);
      if (completedMessage) await saveChatImageMessageToGallery(completedMessage);
    } catch (galleryError) {
      console.warn('[Chat] 角色照片写入相册失败，聊天图片已保留', galleryError);
    }
    return generated;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await DB.updateMessageMetadata(input.messageId, prev => ({
      ...(prev || {}),
      imageGenerationStatus: 'failed' satisfies ChatImageGenerationStatus,
      imageGenerationFailed: true,
      imageGenerationError: reason,
    }));
    throw error;
  }
}
