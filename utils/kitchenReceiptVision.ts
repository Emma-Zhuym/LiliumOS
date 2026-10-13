import type { VisionApiConfig } from '../types';
import { isBlobRef } from './blobRef';
import { extractContent, safeFetchJson } from './safeApi';
import { isVisionApiReady } from './visionApi';
import {
  KITCHEN_RECEIPT_AI_SCHEMA,
  KITCHEN_RECEIPT_UNITS,
  parseKitchenReceiptRecognition,
  type KitchenReceiptDraft,
} from './kitchenReceiptRecognition';

type ReceiptRequest = (url: string, options: RequestInit) => Promise<unknown>;

export const KITCHEN_RECEIPT_VISION_PROMPT = `你在读取一张超市或杂货店小票。目标是做一份让用户确认的库存草稿，不是猜得像就算。

逐行处理商品：
1. rawLabel 必须逐字保留小票上的商品缩写，不翻译、不改写。
2. normalizedName 写普通人能读懂的商品名；无法可靠判断就写 null。
3. abbreviationMeaning 解释缩写如何展开；不是缩写就写 null。
4. 缩写有多个合理解释时，把其他解释放进 alternatives，最多 3 个，并降低 confidence。
5. quantity、包装规格、金额只按小票证据填写；看不清就写 null，禁止默认成 1。
6. unit 只能从以下值选择；无法判断就写 null：${KITCHEN_RECEIPT_UNITS.join(', ')}。
7. confidence 是这一整行“商品身份 + 缩写解释”的把握，范围 0 到 1。
8. 折扣、税、小计、付款方式不是商品，不放进 items。

只返回符合 schema 的 JSON，不要 Markdown，不要解释。`;

const canReadReceiptImage = (value: unknown): value is string =>
  typeof value === 'string'
  && (/^(data:image\/|https?:\/\/)/i.test(value) || isBlobRef(value));

const parseJsonObject = (raw: string): unknown => {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [trimmed, fenced].filter((value): value is string => Boolean(value));
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* 尝试下一个边界 */ }
  }
  throw new Error('识图模型没有返回可解析的小票 JSON');
};

/**
 * 一张图只调用一次视觉模型，得到可审阅草稿；不自动重试，也不写库存。
 * request 参数只供单测注入，产品路径使用 safeFetchJson 的既有超时与 API 记账。
 */
export async function recognizeKitchenReceipt(
  imageUrl: string,
  config: VisionApiConfig,
  request: ReceiptRequest = (url, options) => safeFetchJson(
    url,
    options,
    0,
    60_000,
    { appName: '厨房', purpose: '小票识图' },
  ),
): Promise<KitchenReceiptDraft> {
  if (!isVisionApiReady(config)) throw new Error('识图 API 尚未配置完整');
  if (!canReadReceiptImage(imageUrl)) throw new Error('小票图片数据不可用');

  const base = config.baseUrl.trim().replace(/\/+$/, '');
  const data = await request(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model.trim(),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: KITCHEN_RECEIPT_VISION_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'kitchen_receipt', strict: true, schema: KITCHEN_RECEIPT_AI_SCHEMA },
      },
      temperature: 0,
      max_tokens: 3000,
      stream: false,
    }),
  });

  const content = extractContent(data);
  if (!content.trim()) throw new Error('识图模型没有返回小票内容');
  const draft = parseKitchenReceiptRecognition(parseJsonObject(content));
  if (draft.items.length === 0) throw new Error('没有从小票里识别出商品，请换一张更清楚的照片');
  return draft;
}
