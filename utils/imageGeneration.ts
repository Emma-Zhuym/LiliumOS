import type {
  CharacterProfile,
  ImageGenerationApiConfig,
  ImageGenerationProvider,
} from '../types';
import { dataUrlToBlob, getBlobForRef, isBlobRef } from './blobRef';

export const DEFAULT_IMAGE_GENERATION_CONFIG: Required<Pick<ImageGenerationApiConfig, 'provider' | 'useCharacterReference'>> = {
  provider: 'pollinations-free',
  useCharacterReference: true,
};

export interface ResolvedImageGenerationConfig {
  provider: ImageGenerationProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
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
  useCharacterReference: config?.useCharacterReference !== false,
});

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
  String(payload?.error?.message || payload?.message || payload?.detail || fallback);

const parseImageResponse = async (response: Response): Promise<string> => {
  const raw = await response.text();
  let payload: any = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { /* retain raw for error */ }
  if (!response.ok) {
    throw new ImageApiResponseError(responseMessage(payload, raw.slice(0, 180) || `HTTP ${response.status}`), response.status);
  }
  const item = payload?.data?.[0] ?? payload?.images?.[0] ?? payload?.output?.[0];
  if (typeof item === 'string' && item) return item;
  if (typeof item?.url === 'string' && item.url) return item.url;
  if (typeof item?.b64_json === 'string' && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (typeof payload?.url === 'string' && payload.url) return payload.url;
  if (typeof payload?.b64_json === 'string' && payload.b64_json) return `data:image/png;base64,${payload.b64_json}`;
  throw new Error('生图接口没有返回可用图片');
};

const requestGeneration = async (
  config: ResolvedImageGenerationConfig,
  prompt: string,
  fetchImpl: typeof fetch,
): Promise<string> => {
  const response = await fetchImpl(`${config.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      n: 1,
      size: '1024x1024',
    }),
  });
  return parseImageResponse(response);
};

const requestEdit = async (
  config: ResolvedImageGenerationConfig,
  prompt: string,
  reference: Blob,
  fetchImpl: typeof fetch,
): Promise<string> => {
  const form = new FormData();
  form.append('model', config.model);
  form.append('prompt', `${IDENTITY_REFERENCE_PROMPT}\n\nScene prompt: ${prompt}`);
  form.append('image[]', reference, `character-reference.${reference.type === 'image/jpeg' ? 'jpg' : 'png'}`);
  form.append('size', '1024x1024');
  form.append('n', '1');
  const response = await fetchImpl(`${config.baseUrl}/images/edits`, {
    method: 'POST',
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    body: form,
  });
  return parseImageResponse(response);
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
      const url = await requestEdit(config, input.prompt, referenceBlob, fetchImpl);
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
    url: await requestGeneration(config, input.prompt, fetchImpl),
    provider: config.provider,
    model: config.model,
    referenceUsed: false,
    warning,
  };
}
