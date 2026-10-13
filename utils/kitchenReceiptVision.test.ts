import { describe, expect, it, vi } from 'vitest';
import type { VisionApiConfig } from '../types';
import { KITCHEN_RECEIPT_VISION_PROMPT, recognizeKitchenReceipt } from './kitchenReceiptVision';

const config: VisionApiConfig = {
  enabled: true,
  baseUrl: 'https://vision.example.test/v1/',
  apiKey: 'secret-for-test',
  model: 'vision-test',
};

const completion = (content: string) => ({ choices: [{ message: { content } }] });

describe('kitchen receipt vision request', () => {
  it('sends the image once with a strict schema and returns a review draft', async () => {
    const request = vi.fn(async () => completion(JSON.stringify({
      merchant: 'ALDI', purchasedAt: '2026-10-12', currency: 'USD',
      items: [{
        rawLabel: 'ORG BNNA', normalizedName: '有机香蕉', abbreviationMeaning: 'ORG = organic，BNNA = banana',
        quantity: 6, unit: 'piece', packageSize: null, lineTotal: 2.19, confidence: 0.91, alternatives: [],
      }],
    })));

    const draft = await recognizeKitchenReceipt('data:image/jpeg;base64,abc', config, request);
    expect(draft.items[0]).toMatchObject({ rawLabel: 'ORG BNNA', normalizedName: '有机香蕉', needsReview: false });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    const body = JSON.parse(String(options.body));
    expect(url).toBe('https://vision.example.test/v1/chat/completions');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,abc');
    expect(body.messages[0].content[0].text).toContain('禁止默认成 1');
  });

  it('accepts fenced JSON from providers that ignore structured output', async () => {
    const request = vi.fn(async () => completion('好的：\n```json\n{"merchant":null,"purchasedAt":null,"currency":null,"items":[{"rawLabel":"MLK","normalizedName":"牛奶","abbreviationMeaning":"milk","quantity":null,"unit":null,"packageSize":null,"lineTotal":null,"confidence":0.7,"alternatives":[]}]}\n```'));
    const draft = await recognizeKitchenReceipt('https://img.example.test/receipt.jpg', config, request);
    expect(draft.items[0].needsReview).toBe(true);
    expect(draft.items[0].reviewReasons).toEqual(['missing_quantity', 'unknown_unit', 'low_confidence']);
  });

  it('rejects missing settings, unusable images, malformed output, and empty receipts', async () => {
    const never = vi.fn(async () => completion('{}'));
    await expect(recognizeKitchenReceipt('data:image/jpeg;base64,x', { ...config, apiKey: '' }, never)).rejects.toThrow('尚未配置完整');
    await expect(recognizeKitchenReceipt('plain text', config, never)).rejects.toThrow('图片数据不可用');
    expect(never).not.toHaveBeenCalled();

    await expect(recognizeKitchenReceipt('data:image/jpeg;base64,x', config, async () => completion('not json')))
      .rejects.toThrow('可解析的小票 JSON');
    await expect(recognizeKitchenReceipt('data:image/jpeg;base64,x', config, async () => completion('{"items":[]}')))
      .rejects.toThrow('没有从小票里识别出商品');
  });

  it('keeps the prompt focused on evidence and abbreviation uncertainty', () => {
    expect(KITCHEN_RECEIPT_VISION_PROMPT).toContain('rawLabel 必须逐字保留');
    expect(KITCHEN_RECEIPT_VISION_PROMPT).toContain('其他解释放进 alternatives');
    expect(KITCHEN_RECEIPT_VISION_PROMPT).toContain('折扣、税、小计、付款方式不是商品');
  });
});
