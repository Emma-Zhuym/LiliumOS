import { describe, expect, it } from 'vitest';
import { Icons } from '../constants';
import {
    FIRST_LAUNCHER_PAGE_APPS,
    PINWHEEL_PAGE_APPS,
    STANDARD_LAUNCHER_PAGE_APPS,
    paginateLauncherApps,
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

describe('custom app icons', () => {
    it.each(['Health', 'Shopping', 'Map'])('defines %s instead of using the gear fallback', icon => {
        expect(Icons[icon]).toBeTypeOf('function');
    });
});
