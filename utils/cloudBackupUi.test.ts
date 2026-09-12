// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CloudBackupRestoreList, { type CloudBackupListState } from '../components/settings/CloudBackupRestoreList';
import GithubBackupRoute from '../components/settings/GithubBackupRoute';
import ClayDialog from '../components/os/ClayDialog';
import type { CloudBackupFile } from '../types';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', vi.fn());
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const backup: CloudBackupFile = { name: 'Sully_Backup_full_1.zip', href: '123:456', lastModified: '2026-09-12T12:00:00.000Z', size: 1024 };

describe('cloud backup recovery states', () => {
    const restore = vi.fn();
    const retry = vi.fn();
    const render = (state: CloudBackupListState, files: CloudBackupFile[] = [], error = '') => act(() => root.render(React.createElement(CloudBackupRestoreList, {
        state, files, error, onRestore: restore, onRetry: retry, githubReleasesUrl: 'https://github.com/test-owner/test-backup/releases',
    })));
    beforeEach(() => { restore.mockClear(); retry.mockClear(); });
    it('distinguishes loading, empty results and a failed read without offering a false restore', () => {
        render('loading'); expect(container.textContent).toContain('正在读取');
        render('ready'); expect(container.textContent).toContain('还没有云端备份'); expect(container.textContent).not.toContain('正在读取');
        render('error', [], 'GitHub 暂时无法连接');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('GitHub 暂时无法连接');
        act(() => container.querySelector<HTMLButtonElement>('button')!.click());
        expect(retry).toHaveBeenCalledTimes(1); expect(restore).not.toHaveBeenCalled();
    });
    it('blocks incomplete files and retains the failure reason and inspection link', () => {
        render('ready', [{ ...backup, status: 'incomplete', statusMessage: '缺少第 2 片' }, { ...backup, href: '124:457', name: '完整备份.zip', status: 'ready' }]);
        const buttons = container.querySelectorAll<HTMLButtonElement>('button');
        expect(buttons[0].disabled).toBe(true); expect(container.textContent).toContain('缺少第 2 片');
        expect(container.querySelector('a')?.href).toBe('https://github.com/test-owner/test-backup/releases');
        act(() => buttons[0].click()); expect(restore).not.toHaveBeenCalled();
        act(() => buttons[1].click()); expect(restore).toHaveBeenCalledTimes(1); expect(restore.mock.calls[0][0].href).toBe('124:457');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('keeps legacy backups without status recoverable', () => {
        render('ready', [backup]);
        act(() => container.querySelector<HTMLButtonElement>('button')!.click());
        expect(restore).toHaveBeenCalledWith(backup);
    });
});

describe('GitHub backup route disclosure', () => {
    it('shows destination and credential disclosure before a deliberate toggle, without a network call', () => {
        const change = vi.fn();
        act(() => root.render(React.createElement(GithubBackupRoute, { enabled: false, workerUrl: 'https://my-worker.example', onChange: change })));
        expect(change).not.toHaveBeenCalled();
        expect(container.textContent).toContain('默认直接连接 GitHub');
        expect(container.textContent).toContain('GitHub Token 和备份内容');
        expect(container.textContent).toContain('https://my-worker.example');
        const button = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
        expect(button.getAttribute('aria-checked')).toBe('false');
        act(() => button.click()); expect(change).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledWith(true);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('prevents route changes while testing a connection', () => {
        const change = vi.fn();
        act(() => root.render(React.createElement(GithubBackupRoute, { enabled: true, disabled: true, workerUrl: 'https://my-worker.example', onChange: change })));
        act(() => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
        expect(change).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    });
});

describe('backup dialog keyboard and overlay', () => {
    it('contains focus, closes without bubbling, and restores the opener', () => {
        const closed = vi.fn(), parentClick = vi.fn();
        const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
        act(() => root.render(React.createElement('div', { onClick: parentClick }, React.createElement(ClayDialog, {
            isOpen: true, title: '备份测试', onClose: closed,
            footer: React.createElement('button', { id: 'backup-test-submit' }, '测试并连接'),
            children: React.createElement('input', { 'aria-label': '测试输入' }),
        }))));
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
        const close = dialog.querySelector<HTMLButtonElement>('button')!;
        const submit = dialog.querySelector<HTMLButtonElement>('#backup-test-submit')!;
        expect(document.activeElement).toBe(close);
        // jsdom has no layout; expose the same visible controls the browser lays out.
        dialog.querySelectorAll<HTMLElement>('button,input').forEach(element => { vi.spyOn(element, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList); });
        act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
        expect(document.activeElement).toBe(submit);
        act(() => submit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
        expect(document.activeElement).toBe(close);
        act(() => dialog.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(closed).toHaveBeenCalledTimes(1); expect(parentClick).not.toHaveBeenCalled();
        act(() => root.render(null)); expect(document.activeElement).toBe(opener);
        opener.remove(); vi.restoreAllMocks();
    });
});
