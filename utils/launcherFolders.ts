import type { AppID, LauncherFolder } from '../types';

/** Keep old theme backups usable, and prevent one app from appearing in two folders. */
export function normalizeLauncherFolders(folders: LauncherFolder[] | undefined, availableIds: AppID[]): LauncherFolder[] {
  const available = new Set(availableIds);
  const usedApps = new Set<AppID>();
  const usedFolders = new Set<string>();
  const result: LauncherFolder[] = [];
  for (const folder of Array.isArray(folders) ? folders : []) {
    if (!folder || typeof folder.id !== 'string' || !folder.id.startsWith('folder:') || usedFolders.has(folder.id)) continue;
    const appIds = [...new Set(Array.isArray(folder.appIds) ? folder.appIds : [])]
      .filter(id => available.has(id) && !usedApps.has(id));
    if (!appIds.length) continue;
    appIds.forEach(id => usedApps.add(id));
    usedFolders.add(folder.id);
    result.push({ id: folder.id, name: (folder.name || '文件夹').trim().slice(0, 20) || '文件夹', appIds });
  }
  return result;
}

export function rootLauncherIds(availableIds: AppID[], folders: LauncherFolder[]): string[] {
  const hidden = new Set(folders.flatMap(folder => folder.appIds));
  return [...availableIds.filter(id => !hidden.has(id)), ...folders.map(folder => folder.id)];
}
