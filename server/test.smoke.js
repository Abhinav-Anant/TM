/**
 * Smoke checks for the logic that is easy to get wrong and hard to see fail:
 * query filter building, sort whitelisting, progress recalculation and the SSE registry.
 * Run with: npm test   (no DB, no network, no framework)
 */
const assert = require("assert");

const { buildFilters, buildSort, syncProgress, escapeRegex } = require("./controller/task.controller.js");
const { addClient, push, connectionCount } = require("./utils/sse.js");
const { normalizePhone } = require("./utils/phone.js");
const { parseMembersCsv } = require("./utils/csv.js");

// buildFilters now takes an already-resolved scope (see server/utils/scope.js)
// rather than a user, which keeps it pure and synchronous.
const admin = {};
const member = { assignedTo: "member1" };
const head = { assignedTo: { $in: ["member1", "member2"] } };

// --- scoping -------------------------------------------------------------
assert.deepStrictEqual(buildFilters(admin, {}).filter, {}, "admin sees everything");
assert.deepStrictEqual(buildFilters(member, {}).filter, { assignedTo: "member1" }, "member is scoped to own tasks");
assert.deepStrictEqual(
    buildFilters(head, {}).filter,
    { assignedTo: { $in: ["member1", "member2"] } },
    "head is scoped to their department"
);

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

// --- phone normalisation --------------------------------------------------
// A number that survives this is what gets stored, so a mistake here is a
// member who silently never receives a WhatsApp alert.
{
    const valid = {
        "9876543210": "919876543210",        // bare local, gets the default code
        "98765 43210": "919876543210",       // separators are noise
        "+91 98765 43210": "919876543210",   // explicit code, "+" dropped
        "0091-9876543210": "919876543210",   // 00 is the same as "+"
        "09876543210": "919876543210",       // leading 0 is a trunk prefix
        "919876543210": "919876543210",      // already normalised, unchanged
        "+1 415 555 0123": "14155550123",    // not everyone is in India
    };
    for (const [input, expected] of Object.entries(valid)) {
        assert.strictEqual(normalizePhone(input), expected, `${input} should normalise to ${expected}`);
    }

    // Anything we cannot turn into a real number must be refused, never guessed at.
    for (const bad of ["", "   ", "12345", "abc", "+", "0", null, undefined, "12345678901234567"]) {
        assert.strictEqual(normalizePhone(bad), null, `${JSON.stringify(bad)} is not a usable number`);
    }
}
// --- member CSV import ----------------------------------------------------
{
    const BOM = String.fromCharCode(0xFEFF);
    // Template literal so the fixture reads like a real file: BOM, reordered and
    // capitalised header, a quoted comma, an escaped quote, then one of each bad row.
    const { rows, errors } = parseMembersCsv(BOM + `Email,Name,Password
a@x.com,"Doe, Jane",secret1

b@x.com,Bob,"pa""ss1"
A@X.com,Dup,secret1
not-an-email,Carl,secret1
d@x.com,,secret1
e@x.com,Eve,short
`);

    assert.deepStrictEqual(rows, [
        { name: "Doe, Jane", email: "a@x.com", password: "secret1", department: "", line: 2 },
        { name: "Bob", email: "b@x.com", password: 'pa"ss1', department: "", line: 4 },
    ], "valid rows survive quoting, BOM and column order; emails are lowercased");

    assert.deepStrictEqual(errors.map((e) => e.line), [5, 6, 7, 8], "every bad row is reported by file line");
    assert.ok(/Duplicate/.test(errors[0].message), "same email twice in one file");
    assert.ok(/Invalid email/.test(errors[1].message));
    assert.ok(/Name is required/.test(errors[2].message));
    assert.ok(/at least 6/.test(errors[3].message));
}
{
    // A file missing a column must fail loudly instead of importing blank passwords.
    const { rows, errors } = parseMembersCsv("name,email\nBob,b@x.com\n");
    assert.strictEqual(rows.length, 0);
    assert.ok(/Missing required column/.test(errors[0].message));
}
{
    // department is optional: absent column and blank cell both mean "no department",
    // and the name is passed through untouched for the controller to resolve to an id.
    const withDept = parseMembersCsv("name,email,password,department\nA,a@x.com,secret1,Sales\nB,b@x.com,secret1,\n");
    assert.deepStrictEqual(withDept.errors, []);
    assert.strictEqual(withDept.rows[0].department, "Sales");
    assert.strictEqual(withDept.rows[1].department, "", "blank cell is no department, not an error");

    const without = parseMembersCsv("name,email,password\nA,a@x.com,secret1\n");
    assert.strictEqual(without.rows[0].department, "", "missing column is no department, not an error");
}

// --- scopeFor is field-agnostic, so leads can reuse it -----------------------
// Async, so it runs last and owns the success line: printing "passed" before
// awaiting these would report a green run for a failing assertion.
(async () => {
    const { scopeFor } = require("./utils/scope.js");

    // The admin and member branches never touch the database, so they belong
    // here; the head branch needs User lookups and is covered by the e2e suite.
    assert.deepStrictEqual(await scopeFor({ role: "admin" }, "owner"), {}, "admin sees every lead");
    assert.deepStrictEqual(
        await scopeFor({ role: "member", _id: "u1" }, "owner"),
        { owner: "u1" },
        "member is scoped to leads they own"
    );
    assert.deepStrictEqual(
        await scopeFor({ role: "member", _id: "u1" }),
        { assignedTo: "u1" },
        "the default field is still assignedTo"
    );

    console.log("All smoke checks passed.");
})();
