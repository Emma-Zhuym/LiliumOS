import type { VisionApiConfig } from '../types';
import { isBlobRef } from './blobRef';
import { extractContent, safeFetchJson } from './safeApi';
import { isVisionApiReady } from './visionApi';
import {
  KITCHEN_RECEIPT_UNITS,
  KITCHEN_RECEIPT_ZONES,
  parseKitchenReceiptRecognition,
  type KitchenReceiptDraft,
} from './kitchenReceiptRecognition';

type ReceiptRequest = (url: string, options: RequestInit) => Promise<unknown>;

export const KITCHEN_RECEIPT_VISION_PROMPT = `你在读一张超市或杂货店小票（多半是美国的，商品名是英文缩写）。目标是做一份让用户核对后放进家里厨房库存的草稿。

逐行处理商品：
1. rawLabel 逐字保留小票上的商品缩写，不翻译、不改写。
2. name 写中文常用名：用户平时会怎么叫它就怎么写（「有机鸡蛋」「全脂牛奶」「香蕉」），去掉品牌和营销词，规格不要写进名字。认不出就写 null。
3. abbreviationMeaning 用一句话说缩写怎么展开（如 KS ORG LG EGGS = Kirkland Signature organic large eggs）；不是缩写就写 null。
4. 缩写有几种合理解释时，其他解释放进 alternatives（最多 3 个，name 同样写中文），并降低 confidence。
5. quantity 和 unit 照小票写：
   - 按件卖的 unit 写 "item"，quantity 是件数；小票这一行没写数量就是 1。
   - 称重卖的（如 "1.23 lb @ 2.99/lb"）unit 写 "lb" 或 "oz"，quantity 写重量，照小票的单位，不换算。看不清重量就写 null。
   - unit 只能是：${KITCHEN_RECEIPT_UNITS.join(' / ')}。
6. packageSize 写包装规格，照小票原样（如 "1 gal"、"18 ct"、"12 oz"）；没有就 null。
7. storageZone：买回家放哪，只能是 ${KITCHEN_RECEIPT_ZONES.join(' / ')}（冷藏 / 冷冻 / 常温柜）。冷冻食品写 freezer；零食饮料、罐头、干货写 pantry；说不准写 null。
8. shelfLifeDays：放在这个位置大概能放几天（整数，按常识估）；说不准写 null。
9. isFood：吃的喝的写 true；纸巾、洗洁精、日用品写 false。
10. lineTotal 写这一行实付金额（不含整单税），看不清写 null。
11. confidence 是这一整行「是什么东西 + 缩写解释」的把握，0 到 1。
12. 折扣、税、小计、袋子费、付款方式、会员信息都不是商品，不放进 items。

小票整体：merchant 店名，purchasedAt 购买日期写 YYYY-MM-DD（看不清 null），currency 写三字母币种（如 USD，看不清 null）。

如果给了好几张照片：可能是一张长小票分几段拍的（相邻两张会有重叠，重叠的那几行只算一次），也可能是几张不同的小票（每张的商品都列出来，merchant 和 purchasedAt 写最近那张的）。

只返回一个 JSON 对象，不要 Markdown，不要解释：
{"merchant":…,"purchasedAt":…,"currency":…,"items":[{"rawLabel":…,"name":…,"abbreviationMeaning":…,"quantity":…,"unit":…,"packageSize":…,"storageZone":…,"shelfLifeDays":…,"isFood":…,"lineTotal":…,"confidence":…,"alternatives":[{"name":…,"abbreviationMeaning":…}]}]}`;

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

/** 一次最多带几张照片（长小票分段拍、几张小票一起） */
export const KITCHEN_RECEIPT_MAX_PHOTOS = 6;

/**
 * 一次（一张或几张照片）只调用一次视觉模型，得到可审阅草稿；不自动重试，也不写库存。
 * request 参数只供单测注入，产品路径使用 safeFetchJson 的既有超时与 API 记账。
 */
export async function recognizeKitchenReceipt(
  image: string | string[],
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
  const images = (Array.isArray(image) ? image : [image]).slice(0, KITCHEN_RECEIPT_MAX_PHOTOS);
  if (!images.length || !images.every(canReadReceiptImage)) throw new Error('小票图片数据不可用');

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
          ...images.map(url => ({ type: 'image_url', image_url: { url } })),
        ],
      }],
      // 宽松的 JSON 模式：不支持的服务商会忽略这个字段（严格 json_schema 在很多中转站和 Claude / Gemini 兼容接口上直接 400）
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: images.length > 1 ? 8000 : 4000,
      stream: false,
    }),
  });

  const content = extractContent(data);
  if (!content.trim()) throw new Error('识图模型没有返回小票内容');
  const draft = parseKitchenReceiptRecognition(parseJsonObject(content));
  if (draft.items.length === 0) throw new Error('没有从小票里识别出商品，请换一张更清楚的照片');
  return draft;
}
