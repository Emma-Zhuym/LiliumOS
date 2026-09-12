// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import AmsgCronControl from '../components/settings/AmsgCronControl';
import { ActiveMsgClient } from './activeMsgClient';

vi.mock('./activeMsgClient', () => ({ ActiveMsgClient: { getCronTriggerState: vi.fn(), setCronTriggerEnabled: vi.fn() } }));
let root: Root, container: HTMLDivElement;
const needs = vi.fn(), busy = vi.fn(), notify = vi.fn();
beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    vi.mocked(ActiveMsgClient.getCronTriggerState).mockResolvedValue({ supported: true, enabled: true });
    vi.mocked(ActiveMsgClient.setCronTriggerEnabled).mockResolvedValue({ ok: true, message: '已暂停' });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async (key = 'worker-a', disabled = false) => { await act(async () => root.render(React.createElement(AmsgCronControl, { refreshKey: key, disabled, onNeedsCredentials: needs, onBusyChange: busy, notify }))); };
const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === text)!;

describe('background task pause control', () => {
    it('only pauses after confirmation, then offers resume', async () => {
        await render(); expect(ActiveMsgClient.setCronTriggerEnabled).not.toHaveBeenCalled();
        act(() => button('暂停后台任务').click());
        expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(ActiveMsgClient.setCronTriggerEnabled).not.toHaveBeenCalled();
        await act(async () => button('确认暂停').click());
        expect(ActiveMsgClient.setCronTriggerEnabled).toHaveBeenCalledTimes(1); expect(ActiveMsgClient.setCronTriggerEnabled).toHaveBeenCalledWith(false);
        expect(container.textContent).toContain('定时触发已暂停'); expect(button('恢复后台任务')).toBeTruthy();
        expect(busy.mock.calls.map(args => args[0])).toEqual([true, false]);
    });
    it('does not claim a failed write applied, and provides state refresh', async () => {
        vi.mocked(ActiveMsgClient.setCronTriggerEnabled).mockRejectedValue(new Error('回执丢失'));
        await render(); act(() => button('暂停后台任务').click());
        await act(async () => button('确认暂停').click());
        expect(container.querySelector('[role="alert"]')?.textContent).toBe('回执丢失');
        expect(container.textContent).not.toContain('定时触发已暂停');
        vi.mocked(ActiveMsgClient.getCronTriggerState).mockResolvedValue({ supported: true, enabled: false });
        await act(async () => button('重新读取状态').click());
        expect(container.textContent).toContain('定时触发已暂停');
    });
    it('keeps old workers passive and routes missing management credentials to the existing helper', async () => {
        vi.mocked(ActiveMsgClient.getCronTriggerState).mockResolvedValue(null); await render();
        expect(container.textContent).toBe('');
        vi.mocked(ActiveMsgClient.getCronTriggerState).mockResolvedValue({ supported: false, code: 'CF_TOKEN_MISSING' }); await render('worker-b');
        act(() => button('为后端补充管理凭据').click());
        expect(needs).toHaveBeenCalledTimes(1); expect(ActiveMsgClient.setCronTriggerEnabled).not.toHaveBeenCalled();
    });
    it('ignores old worker results after the target changes and releases the shared busy flag on close', async () => {
        let finish!: (value: { ok: boolean; message: string }) => void;
        vi.mocked(ActiveMsgClient.setCronTriggerEnabled).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await render(); act(() => button('暂停后台任务').click());
        act(() => button('确认暂停').click());
        await render('worker-b');
        await act(async () => finish({ ok: true, message: '旧 Worker 暂停了' }));
        expect(container.textContent).toContain('定时触发已开启'); expect(notify).not.toHaveBeenCalled();
        expect(busy).toHaveBeenLastCalledWith(false);
    });
    it('prevents writes while the parent is busy or has unsaved connection edits', async () => {
        await render('worker-a', true);
        expect(button('暂停后台任务').disabled).toBe(true);
        act(() => button('暂停后台任务').click());
        expect(ActiveMsgClient.setCronTriggerEnabled).not.toHaveBeenCalled();
    });
});
