export const DESKTOP_COLUMNS = 4;
export const DESKTOP_ROWS = 6;

export type DesktopPosition = { page: number; row: number; col: number };
export type DesktopLayout = Record<string, DesktopPosition>;
export type DesktopSize = { cols: number; rows: number };

export const DESKTOP_WIDGET_IDS = {
  clock: 'widget:clock',
  character: 'widget:character',
  schedule: 'widget:schedule',
  music: 'widget:music',
  image: 'widget:image',
  utilities: 'widget:utilities',
  agenda: 'widget:agenda',
} as const;

export function desktopItemSize(id: string): DesktopSize {
  if (id === DESKTOP_WIDGET_IDS.agenda) return { cols: 4, rows: 6 };
  if (id === DESKTOP_WIDGET_IDS.clock || id === DESKTOP_WIDGET_IDS.utilities || id === 'widget:image:wide') return { cols: 4, rows: 2 };
  if (id === DESKTOP_WIDGET_IDS.schedule) return { cols: 4, rows: 2 };
  if (id === DESKTOP_WIDGET_IDS.character) return { cols: 4, rows: 1 };
  if (id === DESKTOP_WIDGET_IDS.music || id === DESKTOP_WIDGET_IDS.image || id.startsWith('widget:image:')) return { cols: 2, rows: 2 };
  return { cols: 1, rows: 1 };
}

function validPosition(value: unknown, size: DesktopSize): value is DesktopPosition {
  if (!value || typeof value !== 'object') return false;
  const p = value as DesktopPosition;
  return Number.isInteger(p.page) && p.page >= 0 && p.page < 100 &&
    Number.isInteger(p.row) && p.row >= 0 && p.row + size.rows <= DESKTOP_ROWS &&
    Number.isInteger(p.col) && p.col >= 0 && p.col + size.cols <= DESKTOP_COLUMNS;
}

function overlaps(a: DesktopPosition, aSize: DesktopSize, b: DesktopPosition, bSize: DesktopSize): boolean {
  return a.page === b.page && a.col < b.col + bSize.cols && a.col + aSize.cols > b.col &&
    a.row < b.row + bSize.rows && a.row + aSize.rows > b.row;
}

function fits(layout: DesktopLayout, id: string, position: DesktopPosition): boolean {
  const size = desktopItemSize(id);
  return validPosition(position, size) && Object.entries(layout).every(([other, p]) =>
    other === id || !overlaps(position, size, p, desktopItemSize(other)));
}

function firstFree(layout: DesktopLayout, id: string, startPage = 0): DesktopPosition {
  for (let page = startPage; page < 100; page++) {
    for (let row = 0; row < DESKTOP_ROWS; row++) {
      for (let col = 0; col < DESKTOP_COLUMNS; col++) {
        const position = { page, row, col };
        if (fits(layout, id, position)) return position;
      }
    }
  }
  throw new Error('Launcher desktop has no free cell');
}

/** Existing users retain their app order, while new installs start with the familiar first two pages. */
export function defaultDesktopLayout(appIds: string[], utilityEnabled: boolean, legacyPinwheel?: Array<'music' | 'appsA' | 'appsB' | 'image'>): DesktopLayout {
  const layout: DesktopLayout = {
    [DESKTOP_WIDGET_IDS.agenda]: { page: 0, row: 0, col: 0 },
    [DESKTOP_WIDGET_IDS.clock]: { page: 1, row: 0, col: 0 },
    [DESKTOP_WIDGET_IDS.character]: { page: 1, row: 2, col: 0 },
    [DESKTOP_WIDGET_IDS.schedule]: { page: 2, row: 0, col: 0 },
  };
  const firstPage = appIds.filter(id => id !== DESKTOP_WIDGET_IDS.utilities).slice(0, 12);
  firstPage.forEach((id, index) => { layout[id] = { page: 1, row: 3 + Math.floor(index / 4), col: index % 4 }; });
  const secondPage = appIds.filter(id => id !== DESKTOP_WIDGET_IDS.utilities).slice(12, 20);
  const oldOrder = (legacyPinwheel || []).filter((id, index, all) =>
    ['music', 'appsA', 'appsB', 'image'].includes(id) && all.indexOf(id) === index);
  const cells = [...oldOrder, ...(['music', 'appsA', 'appsB', 'image'] as const).filter(id => !oldOrder.includes(id))];
  cells.forEach((cell, index) => {
    const row = index < 2 ? 2 : 4;
    const col = index % 2 === 0 ? 0 : 2;
    if (cell === 'music' || cell === 'image') {
      layout[cell === 'music' ? DESKTOP_WIDGET_IDS.music : DESKTOP_WIDGET_IDS.image] = { page: 2, row, col };
      return;
    }
    const group = secondPage.slice(cell === 'appsA' ? 0 : 4, cell === 'appsA' ? 4 : 8);
    group.forEach((id, offset) => { layout[id] = { page: 2, row: row + Math.floor(offset / 2), col: col + offset % 2 }; });
  });
  for (const id of appIds.filter(id => id !== DESKTOP_WIDGET_IDS.utilities).slice(20)) layout[id] = firstFree(layout, id, 3);
  if (utilityEnabled) layout[DESKTOP_WIDGET_IDS.utilities] = firstFree(layout, DESKTOP_WIDGET_IDS.utilities, 3);
  return layout;
}

/** Ignore stale or overlapping saved cells; preserve valid placements and append newly installed apps. */
export function normalizeDesktopLayout(ids: string[], saved: DesktopLayout | undefined, defaults: DesktopLayout): DesktopLayout {
  const result: DesktopLayout = {};
  for (const id of ids) {
    const position = saved?.[id];
    if (position && fits(result, id, position)) result[id] = position;
  }
  for (const id of ids) {
    if (result[id]) continue;
    const preferred = defaults[id];
    result[id] = preferred && fits(result, id, preferred) ? preferred : firstFree(result, id, preferred?.page ?? 0);
  }
  return result;
}

/** Drop at a cell. Only the items touched by the moved tile are displaced. */
export function moveDesktopItem(layout: DesktopLayout, id: string, destination: DesktopPosition): DesktopLayout {
  const size = desktopItemSize(id);
  if (!layout[id] || !validPosition(destination, size)) return layout;
  const source = layout[id];
  if (source.page === destination.page && source.row === destination.row && source.col === destination.col) return layout;
  const moved = Object.entries(layout).filter(([other, p]) => other !== id && overlaps(destination, size, p, desktopItemSize(other)));
  const result = { ...layout };
  delete result[id];
  for (const [other] of moved) delete result[other];
  result[id] = destination;
  for (const [other, oldPosition] of moved) {
    result[other] = fits(result, other, source) ? source
      : fits(result, other, oldPosition) ? oldPosition
      : firstFree(result, other, oldPosition.page);
  }
  return result;
}

export function desktopPageCount(layout: DesktopLayout): number {
  return Math.max(3, ...Object.values(layout).map(position => position.page + 1));
}
