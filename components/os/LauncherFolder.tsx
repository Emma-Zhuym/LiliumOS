import React, { useState } from 'react';
import { Check, Folder, PencilSimple, Trash, CaretLeft } from '@phosphor-icons/react';
import { Icons, INSTALLED_APPS } from '../../constants';
import { AppID, type AppConfig, type LauncherFolder } from '../../types';
import { isPaperWallpaper, useOS } from '../../context/OSContext';
import { F, FONT, S, R, HUE } from '../../utils/clayTokens';
import AppIcon from './AppIcon';

export function LauncherFolderIcon({ folder, onOpen }: { folder: LauncherFolder; onOpen: () => void }) {
  const { theme } = useOS();
  const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);
  const items = folder.appIds.slice(0, 4).map(id => INSTALLED_APPS.find(app => app.id === id)).filter((app): app is AppConfig => Boolean(app));
  return (
    <button type="button" onClick={onOpen} className="flex flex-col items-center gap-1.5 active:scale-95">
      <span className="w-14 h-14 grid grid-cols-2 grid-rows-2 place-items-center p-1"
        style={{ background: paper ? F.appBg : F.surface, border: `1px solid ${F.borderSoft}`, borderRadius: R.large, boxShadow: S.raisedSoft }}>
        {items.map(app => {
          const Icon = Icons[app.icon] || Icons.Settings;
          return <Icon key={app.id} className="w-5 h-5" />;
        })}
        {items.length === 0 && <Folder size={22} />}
      </span>
      <span className="text-[10.5px] font-bold max-w-[4.5rem] truncate" style={{ color: theme.skin === 'animalcrossing' || paper ? F.textPrimary : theme.contentColor || F.surface }}>
        {folder.name}
      </span>
    </button>
  );
}

const circleButton: React.CSSProperties = {
  width: 44, height: 44, background: 'transparent', border: 'none',
  borderRadius: R.pill, boxShadow: 'none',
};

export function LauncherFolderPanel({ folder, onClose, onOpenApp, onEdit }: {
  folder: LauncherFolder; onClose: () => void; onOpenApp: (id: AppID) => void; onEdit: () => void;
}) {
  const apps = folder.appIds.map(id => INSTALLED_APPS.find(app => app.id === id)).filter((app): app is AppConfig => Boolean(app));
  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center px-5" onPointerDown={event => event.stopPropagation()}>
      <div className="absolute inset-0" style={{ background: F.textPrimary, opacity: 0.35 }} onClick={onClose} />
      <div className="relative w-full max-w-sm max-h-[75%] flex flex-col p-4" style={{ background: F.appBg, borderRadius: R.panel, boxShadow: S.floating }}>
        <header className="relative h-11 flex items-center justify-between shrink-0">
          <button type="button" style={circleButton} className="flex items-center justify-center" aria-label="关闭文件夹" onClick={onClose}><CaretLeft size={22} weight="bold" color={F.textPrimary} /></button>
          <h2 className="absolute left-1/2 -translate-x-1/2 truncate max-w-[55%]" style={{ ...FONT.navTitle, fontFamily: FONT.heading }}>{folder.name}</h2>
          <button type="button" style={circleButton} className="flex items-center justify-center" aria-label="编辑文件夹" onClick={onEdit}><PencilSimple size={21} weight="bold" color={F.textPrimary} /></button>
        </header>
        <div className="mt-4 p-4 grid grid-cols-4 gap-y-5 place-items-center overflow-y-auto" style={{ background: F.surfaceSunken, borderRadius: R.large, boxShadow: S.sunken }}>
          {apps.map(app => <AppIcon key={app.id} app={app} onClick={() => onOpenApp(app.id)} />)}
        </div>
      </div>
    </div>
  );
}

export function LauncherFolderEditor({ folder, availableApps, onClose, onSave, onDelete }: {
  folder?: LauncherFolder; availableApps: AppConfig[]; onClose: () => void;
  onSave: (name: string, ids: AppID[]) => void; onDelete?: () => void;
}) {
  const [name, setName] = useState(folder?.name || '文件夹');
  const [selected, setSelected] = useState<AppID[]>(folder?.appIds || []);
  const toggle = (id: AppID) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const canSave = !!name.trim() && selected.length >= (folder ? 1 : 2);
  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center px-5" onPointerDown={event => event.stopPropagation()}>
      <div className="absolute inset-0" style={{ background: F.textPrimary, opacity: 0.35 }} onClick={onClose} />
      <div className="relative w-full max-w-sm max-h-[82%] flex flex-col p-4" style={{ background: F.appBg, borderRadius: R.panel, boxShadow: S.floating }}>
        <header className="relative h-11 flex items-center justify-between shrink-0">
          <button type="button" style={circleButton} className="flex items-center justify-center" aria-label="返回" onClick={onClose}><CaretLeft size={22} weight="bold" color={F.textPrimary} /></button>
          <h2 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold">{folder ? '编辑文件夹' : '新建文件夹'}</h2>
          <span className="w-11" />
        </header>
        <label className="mt-4 text-[13px]" style={{ color: F.textSecondary }}>名称</label>
        <input value={name} maxLength={20} onChange={event => setName(event.target.value)} className="mt-2 h-12 px-3 outline-none text-[15px]"
          style={{ background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken }} />
        <p className="mt-4 text-[13px]" style={{ color: F.textSecondary }}>选择要放进去的软件{folder ? '' : '（至少两个）'}</p>
        <div className="mt-2 overflow-y-auto" style={{ background: F.surface, borderRadius: R.large, boxShadow: S.raisedSoft }}>
          {availableApps.map(app => {
            const Icon = Icons[app.icon] || Icons.Settings;
            const checked = selected.includes(app.id);
            return <button key={app.id} type="button" onClick={() => toggle(app.id)} aria-pressed={checked}
              className="w-full h-16 flex items-center gap-3 px-4 text-left border-b last:border-b-0" style={{ borderColor: F.divider }}>
              <span className="w-11 h-11 flex items-center justify-center" style={{ background: HUE.indigo.main, borderRadius: R.small }}><Icon className="w-[22px] h-[22px] text-white" /></span>
              <span className="flex-1 text-[15px]">{app.name}</span>
              <span className="w-6 h-6 flex items-center justify-center" style={{ background: checked ? HUE.indigo.tint : F.surfaceSunken, color: HUE.indigo.ink, borderRadius: R.small }}>{checked && <Check size={16} weight="bold" />}</span>
            </button>;
          })}
        </div>
        <div className="shrink-0 mt-4 flex gap-3">
          {folder && onDelete && <button type="button" aria-label="删除文件夹并放回软件" onClick={onDelete} className="h-12 w-12 flex items-center justify-center" style={{ background: F.surface, borderRadius: R.button, boxShadow: S.raisedSoft }}><Trash size={20} /></button>}
          <button type="button" disabled={!canSave} onClick={() => onSave(name.trim(), selected)} className="h-12 flex-1 font-semibold disabled:opacity-40" style={{ background: F.textPrimary, color: F.surface, borderRadius: R.button, boxShadow: S.raisedSoft }}>保存文件夹</button>
        </div>
      </div>
    </div>
  );
}
