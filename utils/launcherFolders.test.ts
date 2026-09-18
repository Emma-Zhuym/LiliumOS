import { describe, expect, it } from 'vitest';
import { AppID } from '../types';
import { normalizeLauncherFolders, rootLauncherIds } from './launcherFolders';

describe('launcher folders', () => {
  it('keeps each available app in at most one folder and leaves other apps on the desktop', () => {
    const available = [AppID.Bank, AppID.Health, AppID.SmartHome];
    const folders = normalizeLauncherFolders([
      { id: 'folder:a', name: '常用', appIds: [AppID.Bank, AppID.Health] },
      { id: 'folder:b', name: '其他', appIds: [AppID.Health, AppID.SmartHome] },
    ], available);
    expect(folders.map(folder => folder.appIds)).toEqual([[AppID.Bank, AppID.Health], [AppID.SmartHome]]);
    expect(rootLauncherIds(available, folders)).toEqual(['folder:a', 'folder:b']);
    expect(rootLauncherIds(available, [])).toEqual(available);
  });
});
