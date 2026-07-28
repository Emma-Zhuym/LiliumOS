export const FIRST_LAUNCHER_PAGE_APPS = 12;
export const PINWHEEL_PAGE_APPS = 8;
export const STANDARD_LAUNCHER_PAGE_APPS = 20;

export function paginateLauncherApps<T>(apps: T[]): T[][] {
    const pages: T[][] = [
        apps.slice(0, FIRST_LAUNCHER_PAGE_APPS),
        apps.slice(FIRST_LAUNCHER_PAGE_APPS, FIRST_LAUNCHER_PAGE_APPS + PINWHEEL_PAGE_APPS),
    ];

    for (
        let i = FIRST_LAUNCHER_PAGE_APPS + PINWHEEL_PAGE_APPS;
        i < apps.length;
        i += STANDARD_LAUNCHER_PAGE_APPS
    ) {
        pages.push(apps.slice(i, i + STANDARD_LAUNCHER_PAGE_APPS));
    }

    while (pages.length < 3) pages.push([]);
    return pages;
}
