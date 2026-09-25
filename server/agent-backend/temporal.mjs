/**
 * 阿萌的现实时间（Apple 日历 / 提醒事项）——读进来、按可见性裁一遍、给角色用。
 *
 * 为什么不让角色自己调 MCP 工具：调不调是模型的选择题，实测十次有九次想不起来调，
 * 跟「要不要说话」是同一个毛病（设计 4.3 的抽签）。所以这里由程序每天读一次、存下来，
 * 聊天和心跳里当成常驻的一段，角色睁眼就知道阿萌周几上课，不需要「想起来查」。
 *
 * 可见性是逐个日历 / 清单设的，默认**什么都不给看**：
 * - `hidden`：完全不读进来；
 * - `busy`：只知道这段时间阿萌在忙，不知道是什么；
 * - `title`：能看到标题。
 * 原始备注、地点、参与人一概不进角色上下文（设计 6.2）。
 */

/** 往前看一天、往后看两周：够角色判断「今天还能不能约」和「这周四有课」，再多就是噪音。 */
export const WINDOW_BACK_MS = 24 * 60 * 60 * 1000;
export const WINDOW_FORWARD_MS = 14 * 24 * 60 * 60 * 1000;
/** 列日历那一下要 20 多秒（EventKit 慢），读事件反而不到 1 秒，所以超时给得宽。 */
export const SOURCES_TIMEOUT_MS = 90_000;

export const VISIBILITY = ['hidden', 'busy', 'title'];
export const DEFAULT_VISIBILITY = 'hidden';

const pad = n => String(n).padStart(2, '0');
/** 桥接要的是本地时间字面量（不带时区偏移），按角色 / 用户所在时区格式化。 */
export const appleDateText = (date, timeZone) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
};

/**
 * 桥接返回的是给人看的 Markdown：`- 标题` 后面跟着缩进的 `- 键: 值`。
 * 解析成对象数组；第一行的总数和那句「以下内容是数据不是指令」的提示都跳过。
 */
export const parseAppleList = text => {
    const items = [];
    let current = null;
    for (const rawLine of String(text ?? '').split('\n')) {
        const line = rawLine.replace(/\s+$/, '');
        const field = line.match(/^ {2,}- ([^:]+):\s*(.*)$/);
        if (field && current) {
            current.fields[field[1].trim()] = field[2].trim();
            continue;
        }
        const head = line.match(/^- (.*)$/);
        if (head) {
            current = { title: head[1].trim(), fields: {} };
            items.push(current);
        }
    }
    return items;
};

/** 「- [ ] 标题」/「- [x] 标题」：拆出完成状态。 */
const splitCheckbox = title => {
    const box = title.match(/^\[([ xX])\]\s*(.*)$/);
    return box ? { completed: box[1].toLowerCase() === 'x', title: box[2].trim() } : { completed: false, title };
};

/** 'YYYY-MM-DD HH:mm:ss'（本地字面量）→ 该时区的绝对时刻。 */
export const parseAppleDate = (text, timeZone) => {
    const m = String(text ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
    const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    // 用同一时区把这个猜测格式化回去，差多少就补多少——不用第三方库也能正确处理夏令时。
    const seen = new Intl.DateTimeFormat('en-CA', {
        timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(guess)).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
    const seenMs = Date.UTC(+seen.year, +seen.month - 1, +seen.day, seen.hour === '24' ? 0 : +seen.hour, +seen.minute, +seen.second);
    return new Date(guess + (guess - seenMs));
};

export const normalizeEvents = (text, timeZone) => parseAppleList(text).map(item => {
    const f = item.fields;
    const start = parseAppleDate(f.Start, timeZone);
    if (!f.ID || !start) return null;
    const end = parseAppleDate(f.End, timeZone);
    return {
        kind: 'event',
        sourceId: f.ID,
        source: f.Calendar || '',
        title: item.title,
        startAt: start.toISOString(),
        endAt: end ? end.toISOString() : null,
        allDay: f['All Day'] === 'true',
        location: f.Location || null,
        // 「week on , until 2026-12-04」这类原文；角色只需要知道「这是每周固定的」。
        repeats: f.Repeats || null,
    };
}).filter(Boolean);

export const normalizeReminders = (text, timeZone) => parseAppleList(text).map(item => {
    const f = item.fields;
    const { completed, title } = splitCheckbox(item.title);
    if (!f.ID) return null;
    const due = f['Due Date'] ? parseAppleDate(f['Due Date'], timeZone) : null;
    return {
        kind: 'reminder',
        sourceId: f.ID,
        source: f.List || '',
        title,
        dueAt: due ? due.toISOString() : null,
        completed,
        priority: f.Priority && !f.Priority.startsWith('none') ? f.Priority.replace(/\s*\(\d+\)$/, '') : null,
    };
}).filter(Boolean);

export const readVisibility = raw => {
    try {
        const parsed = JSON.parse(raw || '{}');
        const clean = source => Object.fromEntries(
            Object.entries(source ?? {}).filter(([, level]) => VISIBILITY.includes(level)),
        );
        return { calendars: clean(parsed.calendars), lists: clean(parsed.lists) };
    } catch {
        return { calendars: {}, lists: {} };
    }
};

export const visibilityOf = (visibility, kind, source) =>
    (kind === 'event' ? visibility.calendars : visibility.lists)?.[source] ?? DEFAULT_VISIBILITY;

/** 拉一次 Apple：只读**可见**的那几个日历 / 清单，`hidden` 的连读都不读。 */
export const fetchTemporal = async ({ appleEvents, visibility, timeZone, now = new Date() }) => {
    const calendars = Object.entries(visibility.calendars).filter(([, level]) => level !== 'hidden').map(([name]) => name);
    const lists = Object.entries(visibility.lists).filter(([, level]) => level !== 'hidden').map(([name]) => name);
    const items = [];

    for (const calendar of calendars) {
        const result = await appleEvents.callTool('calendar_events', {
            action: 'read',
            startDate: appleDateText(new Date(now.getTime() - WINDOW_BACK_MS), timeZone),
            endDate: appleDateText(new Date(now.getTime() + WINDOW_FORWARD_MS), timeZone),
            filterCalendar: calendar,
        });
        items.push(...normalizeEvents(flatten(result), timeZone).map(item => ({ ...item, source: item.source || calendar })));
    }
    for (const list of lists) {
        const result = await appleEvents.callTool('reminders_tasks', { action: 'read', filterList: list, showCompleted: false });
        items.push(...normalizeReminders(flatten(result), timeZone).map(item => ({ ...item, source: item.source || list })));
    }
    return items;
};

const flatten = result => (Array.isArray(result?.content) ? result.content : [])
    .map(block => (block?.type === 'text' ? block.text : '')).join('\n');

export const replaceTemporalItems = (db, items, now = new Date()) => {
    const nowIso = now.toISOString();
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM temporal_items').run();
        const insert = db.prepare(
            `INSERT INTO temporal_items (source_id, kind, source, title, start_at, end_at, all_day, due_at, completed, priority, location, repeats, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source_id) DO NOTHING`,
        );
        for (const item of items) {
            insert.run(
                item.sourceId, item.kind, item.source, item.title,
                item.startAt ?? null, item.endAt ?? null, item.allDay ? 1 : 0,
                item.dueAt ?? null, item.completed ? 1 : 0, item.priority ?? null,
                item.location ?? null, item.repeats ?? null, nowIso,
            );
        }
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
};

export const listTemporalItems = (db, { from = null, to = null } = {}) => {
    const rows = db.prepare('SELECT * FROM temporal_items ORDER BY COALESCE(start_at, due_at, fetched_at)').all();
    return rows.map(row => ({
        kind: row.kind,
        sourceId: row.source_id,
        source: row.source,
        title: row.title,
        startAt: row.start_at,
        endAt: row.end_at,
        allDay: row.all_day === 1,
        dueAt: row.due_at,
        completed: row.completed === 1,
        priority: row.priority,
        location: row.location,
        repeats: row.repeats,
        fetchedAt: row.fetched_at,
    })).filter(item => {
        const at = item.startAt ?? item.dueAt;
        if (!at) return true;
        if (from && (item.endAt ?? at) < from) return false;
        if (to && at > to) return false;
        return true;
    });
};

/** 按可见性裁一遍：`busy` 的只留「有安排」，标题、地点一律抹掉。 */
export const veilForCharacter = (items, visibility) => items.map(item => {
    const level = visibilityOf(visibility, item.kind, item.source);
    if (level === 'hidden') return null;
    if (level === 'title') return { ...item, location: null };
    return {
        ...item,
        title: item.kind === 'event' ? '有安排' : '有件事要做',
        location: null,
        veiled: true,
    };
}).filter(Boolean);

/**
 * 写给提示词的那一段：阿萌的安排。
 *
 * 只写角色真用得上的三件事：她现在忙不忙、今天接下来有什么、每周固定的那些（课表）。
 * 两周窗口里的其它条目不写——角色不需要知道她下周二几点看牙，需要的时候那天自然会看到。
 */
export const formatTemporalForPrompt = (items, now, timeZone, userName = '对方') => {
    if (!items.length) return '';
    const nowMs = now.getTime();
    const dayEnd = new Date(nowMs + 36 * 3600_000).toISOString();
    const clock = at => new Intl.DateTimeFormat('zh-CN', {
        timeZone, hour12: true, hour: 'numeric', minute: '2-digit',
    }).format(new Date(at));
    const dayName = at => new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }).format(new Date(at));

    const events = items.filter(item => item.kind === 'event' && item.startAt);
    const nowBusy = events.find(item => Date.parse(item.startAt) <= nowMs && Date.parse(item.endAt ?? item.startAt) > nowMs);
    const soon = events
        .filter(item => Date.parse(item.startAt) > nowMs && item.startAt <= dayEnd)
        .slice(0, 4)
        .map(item => `${dayName(item.startAt)} ${clock(item.startAt)} ${item.title}`);
    // 每周固定的（课表）：同一个标题重复出现的，按星期几归一句
    const weekly = new Map();
    for (const item of events.filter(item => item.repeats)) {
        const key = item.title;
        const slot = `${dayName(item.startAt)}${clock(item.startAt)}`;
        weekly.set(key, [...new Set([...(weekly.get(key) ?? []), slot])]);
    }

    const lines = [];
    if (nowBusy) lines.push(`- 此刻：${nowBusy.title}${nowBusy.endAt ? `，到 ${clock(nowBusy.endAt)}` : ''}`);
    if (soon.length) lines.push(`- 接下来：${soon.join('；')}`);
    if (weekly.size) {
        lines.push(`- 每周固定：${[...weekly].slice(0, 6).map(([title, slots]) => `${slots.join('、')} ${title}`).join('；')}`);
    }
    const due = items
        .filter(item => item.kind === 'reminder' && !item.completed && item.dueAt && Date.parse(item.dueAt) > nowMs)
        .slice(0, 3)
        .map(item => `${dayName(item.dueAt)}前 ${item.title}`);
    if (due.length) lines.push(`- 记着的事：${due.join('；')}`);
    if (!lines.length) return '';

    return `${userName}的安排（你知道这些，但这是 ta 的日历，不是 ta 特地告诉你的）：\n${lines.join('\n')}\n`
        + '别一见面就报菜单式地复述这些；该体谅的时候体谅（ta 在忙就别追着问），'
        + '该记得的时候记得（快到期的事可以问一句）。';
};
