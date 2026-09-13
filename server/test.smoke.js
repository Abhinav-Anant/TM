/**
 * Smoke checks for the logic that is easy to get wrong and hard to see fail:
 * query filter building, sort whitelisting, progress recalculation and the SSE registry.
 * Run with: npm test   (no DB, no network, no framework)
 */
const assert = require("assert");

const { buildFilters, buildSort, syncProgress, escapeRegex } = require("./controller/task.controller.js");
const { addClient, push, connectionCount } = require("./utils/sse.js");
const { escapeHtml } = require("./utils/mailer.js");

const admin = { _id: "admin1", role: "admin" };
const member = { _id: "member1", role: "member" };

// --- scoping -------------------------------------------------------------
assert.deepStrictEqual(buildFilters(admin, {}).filter, {}, "admin sees everything");
assert.deepStrictEqual(buildFilters(member, {}).filter, { assignedTo: "member1" }, "member is scoped to own tasks");

// --- status is excluded from the count base so tab counts stay meaningful --
{
    const { base, filter } = buildFilters(member, { status: "Pending", priority: "High" });
    assert.strictEqual(filter.status, "Pending");
    assert.strictEqual(base.status, undefined, "base must not carry status");
    assert.strictEqual(base.priority, "High", "base keeps the other filters");
}

// "All" is the UI's no-filter sentinel, not a real status value.
assert.strictEqual(buildFilters(member, { status: "All" }).filter.status, undefined);
assert.strictEqual(buildFilters(member, { status: "  " }).filter.status, undefined);

// --- search ---------------------------------------------------------------
{
    const { filter } = buildFilters(admin, { search: "report" });
    assert.ok(filter.$or[0].title instanceof RegExp);
    assert.ok(filter.$or[0].title.test("Quarterly REPORT"), "search is case-insensitive");
    assert.ok(filter.$or[1].description instanceof RegExp);
}

// A user typing regex metacharacters must not build a wildcard (or a ReDoS bomb).
assert.strictEqual(escapeRegex("a+b(c)"), "a\\+b\\(c\\)");
{
    const { filter } = buildFilters(admin, { search: "a.b" });
    assert.ok(!filter.$or[0].title.test("axb"), "'.' must be literal");
    assert.ok(filter.$or[0].title.test("a.b"));
}

// --- date range + overdue -------------------------------------------------
{
    const { filter } = buildFilters(admin, { dueAfter: "2026-01-01", dueBefore: "2026-02-01" });
    assert.strictEqual(filter.dueDate.$gte.toISOString().slice(0, 10), "2026-01-01");
    assert.strictEqual(filter.dueDate.$lte.toISOString().slice(0, 10), "2026-02-01");
}
{
    const { filter } = buildFilters(admin, { overdue: "true" });
    assert.ok(filter.dueDate.$lt instanceof Date);
    assert.deepStrictEqual(filter.status, { $ne: "Completed" });
}
{
    // "Overdue" means not-yet-done. Clicking the Completed tab must not silently
    // drop that exclusion - it has to return nothing instead.
    const { filter } = buildFilters(admin, { overdue: "true", status: "Completed" });
    assert.deepStrictEqual(filter.status, { $in: [] }, "contradictory status must match nothing");

    const stillWorks = buildFilters(admin, { overdue: "true", status: "Pending" });
    assert.strictEqual(stillWorks.filter.status, "Pending", "a compatible status still filters normally");
}

// --- sorting: only whitelisted fields reach Mongo -------------------------
assert.deepStrictEqual(buildSort({ sortBy: "dueDate", sortOrder: "asc" }), { dueDate: 1 });
assert.deepStrictEqual(buildSort({ sortBy: "$where" }), { createdAt: -1 }, "unknown sort falls back");
assert.deepStrictEqual(buildSort({}), { createdAt: -1 });

// --- progress -------------------------------------------------------------
{
    const task = { todoChecklist: [{ completed: true }, { completed: false }, { completed: false }] };
    syncProgress(task);
    assert.strictEqual(task.progress, 33);
    assert.strictEqual(task.status, "In Progress");
    assert.strictEqual(task.completedAt, null);
}
{
    const task = { todoChecklist: [{ completed: true }, { completed: true }] };
    syncProgress(task);
    assert.strictEqual(task.progress, 100);
    assert.strictEqual(task.status, "Completed");
    assert.ok(task.completedAt instanceof Date, "completedAt drives the analytics trend");
}
{
    // Re-completing must not move the original completion date.
    const first = new Date("2026-01-01");
    const task = { todoChecklist: [{ completed: true }], completedAt: first };
    syncProgress(task);
    assert.strictEqual(task.completedAt, first);
}
{
    // Un-ticking a completed task clears completedAt again.
    const task = { todoChecklist: [{ completed: false }], completedAt: new Date() };
    syncProgress(task);
    assert.strictEqual(task.status, "Pending");
    assert.strictEqual(task.completedAt, null);
}
{
    // An empty checklist is 0%, never NaN, and never auto-completes.
    const task = { todoChecklist: [] };
    syncProgress(task);
    assert.strictEqual(task.progress, 0);
    assert.strictEqual(task.status, "Pending");
}

// --- SSE registry ---------------------------------------------------------
{
    const frames = [];
    const fakeRes = { write: (f) => frames.push(f) };
    const remove = addClient("u1", fakeRes);

    push("u1", { type: "assigned", title: "hi" });
    push("u2", { type: "assigned", title: "not for u1" });

    assert.strictEqual(frames.length, 1, "only the addressed user receives the frame");
    assert.ok(frames[0].startsWith("data: ") && frames[0].endsWith("\n\n"), "valid SSE framing");
    assert.strictEqual(JSON.parse(frames[0].slice(6)).title, "hi");

    remove();
    push("u1", { type: "assigned" });
    assert.strictEqual(frames.length, 1, "disconnected client stops receiving");
    assert.strictEqual(connectionCount(), 0, "registry does not leak entries");
}

// --- email escaping -------------------------------------------------------
assert.strictEqual(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    "task titles land in HTML email - they must be escaped"
);

console.log("All smoke checks passed.");
