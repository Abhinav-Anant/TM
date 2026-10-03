// Pure helpers: no React, no network, so `npm test` can run them under plain Node.
// The same rules as the web app (src/utils/helper.js and the My Work page) - keep them in step.

const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfDay = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

/** "2026-10-07" for a local date. */
export const toDayText = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** "2026-10-07" -> local midnight Date. null for blank, NaN-date (Invalid Date) is never returned: junk gives undefined. */
export const parseDay = (text) => {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return undefined;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // new Date(2026, 1, 31) quietly becomes 3 March; refuse it.
    return date.getMonth() === Number(m[2]) - 1 && date.getDate() === Number(m[3]) ? date : undefined;
};

export const quickDays = (now = new Date()) => [
    ['Today', toDayText(now)],
    ['Tomorrow', toDayText(addDays(now, 1))],
    ['Next week', toDayText(addDays(now, 7))],
];

export const MY_WORK_TABS = ['All', 'Today', 'Upcoming', 'Overdue', 'Completed'];

/** Query params for a My Work tab, using the phone's own idea of "today". */
export const tabParams = (tab, now = new Date()) => {
    const start = startOfDay(now);
    const end = addDays(start, 1);
    const before = (d) => new Date(d.getTime() - 1).toISOString();
    switch (tab) {
        case 'Today': return { open: 'true', dueAfter: start.toISOString(), dueBefore: before(end) };
        case 'Upcoming': return { open: 'true', dueAfter: end.toISOString() };
        case 'Overdue': return { open: 'true', dueBefore: before(start) };
        case 'Completed': return { status: 'Completed' };
        default: return {};
    }
};

/** 205 -> "3h 25m". */
export const formatMinutes = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(m / 60);
    if (!h) return `${m}m`;
    return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
};

/** "4h", "1.5h", "3h 25m", "90m", "90" -> minutes. Blank is null, junk is NaN. */
export const parseDuration = (text) => {
    const raw = String(text ?? '').trim().toLowerCase();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw);
    const match = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(raw);
    if (!match || (match[1] === undefined && match[2] === undefined)) return NaN;
    return Math.round(Number(match[1] || 0) * 60 + Number(match[2] || 0));
};

/** Six Monday-first weeks covering `month` (a Date inside the month): a stable 42-cell grid. */
export const monthGrid = (month) => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const sinceMonday = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => addDays(first, i - sinceMonday));
};

/** Calendar feed -> { 'YYYY-MM-DD': [{ key, kind, title, ... }] }. Project deadlines first, then tasks, then projected repeats. */
export const itemsByDay = ({ tasks = [], projects = [], recurring = [] } = {}) => {
    const map = {};
    const add = (date, item) => {
        const key = toDayText(new Date(date));
        (map[key] = map[key] || []).push(item);
    };
    projects.forEach((p) => add(p.dueDate, { key: `p${p._id}`, kind: 'project', title: p.name, projectId: p._id }));
    tasks.forEach((t) => add(t.dueDate, { key: `t${t._id}`, kind: 'task', title: t.title, taskId: t._id, status: t.status, priority: t.priority }));
    recurring.forEach((r) => add(r.dueDate, { key: `r${r.taskId}${r.dueDate}`, kind: 'repeat', title: r.title, taskId: r.taskId, priority: r.priority }));
    return map;
};

/** "@Xe" at the end of the text -> people whose name starts that way (never yourself). */
export const mentionSuggestions = (text, people, selfId) => {
    const partial = /(?:^|\s)@([\w-]*)$/.exec(text);
    if (!partial) return [];
    return people.filter((p) => p._id !== selfId && p.name.toLowerCase().startsWith(partial[1].toLowerCase())).slice(0, 5);
};

export const applyMention = (text, person) => text.replace(/@([\w-]*)$/, `@${person.name} `);

/** Only names actually written in the comment count as mentions. */
export const mentionIds = (text, people) => people.filter((p) => text.includes(`@${p.name}`)).map((p) => p._id);

/** "/api/files/<id>/Site%20photo.png" -> "Site photo.png"; works for old timestamp-prefixed names too. */
export const fileLabel = (url) => decodeURIComponent(String(url).split('/').pop() || url).replace(/^\d{10,}-/, '');

/** The id out of one of our file URLs, or null for an outside link. */
export const fileId = (url) => /^\/api\/files\/([0-9a-f]{24})/.exec(String(url))?.[1] || null;

export const isImageName = (name) => /\.(png|jpe?g|gif|webp)$/i.test(name);

export const DAY = DAY_MS;
