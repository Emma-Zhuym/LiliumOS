import { describe, expect, it } from 'vitest';
import {
  KITCHEN_RECEIPT_AI_SCHEMA,
  KITCHEN_RECEIPT_REVIEW_THRESHOLD,
  parseKitchenReceiptRecognition,
} from './kitchenReceiptRecognition';

describe('kitchen receipt recognition contract', () => {
  it('keeps the receipt abbreviation beside a confident readable name', () => {
    const draft = parseKitchenReceiptRecognition({
      merchant: 'TARGET T-1234',
      purchasedAt: '2026-10-12',
      currency: 'usd',
      items: [{
        rawLabel: 'ORG MLK 2% 1GL',
        normalizedName: '有机 2% 牛奶',
        abbreviationMeaning: 'ORG = organic，MLK = milk，1GL = 1 gallon',
        quantity: 1,
        unit: 'large_bottle',
        packageSize: '1 gallon',
        lineTotal: 6.49,
        confidence: 0.94,
        alternatives: [],
      }],
    });

    expect(draft).toMatchObject({ merchant: 'TARGET T-1234', purchasedAt: '2026-10-12', currency: 'USD' });
    expect(draft.items[0]).toMatchObject({
      rawLabel: 'ORG MLK 2% 1GL',
      normalizedName: '有机 2% 牛奶',
      confidence: 0.94,
      needsReview: false,
      reviewReasons: [],
    });
  });

  it('marks an ambiguous abbreviation for review and preserves alternatives', () => {
    const draft = parseKitchenReceiptRecognition({
      items: [{
        rawLabel: 'GRN ON 2LB',
        normalizedName: '青葱',
        abbreviationMeaning: '可能是 green onion',
        quantity: 2,
        unit: 'bag',
        packageSize: '2 lb',
        lineTotal: 3.98,
        confidence: 42,
        alternatives: [
          { name: '黄洋葱', abbreviationMeaning: '也可能是 generic onion' },
          { name: '青葱', abbreviationMeaning: null },
        ],
      }],
    });

    expect(draft.items[0].confidence).toBe(0.42);
    expect(draft.items[0].alternatives).toEqual([{ name: '黄洋葱', abbreviationMeaning: '也可能是 generic onion' }]);
    expect(draft.items[0].reviewReasons).toEqual(['low_confidence', 'ambiguous_abbreviation']);
    expect(draft.items[0].needsReview).toBe(true);
  });

  it('never silently invents quantity, unit, or product name', () => {
    const draft = parseKitchenReceiptRecognition({
      items: [{ rawLabel: 'MKT ITEM', confidence: 0.99 }],
    });
    expect(draft.items[0]).toMatchObject({
      normalizedName: null,
      quantity: null,
      unit: null,
      needsReview: true,
      reviewReasons: ['missing_name', 'missing_quantity', 'unknown_unit'],
    });
  });

  it('drops lines without receipt evidence and reports malformed metadata', () => {
    const draft = parseKitchenReceiptRecognition({
      purchasedAt: '10/12/26',
      currency: '$',
      items: [{ normalizedName: '牛奶' }, null, { rawLabel: ' EGGS   LRG ', quantity: -1, unit: 'dozen', confidence: -2 }],
    });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0].rawLabel).toBe('EGGS LRG');
    expect(draft.items[0].reviewReasons).toEqual(['missing_name', 'missing_quantity', 'unknown_unit', 'low_confidence']);
    expect(draft.warnings).toEqual([
      '有商品行缺少小票原文，已留待重新识别',
      '购买日期格式无法确认',
      '币种格式无法确认',
    ]);
  });

  it('publishes a strict schema with nullable unknowns and a visible confidence gate', () => {
    expect(KITCHEN_RECEIPT_REVIEW_THRESHOLD).toBeGreaterThan(0.8);
    expect(KITCHEN_RECEIPT_AI_SCHEMA.additionalProperties).toBe(false);
    expect(KITCHEN_RECEIPT_AI_SCHEMA.properties.items.items.required).toContain('rawLabel');
    expect(KITCHEN_RECEIPT_AI_SCHEMA.properties.items.items.required).toContain('abbreviationMeaning');
    expect(KITCHEN_RECEIPT_AI_SCHEMA.properties.items.items.properties.unit.enum).toContain(null);
  });
});
