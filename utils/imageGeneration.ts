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
  /**
   * 未追加画风预设的原始场景描述，仅用于判断画面是否真的需要角色身份参考。
   * 不传时沿用 prompt，兼容设置页测试和旧调用方。
   */
  scenePrompt?: string;
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
  'The scene prompt explicitly requests a visible person or face. Use the attached character artwork only as that person\'s identity reference.',
  'Preserve the same face shape, eyes, facial proportions, hairline, hair color, and distinctive facial features.',
  'Do not copy the reference pose, expression, clothing, framing, or background unless the scene prompt asks for them.',
  'Do not paste, collage, float, or enlarge the reference face into the composition, and do not turn the scene into a selfie unless a selfie is explicitly requested.',
  'Keep anatomy, limbs, perspective, reflections, camera position, and the person\'s physical relationship with nearby objects coherent and plausible.',
].join(' ');

const NO_UNREQUESTED_PERSON_PROMPT = [
  'Composition constraint: Do not add the character, any person, face, portrait, selfie, reflected person, or human figure unless the scene prompt explicitly requests one.',
  'Keep food, objects, rooms, scenery, pets, and still-life images focused only on the requested subject.',
  'If the scene explicitly requests a person whose face is hidden or out of frame, keep the face hidden or out of frame.',
].join(' ');

const HIDDEN_FACE_PATTERN = /(?:\b(?:no|without)\s+(?:any\s+)?(?:people|person|human|character|face|faces)\b|\b(?:back|rear)\s+view\b|\bfrom\s+behind\b|\bface\s+(?:hidden|obscured|covered|out\s+of\s+(?:the\s+)?frame|not\s+visible)\b|\bfaceless\b|\b(?:hand|hands)\s+only\b|\bfirst[-\s]?person\s+(?:view|perspective)\b|\bpov\s+(?:shot|view|perspective)\b|无人|没有人物|不要人物|不含人物|没有人脸|不要人脸|不露脸|背影|背面视角|第一人称视角|仅手部)/i;
const SELFIE_PATTERN = /(?:\bselfie\b|\bmirror\s+(?:selfie|photo|shot)\b|自拍|镜子自拍|对镜照)/i;
const VISIBLE_FACE_PATTERN = /(?:\bportrait\b|\bheadshot\b|\bface\b|\bfacial\b|\blooking\s+(?:at|into)\s+(?:the\s+)?camera\b|\beye\s+contact\b|\b(?:full|half)[-\s]?body\b|\bwaist[-\s]?up\b|\bupper[-\s]?body\b|肖像|人像|正脸|侧脸|脸部|面部|看向镜头|全身照|半身照|上半身)/i;
const HUMAN_SUBJECT_PATTERN = /(?:\b(?:character|woman|man|girl|boy|person|people|couple|human)\b|\b(?:she|he)\s+(?:is|sits?|stands?|lies?|walks?|holds?|wears?|looks?|smiles?|laughs?|reads?|eats?|cooks?|drinks?|takes?|poses?)\b|角色|人物|女生|男生|女人|男人|女孩|男孩|情侣|合照)/i;

/**
 * 参考图是“身份锚点”而不是每次生图的构图素材。
 * 默认保守地不上传；只有场景明确要求可见人物/脸时才返回 true。
 */
export const shouldUseCharacterImageReference = (scenePrompt: string): boolean => {
  const prompt = String(scenePrompt || '').trim();
  if (!prompt) return false;
  // selfie/对镜照本身就要求可见身份，优先于 POV 等镜头词。
  if (SELFIE_PATTERN.test(prompt)) return true;
  if (HIDDEN_FACE_PATTERN.test(prompt)) return false;
  return VISIBLE_FACE_PATTERN.test(prompt) || HUMAN_SUBJECT_PATTERN.test(prompt);
};

const applyCompositionGuard = (prompt: string, visibleCharacterRequested: boolean): string =>
  visibleCharacterRequested ? prompt : `${prompt}\n\n${NO_UNREQUESTED_PERSON_PROMPT}`;

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
  const visibleCharacterRequested = shouldUseCharacterImageReference(input.scenePrompt ?? input.prompt);
  const generationPrompt = applyCompositionGuard(input.prompt, visibleCharacterRequested);
  if (config.provider === 'pollinations-free') {
    return {
      url: buildPollinationsImageUrl(generationPrompt, input.seed),
      provider: config.provider,
      referenceUsed: false,
    };
  }
  if (!config.baseUrl || !config.model) throw new Error('请先在设置中填写生图 API 的 URL 和 Model');

  const fetchImpl = input.fetchImpl || fetch;
  const shouldAttachReference = config.useCharacterReference && visibleCharacterRequested;
  const referenceSource = shouldAttachReference ? pickCharacterImageReference(input.char) : undefined;
  let warning: string | undefined;
  if (shouldAttachReference && !referenceSource) {
    warning = '这个角色还没有可用的立绘，已按纯文字生成';
  }

  if (referenceSource) {
    try {
      const referenceBlob = await toReferenceBlob(referenceSource, fetchImpl);
      const meta = imageCallMeta(input, true, config.requestMode);
      const url = config.requestMode === 'proxy'
        ? await requestViaProxy(config, generationPrompt, referenceBlob, fetchImpl, meta)
        : await requestEdit(config, generationPrompt, referenceBlob, fetchImpl, meta);
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
      ? await requestViaProxy(config, generationPrompt, undefined, fetchImpl, imageCallMeta(input, false, config.requestMode))
      : await requestGeneration(config, generationPrompt, fetchImpl, imageCallMeta(input, false, config.requestMode)),
    provider: config.provider,
    model: config.model,
    referenceUsed: false,
    warning,
  };
}
