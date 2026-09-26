# Review step, recurring tasks, overdue escalation — design

Date: 2026-09-26. Status: approved in chat.

## Why

Three gaps an office feels daily:

- "Completed" is set by the person who did the work; nobody signs it off.
- Repeating work (GST filing, weekly report, daily reconciliation) is re-created by hand.
- Heads only hear about a task when it is *completed*, never when it is stuck overdue.

## 1. Review step

**Data.** `Task.requiresReview: Boolean`, schema default `false` so existing tasks
behave exactly as today. The create form sends `true` by default (checkbox "Needs
approval", ticked). Status enum gains `In Review`. Notification type enum gains
`review` and `escalation`.

**Reviewer.** `canReview(user, task)` in `utils/scope.js` is true for:
an admin; anyone in `task.createdBy`; a head of a department containing at least
one assignee who is not the head themselves.

**Flow.**

| Actor | Action on a `requiresReview` task | Result |
|---|---|---|
| non-reviewer | status → Completed, or checklist reaches 100% | `In Review`; reviewers notified (`review`) |
| reviewer | status → Completed, or checklist reaches 100% | `Completed` directly |
| reviewer | `PUT /api/tasks/:id/review {action:"approve"}` | `Completed`; existing completion alerts |
| reviewer | `PUT /api/tasks/:id/review {action:"reject", note}` | `In Progress`; checklist untouched; `note` (if given) added as a comment by the reviewer; assignees notified |

`/review` returns 404 if the task is missing, 403 if the caller cannot review it,
400 if the task is not `In Review` or `action` is not approve/reject.

Tasks with `requiresReview: false` are unchanged: Completed means Completed.
`In Review` counts as "not completed" everywhere (overdue checks already use
`status != Completed`).

## 2. Recurring tasks

**Data.** `Task.recurrence: enum none|daily|weekly|monthly`, default `none`.
`Task.nextTask: ObjectId ref Task`, default `null`.

**Rule.** `utils/recurrence.js` exports `nextDueDate(dueDate, recurrence, now)`:
advance by 1 day / 7 days / 1 calendar month (clamped to month end, 31 Jan → 28/29
Feb), repeating until the result is after `now`. Pure function, unit-tested.

**Spawn.** Every transition into `Completed` goes through one helper,
`completeTask(task)` (sets progress 100, ticks checklist, `completedAt`), then
`spawnNext(task, actor)` after save. `spawnNext` does nothing unless
`recurrence != none` and `nextTask` is null. Otherwise it creates a copy — title,
description, category, priority, assignedTo, createdBy, attachments,
requiresReview, recurrence; checklist items copied with `completed: false`;
status Pending; progress 0; new due date — sets `task.nextTask`, and sends the
normal `assigned` notification. The `nextTask` guard makes spawning happen at
most once per task even if it is reopened and completed again.

Stopping a series: edit the task (or its latest copy) and set Repeat to "none".

## 3. Overdue escalation

Added to `scanDeadlines` in `utils/reminders.js`. For each task with
`status != Completed` and `dueDate < now - ESCALATE_AFTER_DAYS` (env, default 2):
recipients = `departmentHeadsOf(assignees)` ∪ `task.createdBy`, minus anyone who
already has an `escalation` notification for that task. One alert per person per
task, ever. `departmentHeadsOf(userIds)` moves into `utils/scope.js` and
`completionWatchers` reuses it.

## 4. Clients

**Web.** `In Review` added to status lists, tabs, colours and dashboard/analytics
counts. Create/edit form: "Needs approval" checkbox, "Repeat" select. Task detail:
reviewers see Approve and Send back (with note) while the task is In Review; a
"Repeats weekly"-style badge on recurring tasks.

**Mobile.** `In Review` gets a colour and appears in the status tabs. Approval
stays web-only (skipped until asked for).

## 5. Testing

- `server/test.smoke.js`: `nextDueDate` — daily/weekly/monthly, month-end clamp,
  late completion skips past dates.
- `server/test.integration.js`: member completes → In Review, reviewers notified;
  reject with note → In Progress + comment; approve → Completed; recurring task
  approve → exactly one next copy with unticked checklist and future due date,
  re-complete does not spawn again; reviewer completing directly skips review;
  escalation sent once to the department head, not repeated on the next scan.

## Out of scope

Mobile approval UI, custom intervals (every N weeks), fixed-schedule generation,
multi-level escalation to admins.
