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

/** Pack a single wide utility widget into the launcher grid without placing it on the reserved schedule page. */
export function paginateLauncherLayout<T>(items: T[], isWideWidget: (item: T) => boolean): T[][] {
    const capacities = [FIRST_LAUNCHER_PAGE_APPS, PINWHEEL_PAGE_APPS];
    const pages: T[][] = [[], []];
    let pageIndex = 0;
    let used = 0;

    for (const item of items) {
        const wide = isWideWidget(item);
        const weight = wide ? 8 : 1;
        if (wide && pageIndex === 1) {
            pageIndex = 2;
            used = 0;
        }
        let capacity = capacities[pageIndex] || STANDARD_LAUNCHER_PAGE_APPS;
        if (used + weight > capacity) {
            pageIndex += 1;
            used = 0;
            if (wide && pageIndex === 1) pageIndex = 2;
            capacity = capacities[pageIndex] || STANDARD_LAUNCHER_PAGE_APPS;
        }
        while (pages.length <= pageIndex) pages.push([]);
        pages[pageIndex].push(item);
        used += weight;
    }

    while (pages.length < 3) pages.push([]);
    return pages;
}
