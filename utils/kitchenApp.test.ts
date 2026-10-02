// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KitchenApp from '../apps/KitchenApp';
import { KitchenDB, type KitchenLot } from './kitchenDb';

vi.mock('../context/OSContext', () => ({ useOS: () => ({ closeApp: vi.fn() }) }));
vi.mock('../components/kitchen/KitchenFridgeScene', () => ({
  default: ({ lots, onOpenLot }: { lots: KitchenLot[]; onOpenLot: (id: string) => void }) =>
    React.createElement('div', { 'data-testid': 'scene-lots' }, lots
      .filter(lot => lot.quantity > 0 && lot.storageZone === 'fridge')
      .map(lot => React.createElement('button', { key: lot.id, onClick: () => onOpenLot(lot.id) }, `模型 ${lot.id}`))),
}));

let container: HTMLDivElement;
let root: Root;

const rows = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="查看食材"]'));
const scene = () => container.querySelector('[data-testid="scene-lots"]');
const operationSheet = () => container.querySelector('[role="dialog"][aria-label="食材操作"]');
const button = (text: string) => {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.textContent?.trim() === text);
  expect(match, `找不到按钮：${text}`).toBeDefined();
  return match!;
};
const labelled = <T extends HTMLElement>(selector: string, label: string): T => {
  const match = container.querySelector<T>(`${selector}[aria-label="${label}"]`);
  expect(match, `找不到 ${selector}：${label}`).not.toBeNull();
  return match!;
};
const click = async (element: HTMLElement) => {
  await act(async () => { element.click(); });
};
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
const activeLots = async () => (await KitchenDB.getLots()).filter(lot => lot.quantity > 0);
const mutate = async (element: HTMLElement, assertion: () => Promise<void>) => {
  await act(async () => {
    element.click();
    await vi.waitFor(assertion);
    await Promise.all([KitchenDB.getFoods(), KitchenDB.getLots(), KitchenDB.getEvents()]);
  });
};

// Flush React updates between checks as IndexedDB and lazy scene loading finish.
const waitForUI = async (assertion: () => void) => {
  await vi.waitFor(async () => {
    await act(async () => { await KitchenDB.getEvents(); });
    assertion();
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
  await waitForUI(() => expect(scene()?.querySelectorAll('button')).toHaveLength(10));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('paper kitchen flows', () => {
  it('starts with the fridge and clears/restores a whole lot from its food sheet', async () => {
    expect(rows()).toHaveLength(0);
    expect(container.querySelector('input[aria-label="搜索食材"]')).toBeNull();
    const target = scene()!.querySelector('button')!;
    const targetLabel = target.textContent!;
    target.focus();
    await click(target);
    expect(operationSheet()).not.toBeNull();

    await mutate(button('这条库存已用完'), async () => expect(await activeLots()).toHaveLength(19));
    await waitForUI(() => {
      expect(operationSheet()).toBeNull();
      expect(scene()!.querySelectorAll('button')).toHaveLength(9);
    });
    expect(await activeLots()).toHaveLength(19);
    expect(scene()!.textContent).not.toContain(targetLabel);
    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe('BUTTON');
    const cleared = (await KitchenDB.getLots()).filter(lot => lot.quantity === 0);
    expect(cleared).toHaveLength(1);

    await mutate(button('撤销'), async () => expect(await activeLots()).toHaveLength(20));
    await waitForUI(() => expect(scene()!.querySelectorAll('button')).toHaveLength(10));
    expect(await activeLots()).toHaveLength(20);
    expect(scene()!.textContent).toContain(targetLabel);
    expect((await KitchenDB.getLots()).find(lot => lot.id === cleared[0].id)?.quantity).toBe(2);
  });

  it('opens a separate inventory view and combines search with storage location', async () => {
    await click(labelled('button', '搜索食材'));
    expect(rows()).toHaveLength(20);
    expect(scene()).toBeNull();
    expect(operationSheet()).toBeNull();

    await fill(labelled('input', '搜索食材'), '食材19');
    expect(rows()).toHaveLength(1);
    await choose(labelled('select', '筛选收纳位置'), 'fridge');
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('没有找到符合条件的食材');
    await choose(labelled('select', '筛选收纳位置'), 'freezer');
    expect(rows()).toHaveLength(1);
    await click(rows()[0]);
    expect(operationSheet()?.textContent).toContain('食材19');
    expect(container.querySelectorAll('[role="dialog"][aria-label="食材操作"]')).toHaveLength(1);
  });

  it('rejects an incomplete percentage without writing and accepts a custom remaining volume', async () => {
    await click(labelled('button', '食材清单'));
    await click(labelled('button', '查看食材0'));
    const before = await KitchenDB.exportAll();

    await fill(labelled('input', '自定义剩余量'), '%');
    await click(button('保存余量'));
    expect(operationSheet()).not.toBeNull();
    expect(container.textContent).toContain('请填写分数');
    expect(await KitchenDB.exportAll()).toEqual(before);

    await fill(labelled('input', '自定义剩余量'), '700 ml');
    await mutate(button('保存余量'), async () => {
      expect((await KitchenDB.getEvents()).length).toBe(before.events.length + 1);
    });
    await waitForUI(() => expect(container.textContent).toContain('700 ml'));
    const food = before.foods.find(item => item.name === '食材0')!;
    const updated = (await KitchenDB.getLots()).find(lot => lot.foodId === food.id)!;
    expect(updated.quantity).toBe(2);
    expect(updated.packageState).toBe('opened');
    expect(updated.openContainerRemaining).toBeCloseTo(0.7);
    expect((await KitchenDB.getEvents()).length).toBe(before.events.length + 1);
  });

  it('edits package details and location through the shared food sheet', async () => {
    await click(labelled('button', '食材清单'));
    await click(labelled('button', '查看食材0'));
    const otherActions = Array.from(container.querySelectorAll('summary'))
      .find(summary => summary.textContent?.includes('收纳与其他操作'))!;
    expect(otherActions).toBeDefined();
    await click(otherActions);
    await click(button('详情与编辑'));
    expect(container.textContent).toContain('食材小档案');
    expect(container.textContent).toContain('这条库存的记录');
    const eventsBefore = await KitchenDB.getEvents();

    await fill(labelled('input', '包装规格'), '946 ml');
    await choose(labelled('select', '收纳位置'), 'pantry');
    await mutate(button('保存修改'), async () => {
      expect((await KitchenDB.getLots()).some(lot => lot.packageSize === '946 ml' && lot.storageZone === 'pantry')).toBe(true);
    });
    await waitForUI(() => expect(container.textContent).toContain('食材资料已更新'));
    const food = (await KitchenDB.getFoods()).find(item => item.name === '食材0')!;
    const updated = (await KitchenDB.getLots()).find(lot => lot.foodId === food.id)!;
    expect(updated.packageSize).toBe('946 ml');
    expect(updated.storageZone).toBe('pantry');
    expect(updated.quantity).toBe(2);
    expect(await KitchenDB.getEvents()).toEqual(eventsBefore);

    await click(labelled('button', '返回食材'));
    expect(rows()).toHaveLength(20);
  });

  it('cancels without saving and adds a food only after confirming the add sheet', async () => {
    const before = await KitchenDB.exportAll();
    await click(labelled('button', '添加食物'));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('放进食物');
    await fill(labelled('input', '食物名称'), '未确认的牛奶');
    await click(container.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="关闭"]')!);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(await KitchenDB.exportAll()).toEqual(before);

    await click(labelled('button', '添加食物'));
    await fill(labelled('input', '食物名称'), '新买的燕麦奶');
    await fill(labelled('input', '数量'), '3');
    await choose(labelled('select', '单位'), 'large_bottle');
    await choose(labelled('select', '收纳位置'), 'fridge');
    const packageDetails = Array.from(container.querySelectorAll('summary'))
      .find(summary => summary.textContent?.includes('包装与用量'))!;
    expect(packageDetails).toBeDefined();
    await click(packageDetails);
    await choose(labelled('select', '用量记录方式'), 'divisible');
    await choose(labelled('select', '单位'), 'box');
    expect(labelled<HTMLSelectElement>('select', '用量记录方式').value).toBe('divisible');
    await fill(labelled('input', '包装规格'), '1 L');
    await mutate(button('放进厨房'), async () => expect(await activeLots()).toHaveLength(21));
    await waitForUI(() => {
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(scene()!.querySelectorAll('button')).toHaveLength(11);
    });
    const food = (await KitchenDB.getFoods()).find(item => item.name === '新买的燕麦奶')!;
    expect(food).toBeDefined();
    const added = (await KitchenDB.getLots()).find(lot => lot.foodId === food.id)!;
    expect(added).toMatchObject({ quantity: 3, unit: 'box', storageZone: 'fridge', packageSize: '1 L', trackingMode: 'divisible' });
    expect(await activeLots()).toHaveLength(21);
    expect((await KitchenDB.getEvents()).length).toBe(before.events.length + 1);
  });

  it('only rereads a successful add after its screen refresh fails', async () => {
    const before = await KitchenDB.exportAll();
    await click(labelled('button', '添加食物'));
    await fill(labelled('input', '食物名称'), '刷新失败时的苹果');
    await fill(labelled('input', '数量'), '1');
    const refreshRead = vi.spyOn(KitchenDB, 'getFoods')
      .mockRejectedValueOnce(new Error('Simulated refresh failure'));

    await act(async () => {
      button('放进厨房').click();
      await vi.waitFor(async () => {
        expect(await activeLots()).toHaveLength(21);
        expect(refreshRead).toHaveBeenCalledTimes(1);
      });
      await KitchenDB.getEvents();
    });
    await waitForUI(() => {
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(container.textContent).toContain('已保存，但画面没有刷新');
    });
    expect(labelled<HTMLButtonElement>('button', '添加食物').disabled).toBe(true);
    expect(scene()).toBeNull();
    const saved = await KitchenDB.exportAll();
    expect(saved.events.filter(event => event.type === 'ADD')).toHaveLength(before.events.length + 1);
    const newFood = saved.foods.find(food => food.name === '刷新失败时的苹果')!;
    expect(saved.lots.filter(lot => lot.foodId === newFood.id)).toHaveLength(1);

    await act(async () => {
      button('重新打开').click();
      await vi.waitFor(() => expect(refreshRead).toHaveBeenCalledTimes(2));
      await KitchenDB.getEvents();
    });
    await waitForUI(() => expect(scene()?.querySelectorAll('button')).toHaveLength(11));
    expect(labelled<HTMLButtonElement>('button', '添加食物').disabled).toBe(false);
    expect(container.textContent).not.toContain('已保存，但画面没有刷新');
    expect(await KitchenDB.exportAll()).toEqual(saved);
  });
});
