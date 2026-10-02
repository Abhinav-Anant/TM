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
const { nextDueDate, RECURRENCES } = require("./utils/recurrence.js");

// --- "today" in the caller's timezone, and reminders ----------------------
{
    const { dayBounds, computeRemindAt, reminderError } = require("./utils/workTime.js");
    const wed = new Date("2026-10-07T10:00:00Z"); // a Wednesday

    const utc = dayBounds(0, wed);
    assert.strictEqual(utc.start.toISOString(), "2026-10-07T00:00:00.000Z");
    assert.strictEqual(utc.end.toISOString(), "2026-10-08T00:00:00.000Z");
    assert.strictEqual(utc.weekStart.toISOString(), "2026-10-05T00:00:00.000Z", "weeks start on Monday");

    // India is UTC+5:30, so getTimezoneOffset() is -330: 20:00Z is already the 8th there.
    const ist = dayBounds(-330, new Date("2026-10-07T20:00:00Z"));
    assert.strictEqual(ist.start.toISOString(), "2026-10-07T18:30:00.000Z", "midnight in IST");
    assert.strictEqual(dayBounds(0, new Date("2026-10-11T23:59:00Z")).weekStart.toISOString(), "2026-10-05T00:00:00.000Z", "Sunday belongs to the week that began Monday");
    assert.strictEqual(dayBounds(0, new Date("2026-10-12T00:00:00Z")).weekStart.toISOString(), "2026-10-12T00:00:00.000Z", "Monday starts a new week");
    assert.strictEqual(dayBounds(NaN, wed).start.toISOString(), utc.start.toISOString(), "a junk offset falls back to UTC");

    const due = "2026-10-10T09:00:00Z";
    assert.strictEqual(computeRemindAt(due, { type: "none" }), null);
    assert.strictEqual(computeRemindAt(null, { type: "1h" }), null, "no due date, no reminder");
    assert.strictEqual(computeRemindAt(due, { type: "at_due" }).toISOString(), "2026-10-10T09:00:00.000Z");
    assert.strictEqual(computeRemindAt(due, { type: "1h" }).toISOString(), "2026-10-10T08:00:00.000Z");
    assert.strictEqual(computeRemindAt(due, { type: "1d" }).toISOString(), "2026-10-09T09:00:00.000Z");
    assert.strictEqual(computeRemindAt(due, { type: "custom", customMinutes: 90 }).toISOString(), "2026-10-10T07:30:00.000Z");
    assert.ok(reminderError({ type: "weekly" }), "unknown type");
    assert.ok(reminderError({ type: "custom", customMinutes: 0 }), "custom needs minutes");
    assert.ok(reminderError({ type: "custom", customMinutes: 1.5 }), "whole minutes only");
    assert.strictEqual(reminderError({ type: "custom", customMinutes: 15 }), null);
    assert.strictEqual(reminderError({ type: "none" }), null);
}


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
    const { base, filter } = buildFilters(member, { status: "To Do", priority: "High" });
    assert.strictEqual(filter.status, "To Do");
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
    assert.deepStrictEqual(filter.status, { $nin: ["Completed", "Cancelled"] });
}
{
    // "Overdue" means not-yet-done. Clicking the Completed tab must not silently
    // drop that exclusion - it has to return nothing instead.
    const { filter } = buildFilters(admin, { overdue: "true", status: "Completed" });
    assert.deepStrictEqual(filter.status, { $in: [] }, "contradictory status must match nothing");

    const stillWorks = buildFilters(admin, { overdue: "true", status: "To Do" });
    assert.strictEqual(stillWorks.filter.status, "To Do", "a compatible status still filters normally");
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
    assert.strictEqual(task.status, "To Do");
    assert.strictEqual(task.completedAt, null);
}
{
    // An empty checklist is 0%, never NaN, and never auto-completes.
    const task = { todoChecklist: [] };
    syncProgress(task);
    assert.strictEqual(task.progress, 0);
    assert.strictEqual(task.status, "To Do");
}
{
    // A task that needs sign-off stops at In Review, and is not stamped completed.
    const task = { todoChecklist: [{ completed: true }] };
    syncProgress(task, { needsReview: true });
    assert.strictEqual(task.status, "In Review");
    assert.strictEqual(task.progress, 100);
    assert.strictEqual(task.completedAt, null);
}

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

// --- lead filters ------------------------------------------------------------
{
    const { buildLeadFilters } = require("./controller/lead.controller.js");

    assert.deepStrictEqual(buildLeadFilters({}, {}), {}, "admin, no filters, matches everything");
    assert.deepStrictEqual(
        buildLeadFilters({}, { stage: "Proposal", product: "Firewall" }),
        { stage: "Proposal", product: "Firewall" },
        "filters pass straight through for an admin"
    );
    assert.strictEqual(buildLeadFilters({}, { stage: "All" }).stage, undefined, "'All' is the UI's no-filter sentinel");

    // The security property: a query parameter must never widen the scope. A
    // member passing ?owner=<someone else> still only matches their own leads.
    assert.deepStrictEqual(
        buildLeadFilters({ owner: "me" }, { owner: "someone-else" }),
        { $and: [{ owner: "someone-else" }, { owner: "me" }] },
        "scope is ANDed with the query, never overwritten by it"
    );

    // A head filtering by one rep still narrows rather than replacing their scope.
    assert.deepStrictEqual(
        buildLeadFilters({ owner: { $in: ["r1", "r2"] } }, { owner: "r1" }),
        { $and: [{ owner: "r1" }, { owner: { $in: ["r1", "r2"] } }] }
    );

    // Regex metacharacters in the search box stay literal.
    const search = buildLeadFilters({}, { q: "a.b" });
    assert.ok(search.$or[0].company instanceof RegExp);
    assert.strictEqual(search.$or[0].company.source, "a\\.b", "metacharacters are escaped");
    assert.strictEqual(search.$or.length, 2, "search covers company and contactName");
}

// --- outcome to stage --------------------------------------------------------
{
    const { stageForOutcome, OUTCOMES } = require("./controller/lead.controller.js");

    // Logging any touch means contact happened, so New always advances first.
    assert.strictEqual(stageForOutcome("New", "Interested"), "Contacted");
    assert.strictEqual(stageForOutcome("New", "Follow-up required"), "Contacted");

    // The unambiguous outcomes drive the stage; the vague ones leave it alone.
    assert.strictEqual(stageForOutcome("New", "Not interested"), "Lost");
    assert.strictEqual(stageForOutcome("Qualified", "Wrong number"), "Lost");
    assert.strictEqual(stageForOutcome("Qualified", "Proposal requested"), "Proposal");
    assert.strictEqual(stageForOutcome("Negotiation", "Follow-up required"), "Negotiation",
        "a vague outcome never drags a late-stage deal backwards");

    assert.strictEqual(OUTCOMES.length, 5);
}

// --- scope and module access ------------------------------------------------
// Async, so it runs last and owns the success line: printing "passed" before
// awaiting these would report a green run for a failing assertion.
(async () => {
    const { scopeFor, headedDepartmentIds, modulesFor, MODULES } = require("./utils/scope.js");

    // Only the branches that never touch the database belong here; anything
    // needing a User lookup is covered by the e2e suite.
    assert.deepStrictEqual(await scopeFor({ role: "admin" }, "owner"), {}, "admin sees every lead");

    // A member heads nothing, so the union collapses to just themselves.
    assert.deepStrictEqual(
        await scopeFor({ role: "member", _id: "u1", memberships: [{ department: "d1", head: false }] }, "owner"),
        { owner: { $in: ["u1"] } },
        "a member is scoped to records they own"
    );
    assert.deepStrictEqual(
        await scopeFor({ role: "member", _id: "u1", memberships: [] }),
        { assignedTo: { $in: ["u1"] } },
        "the default field is still assignedTo"
    );

    // Headship comes from the membership, never from the role. This is the
    // guard that stops a head who is merely a REP in another department from
    // gaining that department's records.
    assert.deepStrictEqual(
        headedDepartmentIds({ memberships: [{ department: "d1", head: true }, { department: "d2", head: false }] }),
        ["d1"],
        "only memberships flagged head count as headships"
    );
    assert.deepStrictEqual(
        headedDepartmentIds({ role: "head", memberships: [{ department: "d1", head: false }] }),
        [],
        "role alone never confers headship"
    );
    assert.deepStrictEqual(headedDepartmentIds({}), [], "a user with no memberships heads nothing");

    // Modules: admin is special-cased because admins hold no memberships.
    assert.deepStrictEqual(await modulesFor({ role: "admin" }), MODULES, "an admin gets every module");
    assert.deepStrictEqual(await modulesFor({ role: "member", memberships: [] }), [],
        "no department means no modules");

    assert.deepStrictEqual(MODULES, ["sales", "leads"]);

    console.log("All smoke checks passed.");
})();
