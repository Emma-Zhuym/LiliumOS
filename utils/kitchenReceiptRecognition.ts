import type { KitchenUnit } from './kitchenDb';

/** AI 结果低于这个值，或存在多个候选时，必须让阿萌确认后才能入库。 */
export const KITCHEN_RECEIPT_REVIEW_THRESHOLD = 0.82;

export const KITCHEN_RECEIPT_UNITS: readonly KitchenUnit[] = [
  'piece', 'pack', 'bag', 'box', 'tray', 'can',
  'large_bottle', 'small_bottle', 'portion', 'gram', 'milliliter',
];

export type KitchenReceiptReviewReason =
  | 'missing_name'
  | 'missing_quantity'
  | 'unknown_unit'
  | 'low_confidence'
  | 'ambiguous_abbreviation';

export interface KitchenReceiptAlternative {
  name: string;
  abbreviationMeaning?: string;
}

/**
 * 一行识别草稿。rawLabel 永远保留小票原文；normalizedName 只是 AI 建议，不能覆盖原文。
 * 这一层不写库存，必须经过确认页后才转换成 AddKitchenLotInput。
 */
export interface KitchenReceiptLineDraft {
  rawLabel: string;
  normalizedName: string | null;
  abbreviationMeaning: string | null;
  quantity: number | null;
  unit: KitchenUnit | null;
  packageSize: string | null;
  lineTotal: number | null;
  confidence: number;
  alternatives: KitchenReceiptAlternative[];
  needsReview: boolean;
  reviewReasons: KitchenReceiptReviewReason[];
}

export interface KitchenReceiptDraft {
  merchant: string | null;
  purchasedAt: string | null;
  currency: string | null;
  items: KitchenReceiptLineDraft[];
  warnings: string[];
}

/** 给支持 structured output 的视觉模型用；所有可能缺失的值都显式返回 null，禁止模型擅自补默认值。 */
export const KITCHEN_RECEIPT_AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['merchant', 'purchasedAt', 'currency', 'items'],
  properties: {
    merchant: { type: ['string', 'null'] },
    purchasedAt: { type: ['string', 'null'], description: 'YYYY-MM-DD；看不清就 null' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 三字母；看不清就 null' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'rawLabel', 'normalizedName', 'abbreviationMeaning', 'quantity', 'unit',
          'packageSize', 'lineTotal', 'confidence', 'alternatives',
        ],
        properties: {
          rawLabel: { type: 'string', description: '逐字保留小票上的商品缩写' },
          normalizedName: { type: ['string', 'null'], description: '可读商品名；不确定就 null' },
          abbreviationMeaning: { type: ['string', 'null'], description: '缩写如何展开；不是缩写则 null' },
          quantity: { type: ['number', 'null'], description: '商品数量；不能从小票确认就 null' },
          unit: { type: ['string', 'null'], enum: [...KITCHEN_RECEIPT_UNITS, null] },
          packageSize: { type: ['string', 'null'] },
          lineTotal: { type: ['number', 'null'], description: '这一行实付金额，不含整单税费' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          alternatives: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'abbreviationMeaning'],
              properties: {
                name: { type: 'string' },
                abbreviationMeaning: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    },
  },
} as const;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
};

const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const nonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const confidence = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  // 有些模型会回 92 而不是 0.92；只容忍明确的百分数范围。
  if (value > 1 && value <= 100) return value / 100;
  return Math.min(1, Math.max(0, value));
};

const unit = (value: unknown): KitchenUnit | null =>
  typeof value === 'string' && (KITCHEN_RECEIPT_UNITS as readonly string[]).includes(value)
    ? value as KitchenUnit
    : null;

const alternatives = (value: unknown, normalizedName: string | null): KitchenReceiptAlternative[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set(normalizedName ? [normalizedName.toLocaleLowerCase()] : []);
  const result: KitchenReceiptAlternative[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const source = candidate as Record<string, unknown>;
    const name = text(source.name, 100);
    if (!name || seen.has(name.toLocaleLowerCase())) continue;
    seen.add(name.toLocaleLowerCase());
    const meaning = text(source.abbreviationMeaning, 160);
    result.push({ name, ...(meaning ? { abbreviationMeaning: meaning } : {}) });
    if (result.length === 3) break;
  }
  return result;
};

const parseLine = (value: unknown): KitchenReceiptLineDraft | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const rawLabel = text(source.rawLabel, 120);
  if (!rawLabel) return null;

  const normalizedName = text(source.normalizedName, 100);
  const abbreviationMeaning = text(source.abbreviationMeaning, 160);
  const parsedQuantity = positive(source.quantity);
  const parsedUnit = unit(source.unit);
  const parsedConfidence = confidence(source.confidence);
  const parsedAlternatives = alternatives(source.alternatives, normalizedName);
  const reviewReasons: KitchenReceiptReviewReason[] = [];
  if (!normalizedName) reviewReasons.push('missing_name');
  if (parsedQuantity === null) reviewReasons.push('missing_quantity');
  if (parsedUnit === null) reviewReasons.push('unknown_unit');
  if (parsedConfidence < KITCHEN_RECEIPT_REVIEW_THRESHOLD) reviewReasons.push('low_confidence');
  if (parsedAlternatives.length > 0) reviewReasons.push('ambiguous_abbreviation');

  return {
    rawLabel,
    normalizedName,
    abbreviationMeaning,
    quantity: parsedQuantity,
    unit: parsedUnit,
    packageSize: text(source.packageSize, 80),
    lineTotal: nonNegative(source.lineTotal),
    confidence: parsedConfidence,
    alternatives: parsedAlternatives,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
};

/** 把不可信的模型 JSON 收成可审阅草稿；本函数不会填 1 件、pack 等默认值，也不会写库存。 */
export const parseKitchenReceiptRecognition = (value: unknown): KitchenReceiptDraft => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const warnings: string[] = [];
  const rawItems = Array.isArray(source.items) ? source.items : [];
  if (!Array.isArray(source.items)) warnings.push('识别结果没有商品列表');
  const items = rawItems.map(parseLine).filter((item): item is KitchenReceiptLineDraft => item !== null);
  if (items.length !== rawItems.length) warnings.push('有商品行缺少小票原文，已留待重新识别');

  const rawDate = text(source.purchasedAt, 20);
  const purchasedAt = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  if (rawDate && !purchasedAt) warnings.push('购买日期格式无法确认');
  const rawCurrency = text(source.currency, 8)?.toUpperCase() ?? null;
  const currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
  if (rawCurrency && !currency) warnings.push('币种格式无法确认');

  return {
    merchant: text(source.merchant, 100),
    purchasedAt,
    currency,
    items,
    warnings,
  };
};
