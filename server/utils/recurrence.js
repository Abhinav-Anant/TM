const RECURRENCES = ["none", "daily", "weekly", "monthly"];

const DAY = 24 * 60 * 60 * 1000;

// UTC throughout: the client stores due dates as UTC midnight ("2026-01-31T00:00:00Z"),
// so local-time maths on an IST server would land on the wrong calendar day.
const addMonths = (date, n) => {
    const d = new Date(date);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
};

// The nth occurrence after `date`, always measured from `date` itself so a
// clamped month (31 Jan -> 28 Feb) does not drag later ones to the 28th.
const STEPS = {
    daily: (date, n) => new Date(new Date(date).getTime() + n * DAY),
    weekly: (date, n) => new Date(new Date(date).getTime() + 7 * n * DAY),
    monthly: addMonths,
};

/**
 * Due date for the next copy of a recurring task: the first occurrence after
 * `now`, so completing late never spawns a copy that is already overdue.
 * Returns null when the task does not recur.
 *
 * ponytail: anchored to this task's due date only. A series that clamped once
 * (31 Jan -> 28 Feb) continues from the 28th. Store an anchor day if that matters.
 */
const nextDueDate = (dueDate, recurrence, now = new Date()) => {
    const step = STEPS[recurrence];
    if (!step) return null;

    let n = 1;
    let next = step(dueDate, n);
    while (next <= now) next = step(dueDate, ++n);
    return next;
};

module.exports = { RECURRENCES, nextDueDate };
