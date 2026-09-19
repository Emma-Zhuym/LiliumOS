import { describe, expect, it } from 'vitest';
import { Icons } from '../constants';
import {
    FIRST_LAUNCHER_PAGE_APPS,
    PINWHEEL_PAGE_APPS,
    STANDARD_LAUNCHER_PAGE_APPS,
    paginateLauncherApps,
    paginateLauncherLayout,
} from './launcherPagination';

describe('launcher pagination', () => {
    it('keeps three icon rows on page one and five rows on ordinary pages', () => {
        const apps = Array.from({ length: 45 }, (_, index) => index);
        const pages = paginateLauncherApps(apps);

        expect(FIRST_LAUNCHER_PAGE_APPS).toBe(12);
        expect(PINWHEEL_PAGE_APPS).toBe(8);
        expect(STANDARD_LAUNCHER_PAGE_APPS).toBe(20);
        expect(pages.map(page => page.length)).toEqual([12, 8, 20, 5]);
        expect(pages.flat()).toEqual(apps);
    });

    it('keeps the fixed launcher pages when there are few apps', () => {
        expect(paginateLauncherApps([1, 2, 3])).toEqual([[1, 2, 3], [], []]);
    });
});

describe('launcher mixed layout', () => {
    it('packs a wide widget as eight cells and keeps it away from the reserved schedule page', () => {
        const items = [...Array.from({ length: 12 }, (_, index) => `app-${index}`), 'widget', 'app-12'];
        const pages = paginateLauncherLayout(items, item => item === 'widget');
        expect(pages[0]).toHaveLength(12);
        expect(pages[1]).toEqual([]);
        expect(pages[2]).toEqual(['widget', 'app-12']);
    });

    it('allows the wide widget on the first page when the user moves it there', () => {
        const pages = paginateLauncherLayout(['widget', 'a', 'b', 'c', 'd', 'e'], item => item === 'widget');
        expect(pages[0]).toEqual(['widget', 'a', 'b', 'c', 'd']);
        expect(pages[1]).toEqual(['e']);
    });
});

describe('custom app icons', () => {
    it.each(['Health', 'Shopping', 'Map'])('defines %s instead of using the gear fallback', icon => {
        expect(Icons[icon]).toBeTypeOf('function');
    });
});
