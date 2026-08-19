import type {
  CharacterProfile,
  ImageGenerationApiConfig,
  ImageGenerationProvider,
  ImageGenerationRequestMode,
} from '../types';
import { dataUrlToBlob, getBlobForRef, isBlobRef } from './blobRef';
import { getProxyWorkerUrl } from './proxyWorker';
import { recordApiCall, type ApiCallMeta } from './apiCallLog';

export const DEFAULT_IMAGE_GENERATION_CONFIG: Required<Pick<ImageGenerationApiConfig, 'provider' | 'useCharacterReference'>> = {
  provider: 'pollinations-free',
  useCharacterReference: true,
};

export interface ResolvedImageGenerationConfig {
  provider: ImageGenerationProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  requestMode: ImageGenerationRequestMode;
  useCharacterReference: boolean;
}

export interface GeneratedChatImage {
  url: string;
  provider: ImageGenerationProvider;
  model?: string;
  referenceUsed: boolean;
  warning?: string;
}

interface GenerateChatImageInput {
  prompt: string;
  char?: CharacterProfile;
  config?: ImageGenerationApiConfig;
  seed?: number;
  fetchImpl?: typeof fetch;
}

class ImageApiResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ImageApiResponseError';
  }
}

const IDENTITY_REFERENCE_PROMPT = [
  'Use the attached character artwork only as the identity reference.',
  'Preserve the same face shape, eyes, facial proportions, hairline, hair color, and distinctive facial features.',
  'Do not copy the reference pose, expression, clothing, framing, or background unless the scene prompt asks for them.',
].join(' ');

const isUsableImageSource = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const source = value.trim();
  return isBlobRef(source)
    || /^data:image\//i.test(source)
    || /^https?:\/\//i.test(source)
    || source.startsWith('/');
};

const orderedSpriteSources = (sprites?: Record<string, string>): string[] => {
  if (!sprites) return [];
  const primary = ['normal', 'default']
    .map(key => sprites[key])
    .filter(isUsableImageSource);
  const remaining = Object.entries(sprites)
    .filter(([key, value]) => key !== 'chibi' && !['normal', 'default'].includes(key) && isUsableImageSource(value))
    .map(([, value]) => value);
  return [...primary, ...remaining];
};

/** 当前皮肤中性立绘 → 当前皮肤其它立绘 → 默认立绘 → 头像；永不把 chibi 当脸。 */
export const pickCharacterImageReference = (char?: CharacterProfile): string | undefined => {
  if (!char) return undefined;
  const activeSkin = char.activeSkinSetId
    ? char.dateSkinSets?.find(skin => skin.id === char.activeSkinSetId)
    : undefined;
  const candidates = [
    ...orderedSpriteSources(activeSkin?.sprites),
    ...orderedSpriteSources(char.sprites),
    char.avatar,
  ];
  return candidates.find(isUsableImageSource);
};

export const resolveImageGenerationConfig = (
  config?: ImageGenerationApiConfig,
): ResolvedImageGenerationConfig => ({
  provider: config?.provider === 'openai-compatible' ? 'openai-compatible' : 'pollinations-free',
  baseUrl: String(config?.baseUrl || '').trim().replace(/\/+$/, ''),
  apiKey: String(config?.apiKey || '').trim(),
  model: String(config?.model || '').trim(),
  requestMode: config?.requestMode === 'proxy' ? 'proxy' : 'direct',
  useCharacterReference: config?.useCharacterReference !== false,
});

const normalizeImagesBaseUrl = (baseUrl: string): string => baseUrl
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/images\/(?:generations|edits)$/i, '')
  .replace(/\/images$/i, '');

export const buildImageApiUrl = (baseUrl: string, mode: 'generations' | 'edits'): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/images\/(?:generations|edits)$/i.test(trimmed)) {
    return trimmed.replace(/\/images\/(?:generations|edits)$/i, `/images/${mode}`);
  }
  if (/\/images$/i.test(trimmed)) return `${trimmed}/${mode}`;
  return `${normalizeImagesBaseUrl(trimmed)}/images/${mode}`;
};

export const buildImageModelsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/models$/i.test(trimmed)) return trimmed;
  return `${normalizeImagesBaseUrl(trimmed)}/models`;
};

export const buildPollinationsImageUrl = (prompt: string, seed = Math.floor(Math.random() * 1_000_000)): string =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&seed=${seed}&nologo=true`;

const toReferenceBlob = async (source: string, fetchImpl: typeof fetch): Promise<Blob> => {
  if (isBlobRef(source)) {
    const blob = await getBlobForRef(source);
    if (!blob) throw new Error('角色立绘文件已经不存在');
    return blob;
  }
  if (/^data:image\//i.test(source)) return dataUrlToBlob(source);
  const response = await fetchImpl(source);
  if (!response.ok) throw new Error(`读取角色立绘失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (blob.type && !blob.type.startsWith('image/')) throw new Error('角色立绘地址没有返回图片');
  return blob;
};

const responseMessage = (payload: any, fallback: string): string =>
  String(payload?.error?.message || payload?.error || payload?.message || payload?.detail || fallback);

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
};

const imageFromPayload = (payload: any): string | undefined => {
  if (!payload) return undefined;
  if (typeof payload === 'string') {
    if (/^(?:https?:\/\/|data:image\/)/i.test(payload)) return payload;
    return `data:image/png;base64,${payload}`;
  }
  for (const key of ['url', 'image_url']) {
    const value = payload[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value?.url === 'string' && value.url) return value.url;
  }
  for (const key of ['b64_json', 'base64', 'b64', 'image', 'result']) {
    const value = payload[key];
    if (typeof value === 'string' && value) {
      return /^data:image\//i.test(value) ? value : `data:${payload.mimeType || 'image/png'};base64,${value}`;
    }
  }
  for (const key of ['data', 'images', 'output', 'content']) {
    const values = payload[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const found = imageFromPayload(value);
      if (found) return found;
    }
  }
  return undefined;
};

const downloadGeneratedImage = async (url: string, fetchImpl: typeof fetch): Promise<string> => {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'image/*' } });
  } catch {
    throw new Error('接口返回了图片网址，但浏览器无法下载图片；请切换到稳定中转后重试');
  }
  if (!response.ok) throw new Error(`下载生成图片失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (blob.type && !blob.type.startsWith('image/')) throw new Error('生成结果网址没有返回图片');
  return blobToDataUrl(blob);
};

const parseImageResponse = async (response: Response, fetchImpl: typeof fetch): Promise<string> => {
  const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
  if (response.ok && contentType.startsWith('image/')) {
    return blobToDataUrl(await response.blob());
  }
  const raw = await response.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { /* retain raw for error */ }
  if (!response.ok) {
    throw new ImageApiResponseError(responseMessage(payload, raw.slice(0, 180) || `HTTP ${response.status}`), response.status);
  }
  const image = imageFromPayload(payload);
  if (/^https?:\/\//i.test(image || '')) return downloadGeneratedImage(image!, fetchImpl);
  if (image) return image;
  throw new Error('生图接口没有返回可用图片');
};

const imageCallMeta = (
  input: GenerateChatImageInput,
  referenceUsed: boolean,
  requestMode: ImageGenerationRequestMode,
): ApiCallMeta => ({
  appId: input.char ? 'chat' : 'settings',
  appName: input.char ? '消息' : '设置',
  charId: input.char?.id,
  charName: input.char?.name,
  purpose: input.char
    ? `AI 发照片${referenceUsed ? ' · 参考立绘' : ''}${requestMode === 'proxy' ? ' · Worker 中转' : ''}`
    : `测试生图 API${requestMode === 'proxy' ? ' · Worker 中转' : ''}`,
});

/**
 * 生图不经过 chat/completions 的全局日志拦截器，因此在这里显式记一笔。
 * logBody 只含模型与文字提示词，绝不把 Key、FormData 或参考图 Base64 落库。
 */
const requestAndParseImage = async (input: {
  networkUrl: string;
  logicalUrl: string;
  init: RequestInit;
  model: string;
  prompt: string;
  meta: ApiCallMeta;
  fetchImpl: typeof fetch;
}): Promise<string> => {
  const startedAt = Date.now();
  let response: Response | undefined;
  const logBody = {
    model: input.model,
    messages: [{ role: 'user', content: input.prompt }],
  };
  try {
    response = await input.fetchImpl(input.networkUrl, input.init);
    const image = await parseImageResponse(response, input.fetchImpl);
    recordApiCall({
      url: input.logicalUrl,
      body: logBody,
      status: response.status,
      ok: true,
      meta: input.meta,
      durationMs: Date.now() - startedAt,
    });
    return image;
  } catch (error) {
    recordApiCall({
      url: input.logicalUrl,
      body: logBody,
      status: response?.status,
      ok: false,
      meta: input.meta,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
};

const requestGeneration = async (
  config: ResolvedImageGenerationConfig,
  prompt: string,
  fetchImpl: typeof fetch,
  meta: ApiCallMeta,
): Promise<string> => {
  const url = buildImageApiUrl(config.baseUrl, 'generations');
  return requestAndParseImage({
    networkUrl: url,
    logicalUrl: url,
    model: config.model,
    prompt,
    meta,
    fetchImpl,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        prompt,
        n: 1,
      }),
    },
  });
};

const requestEdit = async (
  config: ResolvedImageGenerationConfig,
  prompt: string,
  reference: Blob,
  fetchImpl: typeof fetch,
  meta: ApiCallMeta,
): Promise<string> => {
  const form = new FormData();
  const fullPrompt = `${IDENTITY_REFERENCE_PROMPT}\n\nScene prompt: ${prompt}`;
  form.append('model', config.model);
  form.append('prompt', fullPrompt);
  form.append('image', reference, `character-reference.${reference.type === 'image/jpeg' ? 'jpg' : 'png'}`);
  form.append('n', '1');
  const url = buildImageApiUrl(config.baseUrl, 'edits');
  return requestAndParseImage({
    networkUrl: url,
    logicalUrl: url,
    model: config.model,
    prompt: fullPrompt,
    meta,
    fetchImpl,
    init: {
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
      body: form,
    },
  });
};

const requestViaProxy = async (
  config: ResolvedImageGenerationConfig,
  prompt: string,
  reference: Blob | undefined,
  fetchImpl: typeof fetch,
  meta: ApiCallMeta,
): Promise<string> => {
  const fullPrompt = reference ? `${IDENTITY_REFERENCE_PROMPT}\n\nScene prompt: ${prompt}` : prompt;
  return requestAndParseImage({
    networkUrl: `${getProxyWorkerUrl()}/image-generation`,
    logicalUrl: buildImageApiUrl(config.baseUrl, reference ? 'edits' : 'generations'),
    model: config.model,
    prompt: fullPrompt,
    meta,
    fetchImpl,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        baseUrl: config.baseUrl,
        model: config.model,
        prompt: fullPrompt,
        referenceImageDataUrl: reference ? await blobToDataUrl(reference) : undefined,
      }),
    },
  });
};

export async function generateChatImage(input: GenerateChatImageInput): Promise<GeneratedChatImage> {
  const config = resolveImageGenerationConfig(input.config);
  if (config.provider === 'pollinations-free') {
    return {
      url: buildPollinationsImageUrl(input.prompt, input.seed),
      provider: config.provider,
      referenceUsed: false,
    };
  }
  if (!config.baseUrl || !config.model) throw new Error('请先在设置中填写生图 API 的 URL 和 Model');

  const fetchImpl = input.fetchImpl || fetch;
  const referenceSource = config.useCharacterReference ? pickCharacterImageReference(input.char) : undefined;
  let warning: string | undefined;
  if (config.useCharacterReference && !referenceSource) {
    warning = '这个角色还没有可用的立绘，已按纯文字生成';
  }

  if (referenceSource) {
    try {
      const referenceBlob = await toReferenceBlob(referenceSource, fetchImpl);
      const meta = imageCallMeta(input, true, config.requestMode);
      const url = config.requestMode === 'proxy'
        ? await requestViaProxy(config, input.prompt, referenceBlob, fetchImpl, meta)
        : await requestEdit(config, input.prompt, referenceBlob, fetchImpl, meta);
      return { url, provider: config.provider, model: config.model, referenceUsed: true };
    } catch (error) {
      const canFallback = !(error instanceof ImageApiResponseError)
        || [400, 404, 405, 415, 422].includes(error.status);
      if (!canFallback) throw error;
      warning = error instanceof ImageApiResponseError
        ? '这个接口或模型不支持参考图，已降级为纯文字生成'
        : `读取角色立绘失败，已降级为纯文字生成：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return {
    url: config.requestMode === 'proxy'
      ? await requestViaProxy(config, input.prompt, undefined, fetchImpl, imageCallMeta(input, false, config.requestMode))
      : await requestGeneration(config, input.prompt, fetchImpl, imageCallMeta(input, false, config.requestMode)),
    provider: config.provider,
    model: config.model,
    referenceUsed: false,
    warning,
  };
}
