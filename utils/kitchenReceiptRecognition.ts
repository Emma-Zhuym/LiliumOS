import type { KitchenStorageZone, KitchenUnit } from './kitchenDb';

/** AI 结果低于这个值，或缩写有几种解释时，核对单上把这一行标出来。 */
export const KITCHEN_RECEIPT_REVIEW_THRESHOLD = 0.82;

/**
 * 单位按小票上的来（阿萌 2026-10-13 定）：数的就是「件」，称重的照写磅 / 盎司，不换算。
 * 包装多大（1 gal、18 ct、12 oz）是 packageSize，不是单位。
 */
export const KITCHEN_RECEIPT_UNITS = ['item', 'lb', 'oz'] as const satisfies readonly KitchenUnit[];
export type KitchenReceiptUnit = typeof KITCHEN_RECEIPT_UNITS[number];
export const KITCHEN_RECEIPT_ZONES = ['fridge', 'freezer', 'pantry'] as const satisfies readonly KitchenStorageZone[];
export type KitchenReceiptZone = typeof KITCHEN_RECEIPT_ZONES[number];

export type KitchenReceiptReviewReason =
  | 'missing_name'
  | 'missing_quantity'
  | 'unknown_unit'
  | 'low_confidence'
  | 'ambiguous_abbreviation';

export const REVIEW_REASON_LABELS: Record<KitchenReceiptReviewReason, string> = {
  missing_name: '没认出是什么',
  missing_quantity: '称重的没看清多重',
  unknown_unit: '不确定是件数还是重量',
  low_confidence: '不太确定',
  ambiguous_abbreviation: '缩写有几种解释',
};

export interface KitchenReceiptAlternative {
  name: string;
  abbreviationMeaning?: string;
}

/**
 * 一行识别草稿。rawLabel 永远保留小票原文；name 是 AI 给的中文常用名，只是建议。
 * 这一层不写库存，必须经过核对单才放进厨房。
 */
export interface KitchenReceiptLineDraft {
  rawLabel: string;
  /** 中文常用名（去掉品牌和营销词）；认不出就是 null */
  name: string | null;
  abbreviationMeaning: string | null;
  /** 没写数量的普通商品按 1 件；称重的没看清才是 null */
  quantity: number | null;
  unit: KitchenReceiptUnit;
  packageSize: string | null;
  lineTotal: number | null;
  /** AI 建议放哪；null = 它也说不准，核对单默认放冷藏 */
  storageZone: KitchenReceiptZone | null;
  /** 买回来大概能放几天（按建议的位置）；null = 不估 */
  shelfLifeDays: number | null;
  /** 纸巾、洗洁精这类不是吃的：核对单默认不勾 */
  isFood: boolean;
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

/** 模型可能写 ea / each / ct / lbs / pound；认不出的当件数，交给核对单 */
const unitOf = (value: unknown): KitchenReceiptUnit | null => {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (/^(item|ea|each|ct|count|pc|pcs|件)$/.test(key)) return 'item';
  if (/^(lb|lbs|pound|pounds|磅)$/.test(key)) return 'lb';
  if (/^(oz|ounce|ounces|盎司)$/.test(key)) return 'oz';
  return null;
};

const zoneOf = (value: unknown): KitchenReceiptZone | null =>
  typeof value === 'string' && (KITCHEN_RECEIPT_ZONES as readonly string[]).includes(value) ? value as KitchenReceiptZone : null;

const alternatives = (value: unknown, name: string | null): KitchenReceiptAlternative[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set(name ? [name.toLocaleLowerCase()] : []);
  const result: KitchenReceiptAlternative[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const source = candidate as Record<string, unknown>;
    const altName = text(source.name, 100);
    if (!altName || seen.has(altName.toLocaleLowerCase())) continue;
    seen.add(altName.toLocaleLowerCase());
    const meaning = text(source.abbreviationMeaning, 160);
    result.push({ name: altName, ...(meaning ? { abbreviationMeaning: meaning } : {}) });
    if (result.length === 3) break;
  }
  return result;
};

const parseLine = (value: unknown): KitchenReceiptLineDraft | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const rawLabel = text(source.rawLabel, 120);
  if (!rawLabel) return null;

  // 旧字段名 normalizedName 也认（早先的提示词这么叫）
  const name = text(source.name ?? source.normalizedName, 100);
  const parsedUnit = unitOf(source.unit);
  const unit = parsedUnit ?? 'item';
  // 小票上一样东西一行、不写数量：就是 1 件。称重的必须看见重量
  const quantity = positive(source.quantity) ?? (unit === 'item' ? 1 : null);
  const parsedConfidence = confidence(source.confidence);
  const parsedAlternatives = alternatives(source.alternatives, name);
  const shelf = positive(source.shelfLifeDays);
  const reviewReasons: KitchenReceiptReviewReason[] = [];
  if (!name) reviewReasons.push('missing_name');
  if (quantity === null) reviewReasons.push('missing_quantity');
  if (!parsedUnit && quantity !== null && !Number.isInteger(quantity)) reviewReasons.push('unknown_unit');
  if (parsedConfidence < KITCHEN_RECEIPT_REVIEW_THRESHOLD) reviewReasons.push('low_confidence');
  if (parsedAlternatives.length > 0) reviewReasons.push('ambiguous_abbreviation');

  return {
    rawLabel,
    name,
    abbreviationMeaning: text(source.abbreviationMeaning, 160),
    quantity,
    unit,
    packageSize: text(source.packageSize, 80),
    lineTotal: nonNegative(source.lineTotal),
    storageZone: zoneOf(source.storageZone),
    shelfLifeDays: shelf === null ? null : Math.min(3650, Math.round(shelf)),
    isFood: source.isFood !== false,
    confidence: parsedConfidence,
    alternatives: parsedAlternatives,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
};

/** 把不可信的模型 JSON 收成可审阅草稿；不会写库存。 */
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

/** 保质期：从购买那天往后数；没有购买日期就从今天数 */
export const expiryFrom = (purchasedAt: string | null, days: number | null, today = new Date()): string => {
  if (!days) return '';
  const base = purchasedAt ? new Date(`${purchasedAt}T12:00:00`) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
};
