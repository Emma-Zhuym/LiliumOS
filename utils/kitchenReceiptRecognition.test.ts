import { describe, expect, it } from 'vitest';
import { expiryFrom, KITCHEN_RECEIPT_REVIEW_THRESHOLD, parseKitchenReceiptRecognition } from './kitchenReceiptRecognition';

describe('小票识别草稿', () => {
  it('小票原文和中文名并排留着；放哪、能放几天照 AI 建议', () => {
    const draft = parseKitchenReceiptRecognition({
      merchant: 'TARGET T-1234', purchasedAt: '2026-10-12', currency: 'usd',
      items: [{
        rawLabel: 'ORG MLK 2% 1GL', name: '低脂有机牛奶', abbreviationMeaning: 'ORG = organic，MLK = milk，1GL = 1 gallon',
        quantity: 1, unit: 'item', packageSize: '1 gal', storageZone: 'fridge', shelfLifeDays: 10, isFood: true,
        lineTotal: 6.49, confidence: 0.94, alternatives: [],
      }],
    });
    expect(draft).toMatchObject({ merchant: 'TARGET T-1234', purchasedAt: '2026-10-12', currency: 'USD' });
    expect(draft.items[0]).toMatchObject({
      rawLabel: 'ORG MLK 2% 1GL', name: '低脂有机牛奶', unit: 'item', packageSize: '1 gal',
      storageZone: 'fridge', shelfLifeDays: 10, isFood: true, needsReview: false, reviewReasons: [],
    });
  });

  it('没写数量的按 1 件；称重的照小票用磅，没看清重量才要确认', () => {
    const draft = parseKitchenReceiptRecognition({
      items: [
        { rawLabel: 'BANANAS', name: '香蕉', confidence: 0.95 },
        { rawLabel: 'GRND BEEF 1.23 LB', name: '牛肉末', quantity: 1.23, unit: 'lbs', confidence: 0.9 },
        { rawLabel: 'APPLES GALA', name: '嘎啦苹果', unit: 'lb', confidence: 0.9 },
      ],
    });
    expect(draft.items[0]).toMatchObject({ quantity: 1, unit: 'item', needsReview: false });
    expect(draft.items[1]).toMatchObject({ quantity: 1.23, unit: 'lb', needsReview: false });
    expect(draft.items[2]).toMatchObject({ quantity: null, unit: 'lb', reviewReasons: ['missing_quantity'] });
  });

  it('缩写有几种解释：留着候选、标出来让人看一眼', () => {
    const draft = parseKitchenReceiptRecognition({
      items: [{
        rawLabel: 'GRN ON', name: '小葱', quantity: 2, unit: 'ea', confidence: 42,
        alternatives: [{ name: '洋葱', abbreviationMeaning: '也可能是 generic onion' }, { name: '小葱', abbreviationMeaning: null }],
      }],
    });
    expect(draft.items[0].confidence).toBe(0.42);
    expect(draft.items[0].unit).toBe('item');
    expect(draft.items[0].alternatives).toEqual([{ name: '洋葱', abbreviationMeaning: '也可能是 generic onion' }]);
    expect(draft.items[0].reviewReasons).toEqual(['low_confidence', 'ambiguous_abbreviation']);
  });

  it('认不出名字不编；不是吃的照实标；乱写的位置不认', () => {
    const draft = parseKitchenReceiptRecognition({
      items: [{ rawLabel: 'MKT ITEM', confidence: 0.99, storageZone: 'garage' }, { rawLabel: 'BOUNTY 6RL', name: '厨房纸', isFood: false, confidence: 0.9 }],
    });
    expect(draft.items[0]).toMatchObject({ name: null, quantity: 1, storageZone: null, reviewReasons: ['missing_name'] });
    expect(draft.items[1].isFood).toBe(false);
  });

  it('没有小票原文的行丢掉，日期币种格式不对就报出来', () => {
    const draft = parseKitchenReceiptRecognition({
      purchasedAt: '10/12/26', currency: '$',
      items: [{ name: '牛奶' }, null, { rawLabel: ' EGGS   LRG ', normalizedName: '鸡蛋', quantity: -1, unit: 'dozen', confidence: -2 }],
    });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ rawLabel: 'EGGS LRG', name: '鸡蛋', quantity: 1, unit: 'item', reviewReasons: ['low_confidence'] });
    expect(draft.warnings).toEqual(['有商品行缺少小票原文，已留待重新识别', '购买日期格式无法确认', '币种格式无法确认']);
    expect(KITCHEN_RECEIPT_REVIEW_THRESHOLD).toBeGreaterThan(0.8);
  });

  it('保质期从购买那天往后数', () => {
    expect(expiryFrom('2026-10-12', 10)).toBe('2026-10-22');
    expect(expiryFrom(null, 3, new Date(2026, 9, 30))).toBe('2026-11-02');
    expect(expiryFrom('2026-10-12', null)).toBe('');
  });
});
