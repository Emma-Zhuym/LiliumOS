import { describe, expect, it } from 'vitest';
import { DESKTOP_COLUMNS, DESKTOP_ROWS, DESKTOP_WIDGET_IDS, defaultDesktopLayout, desktopItemSize, desktopPageCount, moveDesktopItem, normalizeDesktopLayout, type DesktopLayout } from './launcherDesktopLayout';

function expectValid(layout: DesktopLayout) {
  const occupied = new Set<string>();
  for (const [id, position] of Object.entries(layout)) {
    const size = desktopItemSize(id);
    expect(position.col + size.cols).toBeLessThanOrEqual(DESKTOP_COLUMNS);
    expect(position.row + size.rows).toBeLessThanOrEqual(DESKTOP_ROWS);
    for (let row = position.row; row < position.row + size.rows; row++) {
      for (let col = position.col; col < position.col + size.cols; col++) {
        const cell = `${position.page}:${row}:${col}`;
        expect(occupied.has(cell), `${id} overlaps ${cell}`).toBe(false);
        occupied.add(cell);
      }
    }
  }
}

const icons = Array.from({ length: 25 }, (_, index) => `app:${index}`);

describe('launcher desktop grid', () => {
  it('keeps the familiar first two pages while placing all widgets in grid cells', () => {
    const layout = defaultDesktopLayout(icons, true);
    expect(layout[DESKTOP_WIDGET_IDS.agenda]).toEqual({ page: 0, row: 0, col: 0 });
    expect(layout[DESKTOP_WIDGET_IDS.clock]).toEqual({ page: 1, row: 0, col: 0 });
    expect(layout[DESKTOP_WIDGET_IDS.schedule]).toEqual({ page: 2, row: 0, col: 0 });
    expect(layout[DESKTOP_WIDGET_IDS.music]).toEqual({ page: 2, row: 2, col: 0 });
    expect(desktopItemSize(DESKTOP_WIDGET_IDS.schedule)).toEqual({ cols: 4, rows: 2 });
    expect(layout[DESKTOP_WIDGET_IDS.utilities].page).toBeGreaterThanOrEqual(3);
    expect(desktopPageCount(layout)).toBe(4);
    expectValid(layout);
  });

  it('moves a clock below the icons and back without losing other positions', () => {
    const original = defaultDesktopLayout(icons, true);
    const moved = moveDesktopItem(original, DESKTOP_WIDGET_IDS.clock, { page: 1, row: 4, col: 0 });
    expect(moved[DESKTOP_WIDGET_IDS.clock]).toEqual({ page: 1, row: 4, col: 0 });
    expect(moved[icons[0]]).toEqual(original[icons[0]]);
    expectValid(moved);
    const restored = moveDesktopItem(moved, DESKTOP_WIDGET_IDS.clock, { page: 1, row: 0, col: 0 });
    expect(restored[DESKTOP_WIDGET_IDS.clock]).toEqual(original[DESKTOP_WIDGET_IDS.clock]);
    expectValid(restored);
  });

  it('displaces a widget when an icon is dropped on it', () => {
    const original = defaultDesktopLayout(icons, true);
    const moved = moveDesktopItem(original, icons[0], { page: 2, row: 2, col: 0 });
    expect(moved[icons[0]]).toEqual({ page: 2, row: 2, col: 0 });
    expect(moved[DESKTOP_WIDGET_IDS.music]).not.toEqual(original[DESKTOP_WIDGET_IDS.music]);
    expectValid(moved);
  });

  it('repairs invalid saved cells and adds newly installed apps', () => {
    const defaults = defaultDesktopLayout(icons, true);
    const ids = [...Object.keys(defaults), 'app:new'];
    const saved = { ...defaults, [icons[0]]: { page: 0, row: -1, col: 0 } };
    const result = normalizeDesktopLayout(ids, saved, defaults);
    expect(result[icons[0]]).toEqual(defaults[icons[0]]);
    expect(result['app:new']).toBeDefined();
    expectValid(result);
  });

  it('keeps newly added free items off the fixed clock page', () => {
    const result = normalizeDesktopLayout(
      [DESKTOP_WIDGET_IDS.agenda, 'app:new'], undefined,
      { [DESKTOP_WIDGET_IDS.agenda]: { page: 0, row: 0, col: 0 } },
    );
    expect(result['app:new'].page).toBe(2);
    expectValid(result);
  });
});
