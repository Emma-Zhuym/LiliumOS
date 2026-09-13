// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KitchenApp from '../apps/KitchenApp';
import { KitchenDB } from './kitchenDb';

vi.mock('../context/OSContext', () => ({ useOS: () => ({ closeApp: vi.fn() }) }));

let container: HTMLDivElement;
let root: Root;
const rows = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'));
const waitForRows = async (count: number, action?: () => void) => {
  await act(async () => {
    action?.();
    await vi.waitFor(async () => {
      expect((await KitchenDB.getLots()).filter(lot => lot.quantity > 0)).toHaveLength(count);
    });
    await KitchenDB.getEvents();
  });
  expect(rows()).toHaveLength(count);
};
const button = (text: string) => Array.from(container.querySelectorAll('button'))
  .find(item => item.textContent?.trim() === text)!;
const fill = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const choose = async (select: HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await KitchenDB.importAll({ foods: [], lots: [], events: [] });
  for (let index = 0; index < 20; index++) {
    await KitchenDB.addLot({
      name: `食材${index}`, quantity: 2, unit: 'large_bottle', packageSize: '1 L',
      trackingMode: 'divisible', storageZone: index % 2 ? 'freezer' : 'fridge',
    });
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(KitchenApp)); });
  await waitForRows(20);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('compact kitchen inventory', () => {
  it('keeps 20 foods collapsed, opens only one, and combines search with location', async () => {
    expect(rows()).toHaveLength(20);
    expect(button('吃了一些')).toBeUndefined();
    await act(async () => rows()[0].click());
    await act(async () => rows()[1].click());
    expect(container.querySelectorAll('[aria-expanded="true"]')).toHaveLength(1);
    await fill(container.querySelector('[aria-label="搜索食材"]')!, '食材19');
    expect(rows()).toHaveLength(1);
    expect(button('吃了一些')).toBeUndefined();
    await act(async () => button('冷藏10').click());
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('没有找到符合条件的食材');
    await act(async () => button('冷冻10').click());
    expect(rows()).toHaveLength(1);
  });

  it('rejects incomplete percentages and clears/restores the selected multi-package lot', async () => {
    const selectedName = rows()[0].textContent!;
    await act(async () => rows()[0].click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="核对余量"]')!.click());
    await fill(container.querySelector('[aria-label="自定义剩余量"]')!, '%');
    await act(async () => button('保存').click());
    expect(rows()).toHaveLength(20);
    expect((await KitchenDB.getLots()).every(lot => lot.quantity === 2)).toBe(true);
    expect(container.textContent).toContain('请填写分数');
    await waitForRows(19, () => button('这条库存已用完').click());
    expect((await KitchenDB.getLots()).filter(lot => lot.quantity === 0)).toHaveLength(1);
    await waitForRows(20, () => button('撤销最近操作').click());
    expect(rows()[0].textContent).toBe(selectedName);
  });

  it('opens a lot detail page and saves its package specification and location', async () => {
    await act(async () => rows()[0].click());
    await act(async () => button('详情与编辑').click());
    expect(container.textContent).toContain('食材详情');
    expect(container.textContent).toContain('这条库存的记录');

    await fill(container.querySelector('[aria-label="包装规格"]')!, '946 ml');
    await choose(container.querySelector('[aria-label="收纳位置"]')!, 'pantry');
    await act(async () => button('保存修改').click());
    await act(async () => {
      await vi.waitFor(async () => {
        expect((await KitchenDB.getLots()).some(lot => lot.packageSize === '946 ml' && lot.storageZone === 'pantry')).toBe(true);
      });
    });
    expect(container.textContent).toContain('食材资料已更新');

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="返回食材列表"]')!.click());
    expect(rows()).toHaveLength(20);
  });
});
