// Run with: npm test   (plain Node, no device and no network)
import assert from 'node:assert';
import {
    toDayText, parseDay, quickDays, tabParams, formatMinutes, parseDuration, monthGrid, itemsByDay,
    mentionSuggestions, applyMention, mentionIds, fileLabel, fileId, isImageName,
} from '../src/lib/logic.js';

// --- dates ------------------------------------------------------------------
assert.strictEqual(toDayText(new Date(2026, 9, 7)), '2026-10-07');
assert.strictEqual(toDayText(new Date(2026, 0, 3)), '2026-01-03', 'zero padded');
assert.strictEqual(toDayText(parseDay('2026-10-07')), '2026-10-07', 'round trip');
assert.strictEqual(parseDay(''), null, 'blank is "no date"');
assert.strictEqual(parseDay('  '), null);
assert.strictEqual(parseDay('7/10/2026'), undefined, 'wrong shape is invalid');
assert.strictEqual(parseDay('2026-02-31'), undefined, 'a date JS would roll over is refused');
assert.strictEqual(parseDay('2026-13-01'), undefined);
assert.ok(parseDay('2028-02-29'), 'leap day is fine');
assert.strictEqual(parseDay('2027-02-29'), undefined);

const now = new Date(2026, 9, 7, 15, 30); // Wed 7 Oct 2026, 15:30 local
assert.deepStrictEqual(quickDays(now), [['Today', '2026-10-07'], ['Tomorrow', '2026-10-08'], ['Next week', '2026-10-14']]);
assert.deepStrictEqual(quickDays(new Date(2026, 11, 31)).map((q) => q[1]), ['2026-12-31', '2027-01-01', '2027-01-07'], 'crosses the year');

// --- My Work tabs -------------------------------------------------------------
const startToday = new Date(2026, 9, 7).getTime();
const today = tabParams('Today', now);
assert.strictEqual(today.open, 'true');
assert.strictEqual(new Date(today.dueAfter).getTime(), startToday, 'today starts at local midnight');
assert.strictEqual(new Date(today.dueBefore).getTime(), startToday + 86400000 - 1, '...and ends one millisecond before the next');
assert.strictEqual(new Date(tabParams('Upcoming', now).dueAfter).getTime(), startToday + 86400000, 'upcoming is from tomorrow');
assert.strictEqual(new Date(tabParams('Overdue', now).dueBefore).getTime(), startToday - 1, 'overdue is before today, so due-today is not overdue');
assert.deepStrictEqual(tabParams('Completed'), { status: 'Completed' });
assert.deepStrictEqual(tabParams('All'), {});

// --- durations (same as the web app) -----------------------------------------
assert.strictEqual(formatMinutes(205), '3h 25m');
assert.strictEqual(formatMinutes(60), '1h');
assert.strictEqual(formatMinutes(0), '0m');
assert.strictEqual(formatMinutes(undefined), '0m');
for (const [text, minutes] of [['4h', 240], ['1.5h', 90], ['3h 25m', 205], ['90m', 90], ['90', 90], [' 2H ', 120], ['', null]]) {
    assert.strictEqual(parseDuration(text), minutes, `parses "${text}"`);
}
for (const junk of ['abc', 'h', '1x', '-5', '1h30']) assert.ok(Number.isNaN(parseDuration(junk)), `rejects "${junk}"`);

// --- month grid ----------------------------------------------------------------
const grid = monthGrid(new Date(2026, 9, 15)); // October 2026 starts on a Thursday
assert.strictEqual(grid.length, 42);
assert.strictEqual(toDayText(grid[0]), '2026-09-28', 'starts on the Monday on or before the 1st');
assert.strictEqual(grid[0].getDay(), 1, 'a Monday');
assert.strictEqual(toDayText(grid[41]), '2026-11-08');
assert.strictEqual(monthGrid(new Date(2026, 5, 1))[0].getDay(), 1, 'a month that starts on Monday still starts on its own 1st');
assert.strictEqual(toDayText(monthGrid(new Date(2026, 5, 1))[0]), '2026-06-01');
assert.strictEqual(monthGrid(new Date(2026, 1, 10))[0].getDay(), 1, 'February too');

// --- calendar feed -> days -------------------------------------------------------
const feed = itemsByDay({
    tasks: [{ _id: 't1', title: 'Do it', dueDate: new Date(2026, 9, 7, 12).toISOString(), status: 'To Do', priority: 'High' }],
    projects: [{ _id: 'p1', name: 'Site', dueDate: new Date(2026, 9, 7, 12).toISOString() }],
    recurring: [{ taskId: 't2', title: 'Weekly', dueDate: new Date(2026, 9, 14, 12).toISOString(), priority: 'Low' }],
});
assert.deepStrictEqual(feed['2026-10-07'].map((i) => i.kind), ['project', 'task'], 'project deadlines come first');
assert.strictEqual(feed['2026-10-14'][0].kind, 'repeat');
assert.deepStrictEqual(itemsByDay(), {}, 'an empty feed is fine');
assert.deepStrictEqual(itemsByDay({}), {});

// --- @mentions -----------------------------------------------------------------
const people = [{ _id: 'a', name: 'Xena Notif' }, { _id: 'b', name: 'Xavier Dev' }, { _id: 'me', name: 'Me Myself' }];
assert.deepStrictEqual(mentionSuggestions('hi @X', people, 'me').map((p) => p._id), ['a', 'b']);
assert.deepStrictEqual(mentionSuggestions('hi @xe', people, 'me').map((p) => p._id), ['a'], 'case-insensitive prefix');
assert.deepStrictEqual(mentionSuggestions('@', people, 'me').map((p) => p._id), ['a', 'b'], 'a bare @ lists everyone but you');
assert.deepStrictEqual(mentionSuggestions('hi @Me', people, 'me'), [], 'never suggests yourself');
assert.deepStrictEqual(mentionSuggestions('mail a@b', people, 'me'), [], 'an @ inside a word is not a mention');
assert.deepStrictEqual(mentionSuggestions('hi there', people, 'me'), []);
assert.strictEqual(applyMention('hi @Xe', people[0]), 'hi @Xena Notif ');
assert.deepStrictEqual(mentionIds('hi @Xena Notif and @Xavier Dev!', people), ['a', 'b']);
assert.deepStrictEqual(mentionIds('hi Xena', people), [], 'no @, no mention');
assert.deepStrictEqual(mentionIds('hi @Xena Notif then deleted', []), []);

// --- files -----------------------------------------------------------------------
const id = 'a'.repeat(24);
assert.strictEqual(fileLabel(`/api/files/${id}/Site%20photo.png`), 'Site photo.png');
assert.strictEqual(fileLabel('/uploads/1743658911435-ff.png'), 'ff.png', 'old timestamp prefix is dropped');
assert.strictEqual(fileId(`/api/files/${id}/x.png`), id);
assert.strictEqual(fileId('https://example.com/x.png'), null, 'an outside link is not one of ours');
assert.strictEqual(isImageName('a.JPG'), true);
assert.strictEqual(isImageName('a.pdf'), false);

console.log('Mobile logic checks passed.');
