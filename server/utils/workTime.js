const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/**
 * "Today" and "this week" in the CALLER's timezone. The client sends
 * Date#getTimezoneOffset() (minutes, UTC minus local); without it we fall back to UTC.
 */
const dayBounds = (tzOffset = 0, now = new Date()) => {
    const offset = Number.isFinite(tzOffset) ? tzOffset : 0;
    const localNow = now.getTime() - offset * MINUTE;
    const localMidnight = Math.floor(localNow / DAY) * DAY;
    const start = new Date(localMidnight + offset * MINUTE);
    const end = new Date(start.getTime() + DAY);
    // Week starts Monday. 1970-01-01 was a Thursday, hence the +3.
    const sinceMonday = (Math.floor(localMidnight / DAY) + 3) % 7;
    const weekStart = new Date(start.getTime() - sinceMonday * DAY);
    return { start, end, weekStart };
};

const REMINDER_TYPES = ['none', 'at_due', '1h', '1d', 'custom'];
const PRESET_MINUTES = { none: null, at_due: 0, '1h': 60, '1d': 24 * 60 };
const MAX_CUSTOM_MINUTES = 60 * 24 * 60; // 60 days

/** Validates a { type, customMinutes } reminder. Returns an error string or null. */
const reminderError = (reminder) => {
    if (!reminder || typeof reminder !== 'object') return 'reminder must be an object';
    if (!REMINDER_TYPES.includes(reminder.type)) return `reminder type must be one of ${REMINDER_TYPES.join(', ')}`;
    if (reminder.type === 'custom') {
        const m = Number(reminder.customMinutes);
        if (!Number.isInteger(m) || m < 1 || m > MAX_CUSTOM_MINUTES) return `custom reminder must be 1 to ${MAX_CUSTOM_MINUTES} minutes before`;
    }
    return null;
};

/** When the reminder should fire, or null for none / no due date. */
const computeRemindAt = (dueDate, reminder) => {
    if (!dueDate || !reminder || reminder.type === 'none') return null;
    const minutes = reminder.type === 'custom' ? Number(reminder.customMinutes) : PRESET_MINUTES[reminder.type];
    if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return null;
    return new Date(new Date(dueDate).getTime() - minutes * MINUTE);
};

const MAX_REPORT_DAYS = 366;

/**
 * A report's date range, in the caller's timezone. `from` / `to` are calendar days ("2026-10-01"), and
 * `to` is inclusive (it runs to the end of that day). Defaults to the last 30 days. Returns { from, to }
 * as Dates, or { error }.
 */
const parseRange = (query = {}, tzOffset = 0, now = new Date()) => {
    const offset = Number.isFinite(tzOffset) ? tzOffset : 0;
    const dayStart = (text) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
        if (!m) return null;
        const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        // Reject 2026-02-31 style dates that JS would silently roll over.
        return new Date(t).getUTCDate() === Number(m[3]) ? new Date(t + offset * MINUTE) : null;
    };

    let to;
    if (query.to) {
        const start = dayStart(query.to);
        if (!start) return { error: "to must be a date like 2026-10-31" };
        to = new Date(start.getTime() + DAY - 1);
    } else {
        to = new Date(dayBounds(offset, now).end.getTime() - 1);
    }

    let from;
    if (query.from) {
        from = dayStart(query.from);
        if (!from) return { error: "from must be a date like 2026-10-01" };
    } else {
        from = new Date(to.getTime() + 1 - 30 * DAY);
    }

    if (from > to) return { error: "from cannot be after to" };
    if ((to - from) / DAY > MAX_REPORT_DAYS) return { error: `Pick a range of at most ${MAX_REPORT_DAYS} days` };
    return { from, to };
};

module.exports = { DAY, MINUTE, dayBounds, parseRange, REMINDER_TYPES, reminderError, computeRemindAt };
