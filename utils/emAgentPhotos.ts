// [EM-START: heartbeat-photos]
/**
 * 心跳主动消息里的照片。
 *
 * 心跳发来的消息是纯文字直接进聊天，不走聊天回复那套后处理，所以 TA 写的
 * 「[一张照片：白瓷盘里一条清蒸鲈鱼…]」只是一行字（阿萌 2026-10-02：发了好几个图片描述，没有图）。
 * 这里把这种行认出来，落成一条「待生成」的图片消息，再按描述去生图——
 * 跟聊天里 [[SEND_PHOTO]] 走同一个生图设置、同一个落库函数，失败了也能在气泡上点重新生成。
 * 后端提示词教的是 [[SEND_PHOTO: 英文描述]]；中文方括号那种是模型模仿聊天记录写出来的，也一并认。
 */

import type { APIConfig } from '../types';
import { normalizeApiConfig } from './apiConfigNormalize';
import { generatePersistedChatImage } from './chatGeneratedImage';
import { DB } from './db';

const SEND_PHOTO_RE = /^\[\[\s*SEND_PHOTO\s*[:：]\s*([\s\S]+?)\s*\]\]$/i;
const CN_PHOTO_RE = /^[\[【［]\s*(?:你|我)?(?:发了|发送了|拍了)?(?:一张)?(?:照片|图片)\s*[:：]\s*([\s\S]+?)\s*[\]】］]$/;

/** 这一个气泡是不是一张照片；是的话返回描述。夹在句子中间的不算，只认单独成行的。 */
export const parsePhotoBubble = (chunk: string): string | null => {
    const text = String(chunk ?? '').trim();
    const match = text.match(SEND_PHOTO_RE) ?? text.match(CN_PHOTO_RE);
    const prompt = match?.[1]?.trim();
    return prompt ? prompt : null;
};

export interface AgentPhotoJob {
    messageId: number;
    charId: string;
    prompt: string;
}

const loadImageConfig = (): APIConfig['imageGeneration'] | undefined => {
    if (typeof localStorage === 'undefined') return undefined;
    try {
        const raw = localStorage.getItem('os_api_config');
        return raw ? normalizeApiConfig(JSON.parse(raw)).imageGeneration : undefined;
    } catch {
        return undefined;
    }
};

/** 逐张生成。一张失败不连累后面的；失败原因已经由 generatePersistedChatImage 记在那条消息上。 */
export const generateAgentPhotos = async (jobs: AgentPhotoJob[]): Promise<void> => {
    for (const job of jobs) {
        try {
            const char = await DB.getCharacter(job.charId);
            if (!char) continue;
            await generatePersistedChatImage({
                messageId: job.messageId,
                char,
                config: loadImageConfig(),
                prompt: job.prompt,
                photoStyle: (char as { photoStyle?: string }).photoStyle,
            });
        } catch (error) {
            console.warn('[心跳照片] 生图失败，气泡上可以点重新生成', error);
        } finally {
            // 让开着的聊天页重读消息（跟收件箱落库同一个事件）
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId: job.charId } }));
            }
        }
    }
};
// [EM-END: heartbeat-photos]
