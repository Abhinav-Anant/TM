# Review Step, Recurring Tasks & Overdue Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks can require sign-off (In Review → approve / send back), can repeat daily/weekly/monthly, and overdue tasks escalate to department heads.

**Architecture:** All state changes stay in `server/controller/task.controller.js`, funnelled through two helpers (`markCompleted`, `afterStatusChange`) so every path into Completed sends the same alerts and spawns the next recurring copy exactly once. Pure date logic lives in `server/utils/recurrence.js`; permission logic (`canReview`, `departmentHeadsOf`) in `server/utils/scope.js`; escalation piggybacks on the existing reminder scan.

**Tech Stack:** Node/Express, Mongoose 8, React (Vite, Tailwind), Expo. Tests: `npm test` (assert-based smoke, no DB) and `npm run test:e2e` (in-memory Mongo, real server).

**Spec:** `docs/superpowers/specs/2026-09-26-review-recurrence-escalation-design.md`

## Global Constraints

- No new dependencies (server, client or mobile).
- `Task.requiresReview` schema default is `false` — existing tasks and existing tests keep today's behaviour. Only the web create form defaults it to `true`.
- Status values: `Pending`, `In Progress`, `In Review`, `Completed`. Clients may only *request* `Pending`, `In Progress`, `Completed` via `PUT /:id/status`; `In Review` is set by the server.
- Recurrence values: `none`, `daily`, `weekly`, `monthly`.
- Notification types added: `review`, `escalation`.
- Env: `ESCALATE_AFTER_DAYS` (default `2`).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run commands from the repo root.

## File map

| File | Change |
|---|---|
| `server/utils/recurrence.js` | **new** — `RECURRENCES`, `nextDueDate()` |
| `server/utils/scope.js` | add `departmentHeadsOf()`, `canReview()` |
| `server/model/task.model.js` | status enum, `requiresReview`, `recurrence`, `nextTask` |
| `server/model/notification.model.js` | type enum |
| `server/controller/task.controller.js` | review flow, `/review`, spawn, counts |
| `server/routes/task.route.js` | `PUT /:id/review` |
| `server/utils/reminders.js` | `scanEscalations()` |
| `server/test.smoke.js`, `server/test.integration.js` | tests |
| `client/src/utils/data.js`, `apiPaths.js`, `hooks/useTaskList.jsx`, `pages/Admin/CreateTask.jsx`, `pages/User/ViewTaskDetails.jsx`, `pages/Admin/Dashboard.jsx`, `pages/User/UserDashboard.jsx` | UI |
| `mobile/src/theme.js`, `mobile/src/screens/TasksScreen.js` | In Review colour + tab |
| `README.md`, `.env.example` | docs |

---

### Task 1: Recurrence date rule

**Files:**
- Create: `server/utils/recurrence.js`
- Test: `server/test.smoke.js`

**Interfaces:**
- Produces: `RECURRENCES: string[]` = `["none","daily","weekly","monthly"]`; `nextDueDate(dueDate: Date|string, recurrence: string, now?: Date): Date|null` — `null` for `none`/unknown.

- [ ] **Step 1: Write the failing test.** In `server/test.smoke.js` add to the requires at the top:

```js
const { nextDueDate, RECURRENCES } = require("./utils/recurrence.js");
```

and insert this block just before `// --- SSE registry ---`:

```js
// --- recurrence -----------------------------------------------------------
{
    const at = (s) => new Date(s);
    const before = at("2026-01-05T00:00:00Z");
    const iso = (d) => d.toISOString().slice(0, 10);

    assert.deepStrictEqual(RECURRENCES, ["none", "daily", "weekly", "monthly"]);
    assert.strictEqual(nextDueDate(at("2026-01-10T00:00:00Z"), "none", before), null);
    assert.strictEqual(nextDueDate(at("2026-01-10T00:00:00Z"), "bogus", before), null);

    assert.strictEqual(iso(nextDueDate(at("2026-01-10T00:00:00Z"), "daily", before)), "2026-01-11");
    assert.strictEqual(iso(nextDueDate(at("2026-01-10T00:00:00Z"), "weekly", before)), "2026-01-17");
    assert.strictEqual(iso(nextDueDate(at("2026-01-10T00:00:00Z"), "monthly", before)), "2026-02-10");

    // Month end clamps instead of spilling into the next month.
    assert.strictEqual(iso(nextDueDate(at("2026-01-31T00:00:00Z"), "monthly", before)), "2026-02-28");
    assert.strictEqual(iso(nextDueDate(at("2028-01-31T00:00:00Z"), "monthly", at("2028-01-01"))), "2028-02-29", "leap year");

    // Completed late: skip ahead until the date is in the future, never spawn an overdue copy.
    assert.strictEqual(
        iso(nextDueDate(at("2026-01-10T00:00:00Z"), "daily", at("2026-01-15T10:00:00Z"))), "2026-01-16");
    // Skipping stays anchored to the original day: 31 Jan -> 31 Mar, not 28 Mar.
    assert.strictEqual(
        iso(nextDueDate(at("2026-01-31T00:00:00Z"), "monthly", at("2026-03-05T00:00:00Z"))), "2026-03-31");
    // String input (as stored JSON) works too.
    assert.strictEqual(iso(nextDueDate("2026-01-10T00:00:00.000Z", "weekly", before)), "2026-01-17");
}
```

- [ ] **Step 2: Run it to see it fail.** Run: `npm test` — Expected: `Cannot find module './utils/recurrence.js'`.

- [ ] **Step 3: Implement.** Create `server/utils/recurrence.js`:

```js
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
```

- [ ] **Step 4: Run it to see it pass.** Run: `npm test` — Expected: `All smoke checks passed.`

- [ ] **Step 5: Commit.**

```bash
git add server/utils/recurrence.js server/test.smoke.js
git commit -m "Add the due-date rule for recurring tasks"
```

---

### Task 2: Schema + permission helpers

**Files:**
- Modify: `server/model/task.model.js`, `server/model/notification.model.js`, `server/utils/scope.js`
- Modify: `server/controller/task.controller.js` (`completionWatchers` only)

**Interfaces:**
- Consumes: `RECURRENCES` from Task 1.
- Produces: `departmentHeadsOf(userIds): Promise<ObjectId[]>`; `canReview(user, task): Promise<boolean>` (both exported from `utils/scope.js`). Task fields `requiresReview`, `recurrence`, `nextTask`.

- [ ] **Step 1: Task model.** In `server/model/task.model.js` add `const { RECURRENCES } = require('../utils/recurrence.js');` below the mongoose require, change the status enum and add fields after `completedAt`:

```js
    status: { 
        type: String, 
        enum: ['Pending', 'In Progress', 'In Review', 'Completed'], 
        default: 'Pending' 
    },
```

```js
    // Off by default so tasks created before the review step behave as before;
    // the web form opts new tasks in.
    requiresReview: { type: Boolean, default: false },
    recurrence: { type: String, enum: RECURRENCES, default: 'none' },
    // The copy spawned when this one completed. Doubles as the "already spawned"
    // guard, so reopening and re-completing never creates a second copy.
    nextTask: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
```

- [ ] **Step 2: Notification model.** In `server/model/notification.model.js`:

```js
        enum: ['assigned', 'updated', 'status', 'comment', 'deadline', 'overdue', 'review', 'escalation'],
```

- [ ] **Step 3: Scope helpers.** In `server/utils/scope.js`, above `modulesFor`, add:

```js
/** Everyone who heads a department that any of `userIds` belongs to. */
const departmentHeadsOf = async (userIds) => {
    const users = await User.find({ _id: { $in: (userIds || []).map(idStr) } }).select('memberships').lean();
    const departments = [...new Set(
        users.flatMap((user) => (user.memberships || []).map((m) => idStr(m.department)))
    )];
    if (!departments.length) return [];

    // `head: true` matters: a head who is merely a rep in a department does not oversee it.
    const heads = await User.find({
        memberships: { $elemMatch: { department: { $in: departments }, head: true } },
    }).select('_id').lean();
    return heads.map((head) => head._id);
};

/**
 * May `user` sign off a task that needs review? An admin, the task's creator,
 * or the head of an assignee's department - but never someone approving work
 * only they were assigned.
 */
const canReview = async (user, task) => {
    if (user.role === "admin") return true;
    const me = idStr(user._id);
    if ((task.createdBy || []).map(idStr).includes(me)) return true;

    const others = (task.assignedTo || []).map(idStr).filter((id) => id !== me);
    if (!others.length) return false;
    return (await departmentHeadsOf(others)).map(idStr).includes(me);
};
```

and export both: add `departmentHeadsOf, canReview,` to `module.exports`.

- [ ] **Step 4: Reuse in completionWatchers.** In `server/controller/task.controller.js` import `departmentHeadsOf` from scope and replace the body of `completionWatchers`:

```js
const completionWatchers = async (task) => {
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    return [
        ...watchersOf(task),
        ...admins.map((admin) => admin._id),
        ...await departmentHeadsOf(task.assignedTo),
    ];
};
```

(keep the existing doc comment above it).

- [ ] **Step 5: Run both suites.** Run: `npm test && npm run test:e2e` — Expected: both pass unchanged (this task only adds fields with backwards-compatible defaults and refactors `completionWatchers`; the "Completion escalation" e2e group proves the refactor).

- [ ] **Step 6: Commit.**

```bash
git add server/model server/utils/scope.js server/controller/task.controller.js
git commit -m "Add review, recurrence and escalation fields and the reviewer check"
```

---

### Task 3: Review flow + recurring spawn on the server

**Files:**
- Modify: `server/controller/task.controller.js`, `server/routes/task.route.js`
- Test: `server/test.smoke.js`, `server/test.integration.js`

**Interfaces:**
- Consumes: `canReview`, `departmentHeadsOf` (Task 2); `RECURRENCES`, `nextDueDate` (Task 1).
- Produces: `PUT /api/tasks/:id/review` body `{ action: "approve"|"reject", note?: string }` → `{ message, task }` (task populated like the checklist endpoint). `GET /api/tasks/:id` gains `canReview: boolean`. `GET /api/tasks` `statusSummary.inReviewTasks`. `GET /dashboard-data` `data.inReviewTasksCount`. `GET /user-dashboard-data` `charts.taskDistribution.InReview`. `syncProgress(task, { needsReview })`.

- [ ] **Step 1: Failing smoke test for syncProgress.** In `server/test.smoke.js`, after the existing empty-checklist block (the one asserting `"Pending"` for `todoChecklist: []`), add:

```js
{
    // A task that needs sign-off stops at In Review, and is not stamped completed.
    const task = { todoChecklist: [{ completed: true }] };
    syncProgress(task, { needsReview: true });
    assert.strictEqual(task.status, "In Review");
    assert.strictEqual(task.progress, 100);
    assert.strictEqual(task.completedAt, null);
}
```

Run: `npm test` — Expected: FAIL (`'Completed' !== 'In Review'`).

- [ ] **Step 2: Failing e2e test.** In `server/test.integration.js`, directly after the line `pass("Completion escalation", ...)`, insert:

```js
        // ---------- REVIEW STEP + RECURRING TASKS ----------
        const SM = salesMember.token;
        const gst = (await call("POST", "/api/tasks", {
            token: A,
            body: {
                title: "File the GST return", dueDate: day(6), assignedTo: [salesMember._id],
                requiresReview: true, recurrence: "monthly",
                todoChecklist: [{ text: "collect invoices", completed: false }],
            },
        })).body.task;
        assert.strictEqual(gst.requiresReview, true);
        assert.strictEqual(gst.recurrence, "monthly");
        assert.strictEqual(
            (await call("POST", "/api/tasks", { token: A, body: { title: "bad", dueDate: day(1), assignedTo: [], recurrence: "hourly" } })).status,
            400, "unknown recurrence is rejected");

        // The assignee finishing sends it for review, not to Completed.
        let r = await call("PUT", `/api/tasks/${gst._id}/status`, { token: SM, body: { status: "Completed" } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.updatedTask.status, "In Review");
        assert.strictEqual(r.body.updatedTask.completedAt, null);
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/status`, { token: SM, body: { status: "In Review" } })).status,
            400, "In Review is set by the server, not requested");

        let reviewAlerts = [];
        for (let i = 0; i < 10; i += 1) {
            await sleep(300);
            reviewAlerts = (await call("GET", "/api/notifications?limit=100", { token: H }))
                .body.notifications.filter((n) => n.type === "review" && /File the GST return/.test(n.title));
            if (reviewAlerts.length) break;
        }
        assert.strictEqual(reviewAlerts.length, 1, "the assignee's head is asked to review");

        assert.strictEqual((await call("GET", `/api/tasks/${gst._id}`, { token: H })).body.canReview, true);
        assert.strictEqual((await call("GET", `/api/tasks/${gst._id}`, { token: SM })).body.canReview, false);
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/review`, { token: SM, body: { action: "approve" } })).status,
            403, "nobody approves their own work");
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/review`, { token: H, body: { action: "maybe" } })).status,
            400, "unknown review action");

        // Send back with a note: back to In Progress, note lands as a comment.
        r = await call("PUT", `/api/tasks/${gst._id}/review`, { token: H, body: { action: "reject", note: "Attach the challan" } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.task.status, "In Progress");
        assert.strictEqual(r.body.task.comments.at(-1).text, "Attach the challan");
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/review`, { token: H, body: { action: "approve" } })).status,
            400, "only a task in review can be approved");

        // Resubmitting through the checklist also stops at In Review.
        r = await call("PUT", `/api/tasks/${gst._id}/todo`, {
            token: SM, body: { todoChecklist: [{ text: "collect invoices", completed: true }] },
        });
        assert.strictEqual(r.body.task.status, "In Review");

        // Approve: Completed, and exactly one next copy.
        r = await call("PUT", `/api/tasks/${gst._id}/review`, { token: A, body: { action: "approve" } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.task.status, "Completed");
        assert.ok(r.body.task.completedAt, "approval stamps completedAt");
        const nextId = r.body.task.nextTask;
        assert.ok(nextId, "a recurring task spawns its next copy on completion");

        const next = (await call("GET", `/api/tasks/${nextId}`, { token: A })).body;
        assert.strictEqual(next.title, "File the GST return");
        assert.strictEqual(next.status, "Pending");
        assert.strictEqual(next.recurrence, "monthly");
        assert.strictEqual(next.requiresReview, true);
        assert.ok(next.todoChecklist.length === 1 && next.todoChecklist.every((t) => !t.completed), "checklist starts unticked");
        assert.ok(new Date(next.dueDate) > new Date(gst.dueDate), "next copy is due later");

        // Reopen and complete again: a reviewer completes directly, and no second copy appears.
        await call("PUT", `/api/tasks/${gst._id}/status`, { token: A, body: { status: "In Progress" } });
        r = await call("PUT", `/api/tasks/${gst._id}/status`, { token: A, body: { status: "Completed" } });
        assert.strictEqual(r.body.updatedTask.status, "Completed", "a reviewer skips their own review");
        assert.strictEqual(String(r.body.updatedTask.nextTask), String(nextId));
        const copies = (await call("GET", "/api/tasks?search=File%20the%20GST%20return", { token: A })).body.tasks;
        assert.strictEqual(copies.length, 2, "re-completing never spawns a second copy");

        const summary = (await call("GET", "/api/tasks", { token: A })).body.statusSummary;
        assert.strictEqual(typeof summary.inReviewTasks, "number", "In Review has its own tab count");
        pass("Review step & recurrence", "submit->review->send back->resubmit->approve; one next copy; reviewer completes directly");
```

Run: `npm run test:e2e` — Expected: FAIL at `requiresReview` (field not saved by `createTask`).

- [ ] **Step 3: Implement the controller.** In `server/controller/task.controller.js`:

(a) Imports at the top:

```js
const mongoose = require('mongoose');
const { scopeFor, canAccessTask, canAssignTo, canReview, departmentHeadsOf, departmentMemberIds, headedDepartmentIds } = require('../utils/scope.js');
const { RECURRENCES, nextDueDate } = require('../utils/recurrence.js');
```

(b) Below `completionWatchers`, add the shared helpers:

```js
// What a client may ask for. In Review is the server's answer to "Completed"
// on a task that needs sign-off, never a request.
const REQUESTABLE_STATUSES = ["Pending", "In Progress", "Completed"];

/** Whoever can sign off this task: its creator and the assignees' heads. */
const reviewersOf = async (task) => [
    ...(task.createdBy || []),
    ...await departmentHeadsOf(task.assignedTo),
];

/** Ticks everything and stamps completion. Every path into Completed goes through here. */
const markCompleted = (task) => {
    task.todoChecklist.forEach((item) => { item.completed = true; });
    task.progress = 100;
    task.status = "Completed";
    task.completedAt = task.completedAt || new Date();
};

/**
 * Creates the next copy of a recurring task, at most once per task.
 * The conditional update claims the slot before the copy exists, so two
 * completions racing each other cannot both spawn.
 */
const spawnNext = async (task) => {
    if (!task.recurrence || task.recurrence === "none" || task.nextTask) return null;

    const nextId = new mongoose.Types.ObjectId();
    const claim = await Task.updateOne({ _id: task._id, nextTask: null }, { $set: { nextTask: nextId } });
    if (!claim.modifiedCount) return null;
    task.nextTask = nextId;

    const next = await Task.create({
        _id: nextId,
        title: task.title,
        description: task.description,
        category: task.category,
        priority: task.priority,
        dueDate: nextDueDate(task.dueDate, task.recurrence),
        assignedTo: task.assignedTo,
        createdBy: task.createdBy,
        attachments: task.attachments,
        todoChecklist: task.todoChecklist.map((item) => ({ text: item.text, completed: false })),
        requiresReview: task.requiresReview,
        recurrence: task.recurrence,
        lead: task.lead,
    });

    // No actor: the person who completed the last one still needs to hear about the next.
    await notify({
        userIds: next.assignedTo,
        type: "assigned",
        task: next._id,
        title: `New task: ${next.title}`,
        message: `"${next.title}" repeats ${next.recurrence}; the next one is due ${new Date(next.dueDate).toDateString()}.`,
    });
    return next;
};

/** Alerts (and the recurring spawn) for a status transition that has already been saved. */
const afterStatusChange = async (task, previousStatus, actor) => {
    if (previousStatus === task.status) return;

    if (task.status === "Completed") {
        await notify({
            userIds: await completionWatchers(task),
            actor,
            type: "status",
            task: task._id,
            title: `${task.title} is now Completed`,
            message: `${actor.name} moved "${task.title}" from ${previousStatus} to Completed.`,
        });
        await spawnNext(task);
    } else if (task.status === "In Review") {
        await notify({
            userIds: await reviewersOf(task),
            actor,
            type: "review",
            task: task._id,
            title: `Review: ${task.title}`,
            message: `${actor.name} finished "${task.title}" and it is waiting for your approval.`,
        });
    } else {
        await notify({
            userIds: watchersOf(task),
            actor,
            type: "status",
            task: task._id,
            title: `${task.title} is now ${task.status}`,
            message: `${actor.name} moved "${task.title}" from ${previousStatus} to ${task.status}.`,
        });
    }
};

const populateTask = (id) => Task.findById(id)
    .populate("assignedTo", "name email profileImageUrl")
    .populate("comments.user", "name email profileImageUrl");
```

(c) `createTask`: destructure `requiresReview, recurrence` from `req.body`; after the `assignedTo` array check add

```js
        if (recurrence !== undefined && !RECURRENCES.includes(recurrence)) {
            return res.status(400).json({ message: `recurrence must be one of ${RECURRENCES.join(", ")}` });
        }
```

and add to `Task.create({...})`:

```js
            requiresReview: Boolean(requiresReview),
            recurrence: recurrence || "none",
```

(d) `updateTask`: after `task.attachments = ...` add

```js
        if (typeof req.body.requiresReview === "boolean") task.requiresReview = req.body.requiresReview;
        if (req.body.recurrence !== undefined) {
            if (!RECURRENCES.includes(req.body.recurrence)) {
                return res.status(400).json({ message: `recurrence must be one of ${RECURRENCES.join(", ")}` });
            }
            task.recurrence = req.body.recurrence;
        }
```

(e) Replace `syncProgress`:

```js
/** Recomputes progress + status from the checklist. A finished task that needs sign-off stops at In Review. */
const syncProgress = (task, { needsReview = false } = {}) => {
    const total = task.todoChecklist.length;
    const done = task.todoChecklist.filter((item) => item.completed).length;
    task.progress = total > 0 ? Math.round((done / total) * 100) : 0;

    if (total > 0 && task.progress === 100) task.status = needsReview ? "In Review" : "Completed";
    else if (task.progress > 0) task.status = "In Progress";
    else task.status = "Pending";

    task.completedAt = task.status === "Completed" ? (task.completedAt || new Date()) : null;
};
```

(f) `updateTaskCheckList`: replace from `const wasCompleted = ...` through the closing of the `if (!wasCompleted ...)` block and the `updatedTask` fetch with:

```js
        const previousStatus = task.status;
        task.todoChecklist = todoChecklist;
        syncProgress(task, { needsReview: task.requiresReview && !await canReview(req.user, task) });
        await task.save();

        // Ticking boxes is routine; only finishing (or submitting for review) is news.
        if (["Completed", "In Review"].includes(task.status)) {
            await afterStatusChange(task, previousStatus, req.user);
        }

        const updatedTask = await populateTask(req.params.id);
```

(g) `updateTaskStatus`: replace everything from `const previousStatus = task.status;` to just before `res.json(...)` with:

```js
        const wanted = req.body.status;
        if (!REQUESTABLE_STATUSES.includes(wanted)) {
            return res.status(400).json({ message: `status must be one of ${REQUESTABLE_STATUSES.join(", ")}` });
        }

        const previousStatus = task.status;

        if (wanted === "Completed") {
            markCompleted(task);
            if (task.requiresReview && !await canReview(req.user, task)) {
                task.status = "In Review";
                task.completedAt = null;
            }
        } else {
            task.status = wanted;
            const total = task.todoChecklist.length;
            const done = task.todoChecklist.filter((item) => item.completed).length;
            task.progress = total ? Math.round((done / total) * 100) : 0;
            task.completedAt = null;
        }

        const updatedTask = await task.save();
        await afterStatusChange(task, previousStatus, req.user);
```

(h) Add the review handler after `updateTaskStatus`:

```js
/** Approve or send back a task waiting in review. */
const reviewTask = async (req, res) => {
    try {
        const { action } = req.body;
        if (!["approve", "reject"].includes(action)) {
            return res.status(400).json({ message: "action must be approve or reject" });
        }

        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }
        if (!await canReview(req.user, task)) {
            return res.status(403).json({ message: "Not authorized to review this task" });
        }
        if (task.status !== "In Review") {
            return res.status(400).json({ message: "This task is not waiting for review" });
        }

        if (action === "approve") {
            markCompleted(task);
            await task.save();
            await afterStatusChange(task, "In Review", req.user);
        } else {
            const note = String(req.body.note || "").trim().slice(0, 2000);
            task.status = "In Progress";
            task.completedAt = null;
            if (note) task.comments.push({ user: req.user._id, text: note });
            await task.save();

            await notify({
                userIds: task.assignedTo,
                actor: req.user,
                type: "review",
                task: task._id,
                title: `Sent back: ${task.title}`,
                message: `${req.user.name} sent "${task.title}" back` + (note ? `: ${note}` : "."),
            });
        }

        res.json({
            message: action === "approve" ? "Task approved" : "Task sent back",
            task: await populateTask(task._id),
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
```

(i) `getTaskById`: replace `res.json(task);` with

```js
        // The client shows Approve / Send back from this; the /review route re-checks.
        res.json({ ...task.toObject(), canReview: await canReview(req.user, task) });
```

(j) Counts. `getTasks`:

```js
        const [allTasks, pendingTasks, inProgressTasks, inReviewTasks, completedTasks] = await Promise.all([
            Task.countDocuments(base),
            countByStatus("Pending"),
            countByStatus("In Progress"),
            countByStatus("In Review"),
            countByStatus("Completed"),
        ]);
```

and `statusSummary: { all: allTasks, pendingTasks, inProgressTasks, inReviewTasks, completedTasks },`.

`getDashboardData`: add `inReviewTasksCount` to the destructure after `inProgressTasksCount`, add `Task.countDocuments({ ...scope, status: 'In Review' }),` at the matching position in `Promise.all`, and `inReviewTasksCount,` to the `data` object.

`getUserDashboardData`: `const statusSummary = { Pending: 0, InProgress: 0, InReview: 0, Completed: 0 };` and add `else if (task.status === "In Review") statusSummary.InReview += 1;`.

(k) Export `reviewTask` in `module.exports` (next to `updateTaskStatus`).

- [ ] **Step 4: Route.** In `server/routes/task.route.js` import `reviewTask` and add after the `/:id/status` line:

```js
router.put('/:id/review', protect, reviewTask);
```

- [ ] **Step 5: Run both suites.** Run: `npm test && npm run test:e2e` — Expected: all pass, including the new "Review step & recurrence" group.

- [ ] **Step 6: Commit.**

```bash
git add server/controller/task.controller.js server/routes/task.route.js server/test.smoke.js server/test.integration.js
git commit -m "Route finished tasks through review and respawn recurring ones"
```

---

### Task 4: Overdue escalation

**Files:**
- Modify: `server/utils/reminders.js`, `.env.example`
- Test: `server/test.integration.js`

**Interfaces:**
- Consumes: `departmentHeadsOf` (Task 2).
- Produces: `scanEscalations(now?: Date): Promise<number>` exported from `utils/reminders.js`.

- [ ] **Step 1: Failing e2e test.** In `server/test.integration.js`, directly after `pass("Review step & recurrence", ...)`, insert:

```js
        // ---------- OVERDUE ESCALATION ----------
        const stuck = (await call("POST", "/api/tasks", {
            token: A, body: { title: "Stuck vendor payment", dueDate: day(-5), assignedTo: [salesMember._id] },
        })).body.task;
        const escalationsFor = async (token) => (await call("GET", "/api/notifications?limit=100", { token }))
            .body.notifications.filter((n) => n.type === "escalation" && String(n.task?._id || n.task) === stuck._id);

        let headEsc = [];
        for (let i = 0; i < 20; i += 1) {
            await sleep(1000);
            headEsc = await escalationsFor(H);
            if (headEsc.length) break;
        }
        assert.strictEqual(headEsc.length, 1, "the assignee's head hears about a task stuck overdue");
        assert.strictEqual((await escalationsFor(A)).length, 1, "so does the creator");
        assert.strictEqual((await escalationsFor(SM)).length, 0, "the assignee already gets the overdue alert");

        await sleep(4000);
        assert.strictEqual((await escalationsFor(H)).length, 1, "escalation is sent once, not every scan");
        pass("Overdue escalation", "head + creator alerted once when a task is 2+ days overdue");
```

Run: `npm run test:e2e` — Expected: FAIL `the assignee's head hears about a task stuck overdue`.

- [ ] **Step 2: Implement.** In `server/utils/reminders.js`:

Add below the existing requires:

```js
const { departmentHeadsOf } = require('./scope.js');
```

Add below `INTERVAL_MINUTES`:

```js
const DAY = 24 * 60 * MINUTE;
const ESCALATE_AFTER_DAYS = Number(process.env.ESCALATE_AFTER_DAYS ?? 2);
```

Add after `scanDeadlines`:

```js
/**
 * Tasks still open ESCALATE_AFTER_DAYS past their due date go over the
 * assignees' heads: the department heads and the task's creator hear about it,
 * once each per task. The assignees already had their own overdue alert.
 */
const scanEscalations = async (now = new Date()) => {
    const cutoff = new Date(now.getTime() - ESCALATE_AFTER_DAYS * DAY);
    const tasks = await Task.find({ status: { $ne: "Completed" }, dueDate: { $lt: cutoff } })
        .select("title dueDate assignedTo createdBy");

    let sentCount = 0;

    for (const task of tasks) {
        const alreadyAlerted = new Set(
            (await Notification.find({ task: task._id, type: "escalation" }).distinct("user")).map(String)
        );
        const recipients = [...await departmentHeadsOf(task.assignedTo), ...(task.createdBy || [])].map(String);
        const targets = [...new Set(recipients)].filter((id) => !alreadyAlerted.has(id));
        if (targets.length === 0) continue;

        const days = Math.floor((now - task.dueDate) / DAY);
        await notify({
            userIds: targets,
            type: "escalation",
            task: task._id,
            title: `Escalation: ${task.title}`,
            message: `"${task.title}" is ${days} days overdue (due ${formatDate(task.dueDate)}) and still open.`,
        });
        sentCount += targets.length;
    }

    return sentCount;
};
```

In `startReminders`, change `run` to:

```js
    const run = () => scanDeadlines()
        .then(() => scanEscalations())
        .catch((err) => console.error("Reminder scan failed:", err.message));
```

and export: `module.exports = { startReminders, scanDeadlines, scanEscalations };`

Append to `.env.example`:

```
# Days overdue before department heads and the task creator are alerted (default 2)
ESCALATE_AFTER_DAYS=2
```

- [ ] **Step 3: Run both suites.** Run: `npm test && npm run test:e2e` — Expected: all pass.

- [ ] **Step 4: Commit.**

```bash
git add server/utils/reminders.js server/test.integration.js .env.example
git commit -m "Escalate tasks stuck overdue to department heads"
```

---

### Task 5: Web client

**Files:**
- Modify: `client/src/utils/data.js`, `client/src/utils/apiPaths.js`, `client/src/hooks/useTaskList.jsx`, `client/src/pages/Admin/CreateTask.jsx`, `client/src/pages/User/ViewTaskDetails.jsx`, `client/src/pages/Admin/Dashboard.jsx`, `client/src/pages/User/UserDashboard.jsx`

**Interfaces:**
- Consumes: Task 3 API (`/review`, `canReview`, `inReviewTasks`, `inReviewTasksCount`, `InReview`).

- [ ] **Step 1: Shared data.** In `client/src/utils/data.js`:
  - `STATUS_DATA`: insert `{ label: "In Review", value: "In Review" },` after In Progress.
  - Add after `STATUS_DATA`:

```js
export const RECURRENCE_DATA = [
  { label: "Does not repeat", value: "none" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
];
```

  - `statusChip`: add `"In Review": "chip-signal",`; `statusFill`: `"In Review": "bg-signal",`; `statusText`: `"In Review": "text-signal",`.

- [ ] **Step 2: API path.** In `client/src/utils/apiPaths.js` under `TASKS`, after `UPDATE_TASK_STATUS`:

```js
        REVIEW_TASK: (taskId) => `/api/tasks/${taskId}/review`, // { action: approve|reject, note }
```

- [ ] **Step 3: Tabs and dashboards.**
  - `useTaskList.jsx`: after the In Progress tab add `{ label: "In Review", count: summary.inReviewTasks || 0 },`.
  - `pages/Admin/Dashboard.jsx` line ~46: after the In Progress entry add `{ status: 'In Review', count: d.inReviewTasksCount || 0 },`.
  - `pages/User/UserDashboard.jsx` line ~38: after the In Progress entry add `{ status: 'In Review', count: taskDistribution.InReview || 0 },`.

- [ ] **Step 4: Create/edit form.** In `pages/Admin/CreateTask.jsx`:
  - Import `RECURRENCE_DATA` alongside `PRIORITY_DATA`.
  - In the initial `useState` and in `clearData`, add `requiresReview: true, recurrence: "none",`.
  - In `getTaskDetailsById`'s `setTaskData`, add `requiresReview: Boolean(response.data.requiresReview), recurrence: response.data.recurrence || "none",`.
  - After the Due date `<div>`, add:

```jsx
              <div>
                <span className="field-label">Repeat</span>
                <SelectDropdown
                  options={RECURRENCE_DATA}
                  value={taskData.recurrence}
                  onChange={(value) => handleValueChange("recurrence", value)}
                  placeholder="Does not repeat"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-beam cursor-pointer self-end pb-2">
                <input
                  type="checkbox"
                  checked={taskData.requiresReview}
                  onChange={({ target }) => handleValueChange("requiresReview", target.checked)}
                />
                Needs approval before it counts as done
              </label>
```

  - When editing a task that is waiting for review, point the reviewer at the page with the buttons. Right after the page heading block (inside the panel, above the Title field), add:

```jsx
            {currentTask?.status === "In Review" && (
              <Link to={`/user/task-details/${taskId}`} className="block text-sm text-signal mb-4">
                This task is waiting for review. Open it to approve or send it back.
              </Link>
            )}
```

    and add `Link` to the existing `react-router-dom` import.

- [ ] **Step 5: Review panel on task details.** In `pages/User/ViewTaskDetails.jsx`:
  - Add `import toast from 'react-hot-toast';` and add `LuRepeat` to the `react-icons/lu` import.
  - In the component add state and handler:

```jsx
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);

  // The server re-checks permission; canReview only decides whether to show the buttons.
  const review = async (action) => {
    setReviewing(true);
    try {
      const { data } = await axiosInstance.put(API_PATHS.TASKS.REVIEW_TASK(id), { action, note: reviewNote });
      setTask({ ...data.task, canReview: task.canReview });
      setReviewNote("");
      toast.success(action === "approve" ? "Approved" : "Sent back");
    } catch (error) {
      toast.error(error.response?.data?.message || "That did not go through.");
    } finally {
      setReviewing(false);
    }
  };
```

  - In `updateTodoChecklist`, keep `canReview` across the refresh: replace `setTask(response.data?.task || task);` with `setTask((prev) => ({ ...(response.data?.task || prev), canReview: prev.canReview }));`.
  - Next to the status chip in the header, add the recurring badge:

```jsx
                {task.recurrence && task.recurrence !== "none" && (
                  <span className="chip chip-mist flex items-center gap-1"><LuRepeat /> Repeats {task.recurrence}</span>
                )}
```

  - At the top of the `<aside>`, before the Progress block:

```jsx
          {task.status === "In Review" && task.canReview && (
            <div className="space-y-3">
              <p className="field-label">Waiting for your review</p>
              <textarea
                className="field"
                rows={3}
                placeholder="Note for the assignee (sent with Send back)"
                value={reviewNote}
                onChange={({ target }) => setReviewNote(target.value)}
              />
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={reviewing} onClick={() => review("approve")}>Approve</button>
                <button className="btn" disabled={reviewing} onClick={() => review("reject")}>Send back</button>
              </div>
            </div>
          )}
          {task.status === "In Review" && !task.canReview && (
            <p className="text-sm text-signal">Submitted. Waiting for approval.</p>
          )}
```

  (`btn` / `btn btn-primary` are the app's existing button classes in `client/src/index.css`.)

- [ ] **Step 6: Build + lint.** Run: `npm run build --prefix client` — Expected: build succeeds. Run: `npm run lint --prefix client` — Expected: no new errors in the touched files.

- [ ] **Step 7: Manual check in the browser.** Start the server (`npm run dev`) and client (`npm run dev --prefix client`), then: create a task with Needs approval + Repeat weekly as an admin, assigned to a member; log in as the member, tick the checklist to 100% → status chip shows In Review and "Waiting for approval"; log in as the admin, open the task from the notification → Send back with a note → comment appears, status In Progress; member re-ticks → admin Approves → Completed, and a new Pending copy with a later due date shows in Manage Tasks; the In Review tab count is right.

- [ ] **Step 8: Commit.**

```bash
git add client/src
git commit -m "Show In Review, the approval panel and the repeat option in the web app"
```

---

### Task 6: Mobile + docs

**Files:**
- Modify: `mobile/src/theme.js`, `mobile/src/screens/TasksScreen.js`, `README.md`

- [ ] **Step 1: Mobile.** In `mobile/src/theme.js` add `'In Review': '#FFB020',` after `'In Progress'`. In `mobile/src/screens/TasksScreen.js`:

```js
const STATUS_TABS = ['All', 'Pending', 'In Progress', 'In Review', 'Completed'];
```

  Check whether the mobile task detail screen sends `status: "Completed"` anywhere (`grep -n "status" mobile/src/screens/TaskDetailScreen.js`); no change is needed since the server now turns that into In Review, but confirm the screen renders the returned status rather than assuming Completed.

- [ ] **Step 2: README.** In `README.md`, under "✅ Roadmap – Delivered", add:

```md
- [x] **Review step:** Tasks can require sign-off - finished work waits In Review until the creator or department head approves or sends it back
- [x] **Recurring tasks:** Daily / weekly / monthly; the next copy is created when the current one is completed
- [x] **Overdue escalation:** Department heads and the creator are alerted once when a task is `ESCALATE_AFTER_DAYS` (default 2) overdue
```

and add three rows to the "How each one works" table:

```md
| **Review step** | `Task.requiresReview` (web form defaults it on). A non-reviewer finishing the task (status or checklist) moves it to `In Review` and alerts the creator + assignees' heads. `PUT /api/tasks/:id/review {action: approve|reject, note}` - approve completes it, reject returns it to In Progress with the note as a comment. Reviewers (admin, creator, assignee's head) complete directly. |
| **Recurring tasks** | `Task.recurrence` = none/daily/weekly/monthly. Every path into Completed calls `spawnNext`, which claims `Task.nextTask` atomically and creates one fresh copy (unticked checklist, due date from `utils/recurrence.js`, skipping past dates, month-end clamped). |
| **Overdue escalation** | `scanEscalations` runs after the deadline scan: tasks still open `ESCALATE_AFTER_DAYS` past due alert the assignees' department heads and the creator, once per person per task. |
```

- [ ] **Step 3: Run everything.** Run: `npm test && npm run test:e2e && npm run build --prefix client` — Expected: all pass.

- [ ] **Step 4: Commit.**

```bash
git add mobile/src README.md
git commit -m "Show In Review on mobile and document the new task lifecycle"
```
