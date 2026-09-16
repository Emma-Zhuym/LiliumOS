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
  view: 'manual', percentile: 95, from: '2026-09-01', to: '2026-09-30', currency: 'USD',
});
const render = (saving = false) => {
  const onSettingsChange = vi.fn();
  act(() => root.render(React.createElement(FinanceAnalysisPanel, {
    result, currency: 'USD', ready: true, saving, error: null,
    onSettingsChange, onTreatmentChange: vi.fn(),
  })));
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
    const all = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('全部支出'))!;
    expect(all.disabled).toBe(false);
    act(() => all.click());
    expect(change).toHaveBeenCalledWith({ view: 'all' });
  });
});
