// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceAnalysisPanel } from '../components/finance/FinanceAnalysisPanel';
import { buildFinanceAnalysis } from './financeAnalysis';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const result = buildFinanceAnalysis([], new Map(), {
  view: 'manual', method: 'percentile', percentile: 95, from: '2026-09-01', to: '2026-09-30', currency: 'USD',
});
const render = (saving = false, method: 'iqr' | 'percentile' = 'percentile', openSettings = true) => {
  const onSettingsChange = vi.fn();
  act(() => root.render(React.createElement(FinanceAnalysisPanel, {
    from: '2026-09-01', to: '2026-09-30', result: { ...result, settings: { ...result.settings, method } }, currency: 'USD', ready: true, saving, error: null,
    onSettingsChange,
  })));
  const settingsButton = host.querySelector('[aria-label="筛选设置"]') as HTMLButtonElement;
  if (openSettings) act(() => settingsButton.click());
  return onSettingsChange;
};
function changeAndBlur(value: string) {
  const input = host.querySelector('input[type="number"]') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

describe('finance analysis controls', () => {
  it('starts with the calendar chart and keeps explanations and method controls collapsed', () => {
    render(false, 'iqr', false);
    expect(host.querySelector('svg[aria-label="每日支出柱状图"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="大额筛选方法"]')).toBeNull();
    expect(host.textContent).not.toContain('P75');
    const day = host.querySelector('g[role="button"]') as SVGGElement;
    act(() => day.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe('9/1 · 0');
  });
  it('shows IQR without percentile controls and lets the user switch methods', () => {
    const change = render(false, 'iqr');
    expect(host.querySelector('input[type="number"]')).toBeNull();
    expect(host.textContent).toContain('不固定排除多少笔');
    const method = host.querySelector('select[aria-label="大额筛选方法"]') as HTMLSelectElement;
    act(() => { method.value = 'percentile'; method.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(change).toHaveBeenCalledWith({ method: 'percentile' });
  });
  it('rejects invalid percentile without replacing the effective value, and accepts a correction', () => {
    const change = render();
    changeAndBlur('49');
    expect(change).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('仍使用 P95');
    changeAndBlur('99.5');
    expect(change).toHaveBeenCalledWith({ percentile: 99.5 });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps scope controls clickable during queued saving so blur does not swallow the next click', () => {
    const change = render(true);
    const all = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('全部'))!;
    expect(all.disabled).toBe(false);
    act(() => all.click());
    expect(change).toHaveBeenCalledWith({ view: 'all' });
  });
});
