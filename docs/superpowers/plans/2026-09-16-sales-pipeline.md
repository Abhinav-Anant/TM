# Sales Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sales pipeline to TaskManager as a native module, where a sales follow-up is an ordinary Task carrying a `lead` reference.

**Architecture:** One new Mongoose collection (`Lead`) and one new field on `Task` in the same MongoDB database, so there is no sync layer. Authorization reuses the existing department scoping in `server/utils/scope.js`, generalised from the `assignedTo` field to any field name. Lead alerts reuse `server/utils/notify.js` unchanged by making every lead own a follow-up Task from the moment it is created.

**Tech Stack:** Node 18+, Express 4, Mongoose 8, React 19 + Vite + Tailwind 4, `recharts`. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-sales-pipeline-design.md`

## Global Constraints

- **No new npm dependencies.** Everything here uses packages already in `package.json` or `client/package.json`.
- **Two test harnesses, both already exist.** Pure synchronous logic is tested in `server/test.smoke.js` (`npm test` — no DB, no network, no framework). HTTP behaviour is tested in `server/test.integration.js` (`npm run test:e2e` — boots in-memory Mongo, a fake WhatsApp gateway and the real server). Do not introduce a test framework.
- **The client has no test harness.** Frontend tasks verify with `npm run lint --prefix client` and `npm run build --prefix client`. Do not add vitest or jest.
- **Stage enum, exact strings:** `New`, `Contacted`, `Qualified`, `Demo`, `Proposal`, `Negotiation`, `Won`, `Lost`.
- **Closed stages:** `Won`, `Lost`. Everything else is open.
- **Source enum, exact strings:** `Website`, `WhatsApp`, `Inbound Call`, `Existing Customer`, `Referral`, `Google`, `Facebook`, `Partner`, `Salesperson`, `Other`.
- **Product enum, exact strings:** `Internet`, `Firewall`, `LeoPrime`, `SD-WAN`, `Hotspot`, `VPS`, `CCTV`, `Cloud`, `Other`.
- **Outcome enum, exact strings:** `Interested`, `Follow-up required`, `Proposal requested`, `Not interested`, `Wrong number`.
- **Money is stored as plain rupees** in a `Number`. Only the client formats it as ₹L.
- **`value` never changes meaning:** "pipeline value" sums open stages, "won value" sums `Won`. Neither is probability-weighted.
- Follow the existing code style: 4-space indent in `server/`, 2-space in `client/`, CommonJS `require` on the server, ESM `import` in the client.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/model/lead.model.js` (create) | The `Lead` schema, its enums and indexes. Nothing else. |
| `server/controller/lead.controller.js` (create) | All lead request handlers, plus two exported pure helpers (`buildLeadFilters`, `stageForOutcome`) so the smoke suite can test them without a database. |
| `server/routes/lead.route.js` (create) | Route table only, mirroring `server/routes/task.route.js`. |
| `server/utils/scope.js` (modify) | `scopeFor` gains a field-name parameter. |
| `server/model/task.model.js` (modify) | One `lead` field. |
| `server/index.js` (modify) | Mount `/api/leads`. |
| `server/test.smoke.js` (modify) | Pure-logic tests for the two helpers and the generalised scope. |
| `server/test.integration.js` (modify) | HTTP tests for every endpoint, appended as one block. |
| `client/src/utils/apiPaths.js` (modify) | A `LEADS` section. |
| `client/src/utils/leadFormat.js` (create) | Currency and stage display helpers shared by the three pages. |
| `client/src/pages/Sales/Leads.jsx` (create) | List + filters + create form. |
| `client/src/pages/Sales/LeadDetail.jsx` (create) | One lead: fields, stage control, tasks, history, outcome dialog. |
| `client/src/pages/Sales/SalesDashboard.jsx` (create) | Stat tiles, funnel, Overdue/Today panels, management table. |
| `client/src/App.jsx` (modify) | Three routes. |

---

### Task 1: Lead model and generalised scope

**Files:**
- Create: `server/model/lead.model.js`
- Modify: `server/utils/scope.js`
- Modify: `server/model/task.model.js`
- Test: `server/test.smoke.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Lead` — the mongoose model, default export (`module.exports = Lead`), matching every other model in `server/model/`. Enum lists are read back off the schema with `Lead.schema.path('stage').enumValues`, so there is no second copy to drift.
  - `scopeFor(user, field = 'assignedTo')` → `Promise<object>` — a Mongo filter. Existing callers are unaffected by the default.
  - `Task.lead` — `ObjectId | null`.

- [ ] **Step 1: Write the failing test**

Append to `server/test.smoke.js`, immediately after the existing `--- scoping ---` block:

```js
// --- scopeFor is field-agnostic, so leads can reuse it -----------------------
{
    const { scopeFor } = require("./utils/scope.js");

    // The admin and member branches never touch the database, so they are
    // smoke-testable; the head branch needs User lookups and is covered by the
    // integration suite instead.
    scopeFor({ role: "admin" }, "owner").then((filter) => {
        assert.deepStrictEqual(filter, {}, "admin sees every lead");
    });
    scopeFor({ role: "member", _id: "u1" }, "owner").then((filter) => {
        assert.deepStrictEqual(filter, { owner: "u1" }, "member is scoped to leads they own");
    });
    scopeFor({ role: "member", _id: "u1" }).then((filter) => {
        assert.deepStrictEqual(filter, { assignedTo: "u1" }, "the default field is still assignedTo");
    });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `scopeFor` currently ignores its second argument, so the first lead assertion reports `{ assignedTo: 'u1' }` instead of `{ owner: 'u1' }`.

- [ ] **Step 3: Generalise `scopeFor`**

In `server/utils/scope.js`, replace the `scopeFor` function with:

```js
/**
 * Mongo filter narrowing a query to what `user` is allowed to see.
 *
 * `field` is the ownership field on the collection being queried - tasks use
 * `assignedTo` (an array), leads use `owner` (a single id). The `$in` branch is
 * correct against both.
 */
const scopeFor = async (user, field = 'assignedTo') => {
    if (user.role === "admin") return {};
    if (user.role === "head") {
        return { [field]: { $in: await departmentMemberIds(user.department) } };
    }
    return { [field]: user._id };
};
```

Leave the JSDoc above `departmentMemberIds`, `canAccessTask` and `canAssignTo` untouched, and leave `module.exports` as it is.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, with no change to the existing scoping assertions above it.

- [ ] **Step 5: Create the Lead model**

Create `server/model/lead.model.js`:

```js
const mongoose = require('mongoose');

// The pipeline, in order. Everything past Negotiation is closed.
const STAGES = ['New', 'Contacted', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Won', 'Lost'];

const SOURCES = [
    'Website', 'WhatsApp', 'Inbound Call', 'Existing Customer', 'Referral',
    'Google', 'Facebook', 'Partner', 'Salesperson', 'Other',
];

const PRODUCTS = [
    'Internet', 'Firewall', 'LeoPrime', 'SD-WAN', 'Hotspot',
    'VPS', 'CCTV', 'Cloud', 'Other',
];

// Append-only. Stored rather than derived: rebuilding the history panel from
// stage diffs plus task records is more code than writing one line per change.
const historySchema = new mongoose.Schema({
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
}, { _id: false });

const leadSchema = new mongoose.Schema({
    company: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true, default: "" },
    // Bare international form, digits only - the same shape User.phone holds,
    // normalised on the way in by utils/phone.js.
    phone: { type: String, default: null },
    email: { type: String, trim: true, lowercase: true, default: "" },
    source: { type: String, enum: SOURCES, default: 'Other' },
    product: { type: String, enum: PRODUCTS, default: 'Other' },
    // Plain rupees. The client is the only thing that formats this as lakhs.
    value: { type: Number, default: 0 },
    stage: { type: String, enum: STAGES, default: 'New' },
    // One owner, not an array - a lead belongs to exactly one salesperson.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    lostReason: { type: String, default: null },
    closedAt: { type: Date, default: null },
    history: [historySchema],
},
{
    timestamps: true
});

// Serves both the scoped list and the pipeline aggregation.
leadSchema.index({ owner: 1, stage: 1 });
leadSchema.index({ createdAt: -1 });

const Lead = mongoose.model("Lead", leadSchema);

module.exports = Lead;
```

- [ ] **Step 6: Add the `lead` field to Task**

In `server/model/task.model.js`, inside `taskSchema`, add one field directly after `completedAt`:

```js
    completedAt: { type: Date, default: null },
    // Set when this task is a sales follow-up. The only link between the task
    // system and the pipeline - they share a database, so there is nothing to sync.
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
```

- [ ] **Step 7: Verify nothing regressed**

Run: `npm test && npm run test:e2e`
Expected: both PASS. The new field is optional and defaults to `null`, so every existing task assertion still holds.

- [ ] **Step 8: Commit**

```bash
git add server/model/lead.model.js server/model/task.model.js server/utils/scope.js server/test.smoke.js
git commit -m "Add the Lead model and make scopeFor field-agnostic"
```

---

### Task 2: Create a lead, and its first follow-up task

**Files:**
- Create: `server/controller/lead.controller.js`
- Create: `server/routes/lead.route.js`
- Modify: `server/index.js`
- Test: `server/test.integration.js`

**Interfaces:**
- Consumes: `Lead` (Task 1), `scopeFor(user, field)` (Task 1), `Task.lead` (Task 1), the existing `notify()` from `server/utils/notify.js`, `normalizePhone()` from `server/utils/phone.js`, `canAssignTo()` from `server/utils/scope.js`.
- Produces:
  - `POST /api/leads` → `201 { message, lead, task }`
  - `createFollowUp({ lead, actor, dueDate, title })` → `Promise<Task>` — module-private, reused by Task 6.
  - `CLOSED_STAGES` — `['Won', 'Lost']`, exported.

- [ ] **Step 1: Write the failing test**

Append to `server/test.integration.js`, immediately **before** the `console.log("\n  FEATURE VERIFICATION...")` line at the end of the `try` block.

This block creates its own actors so it does not depend on the `eng` department, which an earlier block deletes:

```js
        // ---------- SALES PIPELINE ----------
        // Fresh actors: this block must not depend on departments earlier
        // blocks create and delete.
        const crm = (await call("POST", "/api/departments", { token: A, body: { name: "CRM" } })).body.department;
        const crmHead = (await call("POST", "/api/auth/register", {
            body: { name: "Hera Head", email: "crmhead@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        const rep = (await call("POST", "/api/auth/register", {
            body: { name: "Ravi Rep", email: "rep@example.test", password: "pw123456", phone: "98765 11111" },
        })).body;
        const rival = (await call("POST", "/api/auth/register", {
            body: { name: "Rita Rival", email: "rival@example.test", password: "pw123456" },
        })).body;
        for (const u of [crmHead, rep, rival]) {
            await call("POST", "/api/departments/" + crm._id + "/members", { token: A, body: { userId: u._id } });
        }
        const CH = crmHead.token, R = rep.token, RV = rival.token;

        const mkLead = async (token, over = {}) => call("POST", "/api/leads", {
            token,
            body: { company: "ABC Industries", contactName: "Rajesh Sharma", phone: "98765 43210",
                    product: "Firewall", source: "Website", value: 120000, ...over },
        });

        const created = await mkLead(R);
        assert.strictEqual(created.status, 201, `lead create failed: ${created.text}`);
        assert.strictEqual(created.body.lead.stage, "New", "a new lead starts in New");
        assert.strictEqual(String(created.body.lead.owner), String(rep._id), "owner defaults to the caller");
        assert.strictEqual(created.body.lead.phone, "919876543210", "phone is normalised on the way in");
        assert.strictEqual(created.body.lead.history.length, 1, "creation is recorded in history");

        // The invariant: an owned lead always has a next action.
        assert.ok(created.body.task, "creating a lead creates its first follow-up task");
        assert.strictEqual(String(created.body.task.lead), String(created.body.lead._id));
        assert.strictEqual(created.body.task.category, "Sales");
        assert.deepStrictEqual(created.body.task.assignedTo.map(String), [String(rep._id)]);

        // That task is an ordinary task, so it shows up in the rep's normal list.
        const repTasks = await call("GET", "/api/tasks", { token: R });
        assert.ok(repTasks.body.tasks.some((t) => String(t._id) === String(created.body.task._id)),
            "the follow-up is a first-class task in the existing list");

        // A member cannot hand a lead to someone else; admin and head can.
        assert.strictEqual((await mkLead(R, { owner: rival._id })).status, 403, "a member cannot assign a lead away");
        assert.strictEqual((await mkLead(CH, { owner: rep._id })).status, 201, "a head assigns inside their department");
        assert.strictEqual((await mkLead(A, { owner: rival._id })).status, 201, "an admin assigns to anyone");
        assert.strictEqual((await call("POST", "/api/leads", { token: R, body: { contactName: "No Company" } })).status, 400,
            "company is required");

        // An assignment the rep did not make must reach them on WhatsApp.
        await sleep(300);
        assert.ok(wa.received.some((m) => m.to === "919876511111" && /ABC Industries/.test(m.text)),
            "assigning a lead notifies the owner over the existing WhatsApp path");

        pass("Sales Pipeline", "lead create, owner rules, follow-up task invariant, WhatsApp alert");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `lead create failed: {"message":"Route not found"}`, because `/api/leads` is not mounted yet.

- [ ] **Step 3: Write the controller**

Create `server/controller/lead.controller.js`:

```js
const Lead = require('../model/lead.model.js');
const Task = require('../model/task.model.js');
const { scopeFor, canAssignTo } = require('../utils/scope.js');
const { normalizePhone } = require('../utils/phone.js');
const { notify } = require('../utils/notify.js');

const CLOSED_STAGES = ['Won', 'Lost'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every lead owns a next action. Creating one here is what lets lead alerts
 * reuse notify() untouched: the notification hangs off a real task, so the
 * deep link (/user/task-details/:id) already resolves and no new
 * Notification.type value is needed.
 */
const createFollowUp = async ({ lead, actor, dueDate, title }) => {
    const task = await Task.create({
        title: title || `Follow up — ${lead.company}`,
        description: `${lead.product} · ${lead.stage}`,
        category: "Sales",
        priority: "Medium",
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + DAY_MS),
        assignedTo: [lead.owner],
        createdBy: actor._id,
        lead: lead._id,
    });

    // notify() drops the actor, so a rep logging their own lead is not alerted
    // about their own action.
    await notify({
        userIds: [lead.owner],
        actor,
        type: "assigned",
        task: task._id,
        title: `New lead: ${lead.company}`,
        message: `${actor.name} assigned you ${lead.company} (${lead.product}), next action due ${new Date(task.dueDate).toDateString()}.`,
    });

    return task;
};

const createLead = async (req, res) => {
    try {
        const {
            company, contactName, phone, email, source, product, value,
            owner, firstFollowUp, firstTitle,
        } = req.body;

        if (!company || !String(company).trim()) {
            return res.status(400).json({ message: "Company is required" });
        }

        const ownerId = owner || req.user._id;
        if (String(ownerId) !== String(req.user._id)) {
            // Unlike tasks, anyone may create a lead - but only admins and heads
            // may create one owned by somebody else.
            if (req.user.role === "member") {
                return res.status(403).json({ message: "You can only create leads you own" });
            }
            if (!await canAssignTo(req.user, [ownerId])) {
                return res.status(403).json({ message: "You can only assign leads to members of your own department" });
            }
        }

        const lead = await Lead.create({
            company: String(company).trim(),
            contactName, email,
            // An unparseable number degrades reach rather than rejecting the lead,
            // exactly as a user profile behaves.
            phone: normalizePhone(phone),
            source, product,
            value: Number(value) || 0,
            owner: ownerId,
            history: [{ by: req.user._id, text: `Lead created by ${req.user.name}` }],
        });

        const task = await createFollowUp({ lead, actor: req.user, dueDate: firstFollowUp, title: firstTitle });

        res.status(201).json({ message: "Lead created successfully", lead, task });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

module.exports = { createLead, createFollowUp, CLOSED_STAGES };
```

- [ ] **Step 4: Write the route file**

Create `server/routes/lead.route.js`:

```js
const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const { createLead } = require('../controller/lead.controller.js');

// Anyone signed in may log a lead - a rep who takes a call must be able to
// record it. Ownership rules live in the controller.
router.post('/', protect, createLead);

module.exports = router;
```

- [ ] **Step 5: Mount the routes**

In `server/index.js`, add the import beside the other route imports:

```js
const leadRoutes = require('./routes/lead.route.js');
```

and mount it beside the others, after the departments line:

```js
app.use('/api/leads', leadRoutes);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS, ending with `[PASS] Sales Pipeline`.

- [ ] **Step 7: Commit**

```bash
git add server/controller/lead.controller.js server/routes/lead.route.js server/index.js server/test.integration.js
git commit -m "Add lead creation, which always creates the first follow-up task"
```

---

### Task 3: List leads, scoped

**Files:**
- Modify: `server/controller/lead.controller.js`
- Modify: `server/routes/lead.route.js`
- Test: `server/test.smoke.js`, `server/test.integration.js`

**Interfaces:**
- Consumes: `CLOSED_STAGES` (Task 2), `escapeRegex` from `server/controller/task.controller.js`.
- Produces:
  - `buildLeadFilters(scope, query)` → `object` — pure, synchronous, exported.
  - `GET /api/leads` → `200 { leads, total }`

- [ ] **Step 1: Write the failing pure-logic test**

Append to `server/test.smoke.js`, after the scoping block added in Task 1:

```js
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
    const escalation = buildLeadFilters({ owner: "me" }, { owner: "someone-else" });
    assert.deepStrictEqual(
        escalation,
        { $and: [{ owner: "someone-else" }, { owner: "me" }] },
        "scope is ANDed with the query, never overwritten by it"
    );

    // A head filtering by one rep still narrows rather than replacing their scope.
    const headFilter = buildLeadFilters({ owner: { $in: ["r1", "r2"] } }, { owner: "r1" });
    assert.deepStrictEqual(headFilter, { $and: [{ owner: "r1" }, { owner: { $in: ["r1", "r2"] } }] });

    // Regex metacharacters in the search box stay literal.
    const search = buildLeadFilters({}, { q: "a.b" });
    assert.ok(search.$or[0].company instanceof RegExp);
    assert.strictEqual(search.$or[0].company.source, "a\\.b", "metacharacters are escaped");
    assert.strictEqual(search.$or.length, 2, "search covers company and contactName");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `TypeError: buildLeadFilters is not a function`.

- [ ] **Step 3: Implement `buildLeadFilters` and the list handler**

In `server/controller/lead.controller.js`, add the import at the top, beside the others:

```js
const { escapeRegex } = require('./task.controller.js');
```

Then add, above `module.exports`:

```js
/**
 * Mongo filter for a lead list. Pure and synchronous so the smoke suite can
 * cover it without a database, matching buildFilters in task.controller.js.
 *
 * `scope` is spread into an $and rather than merged, so a query parameter can
 * never overwrite it. Merging would let a member widen their own scope with
 * ?owner=<someone else>, which is a privilege escalation, and would also stop a
 * head narrowing to one rep. $and is correct for both.
 */
const buildLeadFilters = (scope, query = {}) => {
    const filter = {};
    const { stage, owner, product, source, q } = query;

    const set = (key, value) => {
        if (value && value !== "All" && String(value).trim()) filter[key] = value;
    };
    set("stage", stage);
    set("product", product);
    set("source", source);
    set("owner", owner);

    if (q && String(q).trim()) {
        const rx = new RegExp(escapeRegex(String(q).trim()), "i");
        filter.$or = [{ company: rx }, { contactName: rx }];
    }

    if (!Object.keys(scope).length) return filter;
    if (!Object.keys(filter).length) return { ...scope };
    return { $and: [filter, scope] };
};

const listLeads = async (req, res) => {
    try {
        const scope = await scopeFor(req.user, 'owner');
        const filter = buildLeadFilters(scope, req.query);

        const leads = await Lead.find(filter)
            .populate("owner", "name email")
            .sort({ createdAt: -1 })
            .lean();

        res.json({ leads, total: leads.length });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
```

Update the export line to:

```js
module.exports = { createLead, listLeads, createFollowUp, buildLeadFilters, CLOSED_STAGES };
```

- [ ] **Step 4: Register the route**

In `server/routes/lead.route.js`, extend the import and add the route above the `POST`:

```js
const { createLead, listLeads } = require('../controller/lead.controller.js');

router.get('/', protect, listLeads);
```

- [ ] **Step 5: Run the pure test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Write the failing HTTP test**

In `server/test.integration.js`, insert immediately before the `pass("Sales Pipeline", ...)` line added in Task 2:

```js
        // Scope: a rep sees only their own leads, a head sees the department,
        // an admin sees everything.
        const repList = await call("GET", "/api/leads", { token: R });
        assert.ok(repList.body.leads.every((l) => String(l.owner._id) === String(rep._id)),
            "a member sees only leads they own");
        assert.strictEqual(repList.body.leads.length, 2, "the rep owns their own lead plus the one the head assigned");

        const headList = await call("GET", "/api/leads", { token: CH });
        assert.strictEqual(headList.body.leads.length, 3, "a head sees the whole department");

        // The escalation attempt: a query parameter must not widen scope.
        const escalated = await call("GET", "/api/leads?owner=" + rival._id, { token: R });
        assert.strictEqual(escalated.body.leads.length, 0, "?owner= cannot widen a member's scope");

        // A head narrowing to one rep still works.
        const narrowed = await call("GET", "/api/leads?owner=" + rep._id, { token: CH });
        assert.strictEqual(narrowed.body.leads.length, 2, "a head may filter down to one rep");

        await mkLead(R, { company: "XYZ Hotel", product: "CCTV", source: "Referral", value: 45000 });
        assert.strictEqual((await call("GET", "/api/leads?product=CCTV", { token: R })).body.leads.length, 1);
        assert.strictEqual((await call("GET", "/api/leads?q=hotel", { token: R })).body.leads.length, 1,
            "search is case-insensitive");
        assert.strictEqual((await call("GET", "/api/leads?q=x.z", { token: R })).body.leads.length, 0,
            "regex metacharacters stay literal");
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/controller/lead.controller.js server/routes/lead.route.js server/test.smoke.js server/test.integration.js
git commit -m "Add the scoped lead list, with query filters that cannot widen scope"
```

---

### Task 4: Read, edit and delete one lead

**Files:**
- Modify: `server/controller/lead.controller.js`
- Modify: `server/routes/lead.route.js`
- Test: `server/test.integration.js`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:
  - `GET /api/leads/:id` → `200 { lead, tasks }`
  - `PUT /api/leads/:id` → `200 { message, lead }`
  - `DELETE /api/leads/:id` → `200 { message }`
  - `findScopedLead(req)` → `Promise<Lead|null>` — module-private, used by Tasks 5 and 6.

- [ ] **Step 1: Write the failing test**

In `server/test.integration.js`, insert immediately before the `pass("Sales Pipeline", ...)` line:

```js
        const abcId = created.body.lead._id;

        const detail = await call("GET", `/api/leads/${abcId}`, { token: R });
        assert.strictEqual(detail.status, 200);
        assert.strictEqual(detail.body.lead.company, "ABC Industries");
        assert.strictEqual(detail.body.tasks.length, 1, "the detail view carries the lead's tasks");

        // A lead outside your scope is indistinguishable from one that is not there.
        assert.strictEqual((await call("GET", `/api/leads/${abcId}`, { token: RV })).status, 404,
            "another rep's lead reads as not found, not as forbidden");
        assert.strictEqual((await call("PUT", `/api/leads/${abcId}`, { token: RV, body: { value: 1 } })).status, 404);
        assert.strictEqual((await call("GET", `/api/leads/${abcId}`, { token: CH })).status, 200,
            "the head of the department can read it");

        const edited = await call("PUT", `/api/leads/${abcId}`, { token: R, body: { value: 150000, contactName: "R. Sharma" } });
        assert.strictEqual(edited.body.lead.value, 150000);
        assert.strictEqual(edited.body.lead.contactName, "R. Sharma");

        // Stage never moves through the generic edit, so every stage change is
        // guaranteed to leave a history line behind.
        const sneaky = await call("PUT", `/api/leads/${abcId}`, { token: R, body: { stage: "Won" } });
        assert.strictEqual(sneaky.body.lead.stage, "New", "PUT /:id ignores stage");

        assert.strictEqual((await call("PUT", `/api/leads/${abcId}`, { token: R, body: { owner: rival._id } })).status, 403,
            "a member cannot hand their lead to someone else");

        assert.strictEqual((await call("DELETE", `/api/leads/${abcId}`, { token: R })).status, 403, "members cannot delete");
        assert.strictEqual((await call("DELETE", `/api/leads/${abcId}`, { token: CH })).status, 403, "heads cannot delete");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — the `GET /api/leads/:id` assertion reports `404` from the catch-all `/api` handler rather than a lead body.

- [ ] **Step 3: Implement the three handlers**

In `server/controller/lead.controller.js`, add above `module.exports`:

```js
/**
 * The scope filter is the authorization check. A lead outside the caller's
 * scope returns null and the route answers 404, so an out-of-scope lead is
 * indistinguishable from a missing one.
 */
const findScopedLead = async (req) => {
    const scope = await scopeFor(req.user, 'owner');
    return Lead.findOne({ _id: req.params.id, ...scope });
};

const getLeadById = async (req, res) => {
    try {
        const lead = await Lead.findOne({ _id: req.params.id, ...await scopeFor(req.user, 'owner') })
            .populate("owner", "name email")
            .populate("history.by", "name");
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        const tasks = await Task.find({ lead: lead._id })
            .populate("assignedTo", "name email")
            .sort({ dueDate: 1 })
            .lean();

        res.json({ lead, tasks });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const updateLead = async (req, res) => {
    try {
        const lead = await findScopedLead(req);
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        const { company, contactName, phone, email, source, product, value, owner } = req.body;

        if (owner && String(owner) !== String(lead.owner)) {
            if (req.user.role === "member") {
                return res.status(403).json({ message: "You cannot reassign a lead" });
            }
            if (!await canAssignTo(req.user, [owner])) {
                return res.status(403).json({ message: "You can only assign leads to members of your own department" });
            }
            lead.owner = owner;
            lead.history.push({ by: req.user._id, text: `Reassigned by ${req.user.name}` });
        }

        if (company !== undefined) lead.company = String(company).trim();
        if (contactName !== undefined) lead.contactName = contactName;
        if (phone !== undefined) lead.phone = normalizePhone(phone);
        if (email !== undefined) lead.email = email;
        if (source !== undefined) lead.source = source;
        if (product !== undefined) lead.product = product;
        if (value !== undefined) lead.value = Number(value) || 0;
        // `stage` is deliberately absent: it moves only through PUT /:id/stage,
        // which is what guarantees every stage change appends history.

        await lead.save();
        res.json({ message: "Lead updated successfully", lead });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const deleteLead = async (req, res) => {
    try {
        const lead = await Lead.findByIdAndDelete(req.params.id);
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        // The follow-ups have no meaning without the lead they hang off.
        await Task.deleteMany({ lead: lead._id });
        res.json({ message: "Lead deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
```

Update the export line to:

```js
module.exports = {
    createLead, listLeads, getLeadById, updateLead, deleteLead,
    createFollowUp, findScopedLead, buildLeadFilters, CLOSED_STAGES,
};
```

- [ ] **Step 4: Register the routes**

In `server/routes/lead.route.js`, extend the import and add the routes. Import `adminOnly` as well:

```js
const { protect, adminOnly } = require('../middleware/authMiddleware.js');
const {
    createLead, listLeads, getLeadById, updateLead, deleteLead,
} = require('../controller/lead.controller.js');

router.get('/:id', protect, getLeadById);
router.put('/:id', protect, updateLead);
router.delete('/:id', protect, adminOnly, deleteLead);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/controller/lead.controller.js server/routes/lead.route.js server/test.integration.js
git commit -m "Add lead read, edit and delete, with scope as the authorization check"
```

---

### Task 5: Move a lead through the pipeline

**Files:**
- Modify: `server/controller/lead.controller.js`
- Modify: `server/routes/lead.route.js`
- Test: `server/test.integration.js`

**Interfaces:**
- Consumes: `findScopedLead` (Task 4), `CLOSED_STAGES` (Task 2).
- Produces: `PUT /api/leads/:id/stage` → `200 { message, lead }`

- [ ] **Step 1: Write the failing test**

In `server/test.integration.js`, insert immediately before the `pass("Sales Pipeline", ...)` line:

```js
        const moved = await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Proposal", note: "quote sent" } });
        assert.strictEqual(moved.body.lead.stage, "Proposal");
        assert.strictEqual(moved.body.lead.closedAt, null, "an open stage leaves closedAt unset");
        assert.ok(moved.body.lead.history.some((h) => /Proposal/.test(h.text) && /quote sent/.test(h.text)),
            "the stage change and its note land in history");

        const won = await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Won" } });
        assert.ok(won.body.lead.closedAt, "Won stamps closedAt");

        const reopened = await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Negotiation" } });
        assert.strictEqual(reopened.body.lead.closedAt, null, "moving back off a closed stage clears closedAt");

        const lost = await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Lost", lostReason: "price" } });
        assert.strictEqual(lost.body.lead.lostReason, "price");
        assert.ok(lost.body.lead.closedAt, "Lost stamps closedAt too");

        assert.strictEqual((await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Nonsense" } })).status, 400,
            "an unknown stage is rejected");
        assert.strictEqual((await call("PUT", `/api/leads/${abcId}/stage`, { token: RV, body: { stage: "Won" } })).status, 404,
            "another rep cannot move your lead");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — the first assertion reads `undefined` for `stage`, because `PUT /:id/stage` falls through to `PUT /:id`, which ignores `stage`.

- [ ] **Step 3: Implement the handler**

In `server/controller/lead.controller.js`, add above `module.exports`:

```js
const updateLeadStage = async (req, res) => {
    try {
        const { stage, note, lostReason } = req.body;

        const allowed = Lead.schema.path('stage').enumValues;
        if (!allowed.includes(stage)) {
            return res.status(400).json({ message: `stage must be one of: ${allowed.join(", ")}` });
        }

        const lead = await findScopedLead(req);
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        const from = lead.stage;
        lead.stage = stage;
        // Any stage may move to any other: the pipeline is a label, not a state
        // machine. Reps skip Demo, and a deal legitimately comes back from Lost.
        lead.closedAt = CLOSED_STAGES.includes(stage) ? new Date() : null;
        if (stage === "Lost" && lostReason !== undefined) lead.lostReason = lostReason;

        lead.history.push({
            by: req.user._id,
            text: note ? `${from} → ${stage} — ${note}` : `${from} → ${stage}`,
        });

        await lead.save();
        res.json({ message: "Stage updated successfully", lead });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
```

Add `updateLeadStage` to the `module.exports` object.

- [ ] **Step 4: Register the route**

In `server/routes/lead.route.js`, add `updateLeadStage` to the import and register it **above** `router.get('/:id', ...)`:

```js
router.put('/:id/stage', protect, updateLeadStage);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/controller/lead.controller.js server/routes/lead.route.js server/test.integration.js
git commit -m "Add stage transitions, which always append history"
```

---

### Task 6: Log a touch, and schedule the next one

**Files:**
- Modify: `server/controller/lead.controller.js`
- Modify: `server/routes/lead.route.js`
- Test: `server/test.smoke.js`, `server/test.integration.js`

**Interfaces:**
- Consumes: `findScopedLead` (Task 4), `createFollowUp` (Task 2), `CLOSED_STAGES` (Task 2).
- Produces:
  - `stageForOutcome(stage, outcome)` → `string` — pure, synchronous, exported.
  - `OUTCOMES` — the exported string array.
  - `POST /api/leads/:id/outcome` → `200 { message, lead, completedTask, nextTask, nextSkipped }`

- [ ] **Step 1: Write the failing pure-logic test**

Append to `server/test.smoke.js`, after the lead filters block:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `TypeError: stageForOutcome is not a function`.

- [ ] **Step 3: Implement the mapping and the handler**

In `server/controller/lead.controller.js`, add above `module.exports`:

```js
const OUTCOMES = ["Interested", "Follow-up required", "Proposal requested", "Not interested", "Wrong number"];

// Only the unambiguous outcomes move the stage. "Interested" and "Follow-up
// required" say nothing about where the deal actually is, so they leave it be.
const OUTCOME_STAGE = {
    "Not interested": "Lost",
    "Wrong number": "Lost",
    "Proposal requested": "Proposal",
};

/** The stage a lead lands on after `outcome` is logged against it. Pure. */
const stageForOutcome = (stage, outcome) => {
    // Logging any touch at all means contact happened.
    const base = stage === "New" ? "Contacted" : stage;
    return OUTCOME_STAGE[outcome] || base;
};

const logOutcome = async (req, res) => {
    try {
        const { taskId, outcome, note, nextFollowUp, nextTitle } = req.body;

        if (!OUTCOMES.includes(outcome)) {
            return res.status(400).json({ message: `outcome must be one of: ${OUTCOMES.join(", ")}` });
        }

        const lead = await findScopedLead(req);
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        let completedTask = null;
        if (taskId) {
            const task = await Task.findById(taskId);
            // A task from a different lead would let one lead close another's work.
            if (!task || String(task.lead) !== String(lead._id)) {
                return res.status(400).json({ message: "Task does not belong to this lead" });
            }
            task.status = "Completed";
            task.completedAt = new Date();
            task.progress = 100;
            (task.todoChecklist || []).forEach((item) => { item.completed = true; });
            await task.save();
            completedTask = task;
        }

        lead.stage = stageForOutcome(lead.stage, outcome);
        lead.closedAt = CLOSED_STAGES.includes(lead.stage) ? new Date() : null;
        // One line, whatever the stage path was: a New lead closed as "Not
        // interested" passes through Contacted without logging it separately.
        lead.history.push({ by: req.user._id, text: note ? `${outcome} — ${note}` : outcome });
        await lead.save();

        // A closed lead gets no successor - dead work does not belong in
        // anyone's Today list. The response says so rather than staying silent.
        let nextTask = null;
        if (nextFollowUp && !CLOSED_STAGES.includes(lead.stage)) {
            nextTask = await createFollowUp({ lead, actor: req.user, dueDate: nextFollowUp, title: nextTitle });
        }

        res.json({
            message: "Outcome logged",
            lead,
            completedTask,
            nextTask,
            nextSkipped: Boolean(nextFollowUp && !nextTask),
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
```

Add `logOutcome`, `stageForOutcome` and `OUTCOMES` to the `module.exports` object.

- [ ] **Step 4: Register the route**

In `server/routes/lead.route.js`, add `logOutcome` to the import and register it **above** `router.get('/:id', ...)`:

```js
router.post('/:id/outcome', protect, logOutcome);
```

- [ ] **Step 5: Run the pure test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Write the failing HTTP test**

In `server/test.integration.js`, insert immediately before the `pass("Sales Pipeline", ...)` line:

```js
        // A fresh lead so the outcome path starts from New with a live task.
        const fresh = await mkLead(R, { company: "PQR Pvt Ltd", product: "SD-WAN", value: 300000 });
        const pqr = fresh.body.lead._id, pqrTask = fresh.body.task._id;

        const logged = await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R,
            body: { taskId: pqrTask, outcome: "Interested", note: "wants a demo", nextFollowUp: day(2), nextTitle: "Demo — PQR" },
        });
        assert.strictEqual(logged.status, 200, `outcome failed: ${logged.text}`);
        assert.strictEqual(logged.body.lead.stage, "Contacted", "a touch on a New lead advances it to Contacted");
        assert.strictEqual(logged.body.completedTask.status, "Completed", "the referenced task is closed out");
        assert.ok(logged.body.nextTask, "the successor follow-up is created");
        assert.strictEqual(logged.body.nextTask.title, "Demo — PQR");
        assert.strictEqual(logged.body.nextSkipped, false);
        assert.ok(logged.body.lead.history.some((h) => /wants a demo/.test(h.text)));

        // A task belonging to a different lead must never be closeable from here.
        assert.strictEqual((await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R, body: { taskId: created.body.task._id, outcome: "Interested" },
        })).status, 400, "a task from another lead is rejected");

        assert.strictEqual((await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R, body: { outcome: "Maybe" },
        })).status, 400, "an unknown outcome is rejected");

        // Closing the lead must suppress the successor rather than queue dead work.
        const closed = await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R, body: { taskId: logged.body.nextTask._id, outcome: "Not interested", nextFollowUp: day(5) },
        });
        assert.strictEqual(closed.body.lead.stage, "Lost");
        assert.ok(closed.body.lead.closedAt, "closing through an outcome stamps closedAt");
        assert.strictEqual(closed.body.nextTask, null, "no follow-up is created on a closed lead");
        assert.strictEqual(closed.body.nextSkipped, true, "and the response says it was skipped");
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/controller/lead.controller.js server/routes/lead.route.js server/test.smoke.js server/test.integration.js
git commit -m "Add the outcome endpoint, which closes a touch and schedules the next"
```

---

### Task 7: Pipeline aggregation

**Files:**
- Modify: `server/controller/lead.controller.js`
- Modify: `server/routes/lead.route.js`
- Test: `server/test.integration.js`

**Interfaces:**
- Consumes: `CLOSED_STAGES` (Task 2), `scopeFor` (Task 1).
- Produces: `GET /api/leads/pipeline` → `200 { stages, totals, owners? }` where
  - `stages` is `[{ stage, count, value }]`, all eight, in pipeline order, zeroes included
  - `totals` is `{ leads, pipelineValue, wonValue, wonCount }`
  - `owners` is `[{ owner: { _id, name, email } | null, leads, pipelineValue, wonValue }]`, present only for `admin` and `head`

- [ ] **Step 1: Write the failing test**

In `server/test.integration.js`, insert immediately before the `pass("Sales Pipeline", ...)` line:

```js
        const repPipe = await call("GET", "/api/leads/pipeline", { token: R });
        assert.strictEqual(repPipe.status, 200, `pipeline failed: ${repPipe.text}`);
        assert.strictEqual(repPipe.body.stages.length, 8, "every stage comes back, including the empty ones");
        assert.deepStrictEqual(
            repPipe.body.stages.map((s) => s.stage),
            ["New", "Contacted", "Qualified", "Demo", "Proposal", "Negotiation", "Won", "Lost"],
            "stages arrive in pipeline order so the funnel does not reshuffle"
        );
        assert.ok(repPipe.body.stages.some((s) => s.stage === "Lost" && s.count === 2),
            "both closed leads land in Lost");
        assert.strictEqual(repPipe.body.owners, undefined, "a member gets no per-rep breakdown");

        // Closed value is excluded from pipeline value.
        const open = repPipe.body.stages.filter((s) => !["Won", "Lost"].includes(s.stage));
        assert.strictEqual(
            repPipe.body.totals.pipelineValue,
            open.reduce((n, s) => n + s.value, 0),
            "pipeline value sums the open stages only"
        );

        const headPipe = await call("GET", "/api/leads/pipeline", { token: CH });
        assert.ok(Array.isArray(headPipe.body.owners), "a head gets the per-rep table");
        const repRow = headPipe.body.owners.find((o) => String(o.owner?._id) === String(rep._id));
        assert.ok(repRow && repRow.owner.name === "Ravi Rep", "rows carry the rep's name, not a bare id");
        assert.ok(headPipe.body.totals.leads >= repPipe.body.totals.leads, "the head's totals cover the department");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `pipeline failed: {"message":"Lead not found"}`, because `/pipeline` is currently matched by `GET /:id` and treated as an id.

- [ ] **Step 3: Implement the handler**

In `server/controller/lead.controller.js`, add the `User` import at the top, beside the others:

```js
const User = require('../model/user.model.js');
```

and add above `module.exports`:

```js
const getPipeline = async (req, res) => {
    try {
        const scope = await scopeFor(req.user, 'owner');
        const stageNames = Lead.schema.path('stage').enumValues;
        const openStages = stageNames.filter((s) => !CLOSED_STAGES.includes(s));

        const grouped = await Lead.aggregate([
            { $match: scope },
            { $group: { _id: "$stage", count: { $sum: 1 }, value: { $sum: "$value" } } },
        ]);
        const byStage = Object.fromEntries(grouped.map((g) => [g._id, g]));

        // Every stage, always, in pipeline order - a funnel that drops its empty
        // columns reshuffles itself as data changes and is unreadable.
        const stages = stageNames.map((stage) => ({
            stage,
            count: byStage[stage]?.count || 0,
            value: byStage[stage]?.value || 0,
        }));

        const totals = {
            leads: stages.reduce((n, s) => n + s.count, 0),
            pipelineValue: stages
                .filter((s) => openStages.includes(s.stage))
                .reduce((n, s) => n + s.value, 0),
            wonValue: byStage.Won?.value || 0,
            wonCount: byStage.Won?.count || 0,
        };

        const payload = { stages, totals };

        // The management table. A member has nobody to compare against.
        if (req.user.role !== "member") {
            const perOwner = await Lead.aggregate([
                { $match: scope },
                {
                    $group: {
                        _id: "$owner",
                        leads: { $sum: 1 },
                        pipelineValue: { $sum: { $cond: [{ $in: ["$stage", openStages] }, "$value", 0] } },
                        wonValue: { $sum: { $cond: [{ $eq: ["$stage", "Won"] }, "$value", 0] } },
                    },
                },
                { $sort: { pipelineValue: -1 } },
            ]);

            const owners = await User.find({ _id: { $in: perOwner.map((o) => o._id) } })
                .select("name email").lean();
            const byId = Object.fromEntries(owners.map((u) => [String(u._id), u]));

            payload.owners = perOwner.map((o) => ({
                owner: byId[String(o._id)] || null,
                leads: o.leads,
                pipelineValue: o.pipelineValue,
                wonValue: o.wonValue,
            }));
        }

        res.json(payload);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
```

Add `getPipeline` to the `module.exports` object.

- [ ] **Step 4: Register the route above `/:id`**

In `server/routes/lead.route.js`, add `getPipeline` to the import and register it **above** `router.get('/:id', ...)`. The final file must read:

```js
const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware.js');
const {
    listLeads, createLead, getPipeline, getLeadById,
    updateLead, updateLeadStage, logOutcome, deleteLead,
} = require('../controller/lead.controller.js');

// Static paths must stay above '/:id' or Express matches them as a lead id.
router.get('/pipeline', protect, getPipeline);

router.get('/', protect, listLeads);
// Anyone signed in may log a lead - a rep who takes a call must be able to
// record it. Ownership rules live in the controller.
router.post('/', protect, createLead);

router.put('/:id/stage', protect, updateLeadStage);
router.post('/:id/outcome', protect, logOutcome);

router.get('/:id', protect, getLeadById);
router.put('/:id', protect, updateLead);
router.delete('/:id', protect, adminOnly, deleteLead);

module.exports = router;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test && npm run test:e2e`
Expected: both PASS. This completes the server.

- [ ] **Step 6: Commit**

```bash
git add server/controller/lead.controller.js server/routes/lead.route.js server/test.integration.js
git commit -m "Add the scoped pipeline aggregation and management breakdown"
```

---

### Task 8: Lead list page

**Files:**
- Modify: `client/src/utils/apiPaths.js`
- Create: `client/src/utils/leadFormat.js`
- Create: `client/src/pages/Sales/Leads.jsx`
- Modify: `client/src/App.jsx`

**Interfaces:**
- Consumes: `GET /api/leads`, `POST /api/leads` (Tasks 2–3), the existing `axiosInstance` from `client/src/utils/axiosInstance.js` (which attaches the bearer token from `localStorage`), and `DashboardLayout` from `client/src/components/layouts`.
- Produces:
  - `API_PATHS.LEADS` — `{ GET_ALL, CREATE, GET_BY_ID(id), UPDATE(id), DELETE(id), UPDATE_STAGE(id), LOG_OUTCOME(id), GET_PIPELINE }`
  - `formatRupees(n)` → `string` — `₹1.5L` above one lakh, `₹45,000` below.
  - `STAGES`, `PRODUCTS`, `SOURCES`, `OUTCOMES` — arrays mirroring the server enums.
  - `STAGE_TONE` — `{ [stage]: tailwindClassString }` for badges.
  - Route `/sales/leads`.

Note: there is no frontend test harness, and this plan does not add one. Verification is lint plus a production build plus a manual pass.

- [ ] **Step 1: Add the API paths**

In `client/src/utils/apiPaths.js`, add a `LEADS` section after `DEPARTMENTS`:

```js
    LEADS: {
        GET_ALL: "/api/leads",                                  // Scoped: member=own, head=department, admin=all
        CREATE: "/api/leads",                                   // Any signed-in user; owner defaults to self
        GET_PIPELINE: "/api/leads/pipeline",                    // Per-stage counts + value, scoped
        GET_BY_ID: (id) => `/api/leads/${id}`,                  // Lead + its tasks + history
        UPDATE: (id) => `/api/leads/${id}`,                      // Fields only - stage is ignored here
        UPDATE_STAGE: (id) => `/api/leads/${id}/stage`,          // { stage, note, lostReason }
        LOG_OUTCOME: (id) => `/api/leads/${id}/outcome`,         // { taskId, outcome, note, nextFollowUp, nextTitle }
        DELETE: (id) => `/api/leads/${id}`,                      // Admin only
    },
```

- [ ] **Step 2: Create the shared formatting helpers**

Create `client/src/utils/leadFormat.js`:

```js
/**
 * Display helpers shared by the three sales pages.
 *
 * The API always returns plain rupees; formatting to lakhs happens here and
 * nowhere else, so a number never gets converted twice.
 */

export const STAGES = ['New', 'Contacted', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Won', 'Lost'];
export const CLOSED_STAGES = ['Won', 'Lost'];

export const PRODUCTS = ['Internet', 'Firewall', 'LeoPrime', 'SD-WAN', 'Hotspot', 'VPS', 'CCTV', 'Cloud', 'Other'];

export const SOURCES = [
  'Website', 'WhatsApp', 'Inbound Call', 'Existing Customer', 'Referral',
  'Google', 'Facebook', 'Partner', 'Salesperson', 'Other',
];

export const OUTCOMES = ['Interested', 'Follow-up required', 'Proposal requested', 'Not interested', 'Wrong number'];

const LAKH = 100000;

/** ₹1.5L above a lakh, ₹45,000 below it - the way the numbers are actually spoken. */
export const formatRupees = (n) => {
  const value = Number(n) || 0;
  if (Math.abs(value) >= LAKH) return `₹${(value / LAKH).toFixed(1)}L`;
  return `₹${value.toLocaleString('en-IN')}`;
};

export const STAGE_TONE = {
  New: 'bg-slate-500/15 text-slate-300 border-slate-400/20',
  Contacted: 'bg-sky-500/15 text-sky-300 border-sky-400/20',
  Qualified: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/20',
  Demo: 'bg-violet-500/15 text-violet-300 border-violet-400/20',
  Proposal: 'bg-amber-500/15 text-amber-300 border-amber-400/20',
  Negotiation: 'bg-orange-500/15 text-orange-300 border-orange-400/20',
  Won: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20',
  Lost: 'bg-rose-500/15 text-rose-300 border-rose-400/20',
};
```

- [ ] **Step 3: Read one existing page to copy its shell**

Run: `sed -n '1,60p' client/src/pages/Admin/ManageTasks.jsx`

Copy its layout wrapper, its `axiosInstance` usage and its `toast` error handling into the new page rather than inventing a different shape. The import path for the layout and the exact prop names come from that file.

- [ ] **Step 4: Create the list page**

Create `client/src/pages/Sales/Leads.jsx`:

```jsx
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { STAGES, PRODUCTS, SOURCES, STAGE_TONE, formatRupees } from '../../utils/leadFormat';

const BLANK = { company: '', contactName: '', phone: '', email: '', product: 'Other', source: 'Other', value: '' };

const Leads = () => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [filters, setFilters] = useState({ stage: 'All', product: 'All', q: '' });
  const [form, setForm] = useState(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = {};
      if (filters.stage !== 'All') params.stage = filters.stage;
      if (filters.product !== 'All') params.product = filters.product;
      if (filters.q.trim()) params.q = filters.q.trim();

      const { data } = await axiosInstance.get(API_PATHS.LEADS.GET_ALL, { params });
      setLeads(data.leads || []);
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not load leads');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.company.trim()) return toast.error('Company is required');

    try {
      const { data } = await axiosInstance.post(API_PATHS.LEADS.CREATE, form);
      // Creating a lead always creates its first follow-up, so say so - the rep
      // needs to know the task is already in their list.
      toast.success(`Lead added · follow-up due ${new Date(data.task.dueDate).toLocaleDateString()}`);
      setForm(BLANK);
      setShowForm(false);
      load();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not add the lead');
    }
  };

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
    className: 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400/40',
  });

  return (
    <DashboardLayout activeMenu="Leads">
      <div className="mt-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-medium text-slate-100">Leads</h2>
          <button
            onClick={() => setShowForm((open) => !open)}
            className="rounded-lg border border-sky-400/30 bg-sky-500/15 px-4 py-2 text-sm text-sky-200 hover:bg-sky-500/25"
          >
            {showForm ? 'Cancel' : 'Add lead'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-3">
            <input {...field('company')} placeholder="Company *" />
            <input {...field('contactName')} placeholder="Contact name" />
            <input {...field('phone')} placeholder="Phone" />
            <input {...field('email')} placeholder="Email" />
            <select {...field('product')}>
              {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select {...field('source')}>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input {...field('value')} type="number" placeholder="Value (₹)" />
            <button type="submit" className="rounded-lg bg-sky-500/80 px-4 py-2 text-sm text-white hover:bg-sky-500">
              Save lead
            </button>
          </form>
        )}

        <div className="flex flex-wrap gap-3">
          <select
            value={filters.stage}
            onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-100"
          >
            <option value="All">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filters.product}
            onChange={(e) => setFilters({ ...filters, product: e.target.value })}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-100"
          >
            <option value="All">All products</option>
            {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="Search company or contact"
            className="flex-1 min-w-[200px] rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-100"
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Owner</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead._id}
                  onClick={() => navigate(`/sales/leads/${lead._id}`)}
                  className="cursor-pointer border-t border-white/5 hover:bg-white/5"
                >
                  <td className="px-4 py-3 text-slate-100">{lead.company}</td>
                  <td className="px-4 py-3 text-slate-400">{lead.contactName || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{lead.product}</td>
                  <td className="px-4 py-3 text-slate-200">{formatRupees(lead.value)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs ${STAGE_TONE[lead.stage]}`}>{lead.stage}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{lead.owner?.name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && leads.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No leads match these filters.</p>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Leads;
```

- [ ] **Step 5: Register the route**

In `client/src/App.jsx`, add the import beside the other page imports:

```jsx
import Leads from './pages/Sales/Leads';
```

and add the route inside the existing "Any signed-in user" `PrivateRoute` block, beside `/calendar`:

```jsx
                <Route path="/sales/leads" element={<Leads />} />
```

- [ ] **Step 6: Verify**

Run: `npm run lint --prefix client && npm run build --prefix client`
Expected: lint clean, build succeeds.

Then run the app (`npm run dev` in one shell, `npm run dev --prefix client` in another), sign in as a member, open `/sales/leads`, add a lead, and confirm three things: the row appears, the toast names a follow-up due date, and that follow-up shows up on `/user/tasks`.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/apiPaths.js client/src/utils/leadFormat.js client/src/pages/Sales/Leads.jsx client/src/App.jsx
git commit -m "Add the lead list page"
```

---

### Task 9: Lead detail page and the outcome dialog

**Files:**
- Create: `client/src/pages/Sales/LeadDetail.jsx`
- Modify: `client/src/App.jsx`

**Interfaces:**
- Consumes: `GET /api/leads/:id`, `PUT /api/leads/:id/stage`, `POST /api/leads/:id/outcome` (Tasks 4–6); `formatRupees`, `STAGES`, `OUTCOMES`, `STAGE_TONE` from `client/src/utils/leadFormat.js` (Task 8); `API_PATHS.LEADS` (Task 8).
- Produces: route `/sales/leads/:id`.

- [ ] **Step 1: Create the page**

Create `client/src/pages/Sales/LeadDetail.jsx`:

```jsx
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { STAGES, CLOSED_STAGES, OUTCOMES, STAGE_TONE, formatRupees } from '../../utils/leadFormat';

const LeadDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [outcome, setOutcome] = useState({ taskId: '', outcome: 'Interested', note: '', nextFollowUp: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get(API_PATHS.LEADS.GET_BY_ID(id));
      setLead(data.lead);
      setTasks(data.tasks || []);
      const open = (data.tasks || []).find((t) => t.status !== 'Completed');
      setOutcome((prev) => ({ ...prev, taskId: open?._id || '' }));
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not load the lead');
      navigate('/sales/leads');
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  const moveStage = async (stage) => {
    try {
      await axiosInstance.put(API_PATHS.LEADS.UPDATE_STAGE(id), { stage });
      toast.success(`Moved to ${stage}`);
      load();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not move the stage');
    }
  };

  const logOutcome = async (event) => {
    event.preventDefault();
    try {
      const { data } = await axiosInstance.post(API_PATHS.LEADS.LOG_OUTCOME(id), outcome);
      // The server suppresses a follow-up on a closed lead. Say so rather than
      // letting the rep assume one was scheduled.
      if (data.nextSkipped) toast(`Lead is ${data.lead.stage} — no follow-up scheduled`);
      else if (data.nextTask) toast.success(`Logged · next follow-up ${new Date(data.nextTask.dueDate).toLocaleDateString()}`);
      else toast.success('Outcome logged');

      setOutcome({ taskId: '', outcome: 'Interested', note: '', nextFollowUp: '' });
      load();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not log the outcome');
    }
  };

  if (!lead) return <DashboardLayout activeMenu="Leads"><p className="mt-8 text-slate-400">Loading…</p></DashboardLayout>;

  const closed = CLOSED_STAGES.includes(lead.stage);
  const openTasks = tasks.filter((t) => t.status !== 'Completed');
  const input = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400/40';

  return (
    <DashboardLayout activeMenu="Leads">
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-medium text-slate-100">{lead.company}</h2>
                <p className="text-sm text-slate-400">
                  {lead.contactName || 'No contact name'} · {lead.phone || 'No phone'} · {lead.product}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl text-slate-100">{formatRupees(lead.value)}</p>
                <span className={`rounded-full border px-2 py-1 text-xs ${STAGE_TONE[lead.stage]}`}>{lead.stage}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {STAGES.map((stage) => (
                <button
                  key={stage}
                  onClick={() => moveStage(stage)}
                  disabled={stage === lead.stage}
                  className={`rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${STAGE_TONE[stage]}`}
                >
                  {stage}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={logOutcome} className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-sm font-medium uppercase tracking-wide text-slate-400">Log a touch</h3>

            <select
              value={outcome.taskId}
              onChange={(e) => setOutcome({ ...outcome, taskId: e.target.value })}
              className={input}
            >
              <option value="">Do not close a task</option>
              {openTasks.map((t) => (
                <option key={t._id} value={t._id}>{t.title} · due {new Date(t.dueDate).toLocaleDateString()}</option>
              ))}
            </select>

            <select
              value={outcome.outcome}
              onChange={(e) => setOutcome({ ...outcome, outcome: e.target.value })}
              className={input}
            >
              {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>

            <textarea
              value={outcome.note}
              onChange={(e) => setOutcome({ ...outcome, note: e.target.value })}
              placeholder="What happened?"
              rows={2}
              className={input}
            />

            <label className="block text-xs text-slate-400">
              Next follow-up
              <input
                type="date"
                value={outcome.nextFollowUp}
                onChange={(e) => setOutcome({ ...outcome, nextFollowUp: e.target.value })}
                className={`${input} mt-1`}
              />
            </label>

            <button type="submit" className="rounded-lg bg-sky-500/80 px-4 py-2 text-sm text-white hover:bg-sky-500">
              Log outcome
            </button>
            {closed && <p className="text-xs text-slate-500">This lead is {lead.stage}; no follow-up will be scheduled.</p>}
          </form>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-sm font-medium uppercase tracking-wide text-slate-400">Next actions</h3>
            {openTasks.length === 0 && <p className="mt-2 text-sm text-slate-500">Nothing scheduled.</p>}
            {openTasks.map((t) => (
              <p key={t._id} className="mt-2 text-sm text-slate-200">
                {t.title}
                <span className="block text-xs text-slate-500">Due {new Date(t.dueDate).toLocaleDateString()}</span>
              </p>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-sm font-medium uppercase tracking-wide text-slate-400">History</h3>
            {[...lead.history].reverse().map((h, i) => (
              <p key={i} className="mt-2 text-sm text-slate-300">
                {h.text}
                <span className="block text-xs text-slate-500">
                  {new Date(h.at).toLocaleDateString()} · {h.by?.name || 'System'}
                </span>
              </p>
            ))}
          </div>
        </aside>
      </div>
    </DashboardLayout>
  );
};

export default LeadDetail;
```

- [ ] **Step 2: Register the route**

In `client/src/App.jsx`, add the import:

```jsx
import LeadDetail from './pages/Sales/LeadDetail';
```

and the route, beside `/sales/leads`:

```jsx
                <Route path="/sales/leads/:id" element={<LeadDetail />} />
```

- [ ] **Step 3: Verify**

Run: `npm run lint --prefix client && npm run build --prefix client`
Expected: lint clean, build succeeds.

Then, in the running app: open a lead, move it to `Proposal` and confirm the history panel gains a line; log an outcome of `Interested` with a next follow-up date and confirm the new task appears under Next actions; log `Not interested` with a follow-up date set and confirm the toast says no follow-up was scheduled.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Sales/LeadDetail.jsx client/src/App.jsx
git commit -m "Add the lead detail page and the outcome dialog"
```

---

### Task 10: Sales dashboard and navigation

**Files:**
- Create: `client/src/pages/Sales/SalesDashboard.jsx`
- Modify: `client/src/App.jsx`
- Modify: the nav data in `client/src/utils/data.js`

**Interfaces:**
- Consumes: `GET /api/leads/pipeline` (Task 7), `GET /api/tasks` with the existing `overdue` and `dueBefore` filters, `formatRupees`/`STAGE_TONE` (Task 8).
- Produces: route `/sales`, and nav entries pointing at `/sales` and `/sales/leads`.

- [ ] **Step 1: Read the existing nav data shape**

Run: `cat client/src/utils/data.js`

The side nav is driven by arrays in this file. Note the exact key names each entry uses (label, icon, path) and which array corresponds to which role before editing — copy that shape rather than inventing one.

- [ ] **Step 2: Create the dashboard**

Create `client/src/pages/Sales/SalesDashboard.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/layouts/DashboardLayout';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { STAGE_TONE, formatRupees } from '../../utils/leadFormat';

const today = () => new Date().toISOString().slice(0, 10);

const Tile = ({ label, value }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
    <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 text-2xl text-slate-100">{value}</p>
  </div>
);

const TaskRow = ({ task, onOpen }) => (
  <button onClick={onOpen} className="block w-full border-t border-white/5 px-4 py-3 text-left hover:bg-white/5">
    <span className="text-sm text-slate-100">{task.title}</span>
    <span className="block text-xs text-slate-500">Due {new Date(task.dueDate).toLocaleDateString()}</span>
  </button>
);

const SalesDashboard = () => {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState(null);
  const [overdue, setOverdue] = useState([]);
  const [due, setDue] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        // The Today and Overdue panels are the existing task queries narrowed to
        // sales follow-ups - not a second implementation of due-date logic.
        const [pipe, late, soon] = await Promise.all([
          axiosInstance.get(API_PATHS.LEADS.GET_PIPELINE),
          axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, { params: { overdue: 'true', category: 'Sales' } }),
          axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, { params: { dueBefore: today(), category: 'Sales', status: 'Pending' } }),
        ]);
        setPipeline(pipe.data);
        setOverdue((late.data.tasks || []).filter((t) => t.lead));
        setDue((soon.data.tasks || []).filter((t) => t.lead));
      } catch (error) {
        toast.error(error?.response?.data?.message || 'Could not load the dashboard');
      }
    })();
  }, []);

  if (!pipeline) return <DashboardLayout activeMenu="Sales"><p className="mt-8 text-slate-400">Loading…</p></DashboardLayout>;

  return (
    <DashboardLayout activeMenu="Sales">
      <div className="mt-5 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Leads" value={pipeline.totals.leads} />
          <Tile label="Follow-ups due" value={overdue.length + due.length} />
          <Tile label="Pipeline" value={formatRupees(pipeline.totals.pipelineValue)} />
          <Tile label="Won" value={formatRupees(pipeline.totals.wonValue)} />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-slate-400">Pipeline</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {pipeline.stages.map((s) => (
              <button
                key={s.stage}
                onClick={() => navigate(`/sales/leads?stage=${s.stage}`)}
                className={`rounded-xl border px-3 py-3 text-left ${STAGE_TONE[s.stage]}`}
              >
                <span className="block text-lg">{s.count}</span>
                <span className="block text-xs opacity-80">{s.stage}</span>
                <span className="block text-xs opacity-60">{formatRupees(s.value)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-rose-400/20 bg-rose-500/5">
            <h3 className="px-4 py-3 text-sm font-medium text-rose-300">Overdue</h3>
            {overdue.length === 0 && <p className="px-4 pb-4 text-sm text-slate-500">Nothing overdue.</p>}
            {overdue.map((t) => (
              <TaskRow key={t._id} task={t} onOpen={() => navigate(`/sales/leads/${t.lead}`)} />
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <h3 className="px-4 py-3 text-sm font-medium text-slate-300">Today</h3>
            {due.length === 0 && <p className="px-4 pb-4 text-sm text-slate-500">Nothing due today.</p>}
            {due.map((t) => (
              <TaskRow key={t._id} task={t} onOpen={() => navigate(`/sales/leads/${t.lead}`)} />
            ))}
          </div>
        </div>

        {pipeline.owners && (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <h3 className="px-4 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">By salesperson</h3>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Salesperson</th>
                  <th className="px-4 py-2">Leads</th>
                  <th className="px-4 py-2">Pipeline</th>
                  <th className="px-4 py-2">Won</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.owners.map((row, i) => (
                  <tr key={row.owner?._id || i} className="border-t border-white/5">
                    <td className="px-4 py-2 text-slate-100">{row.owner?.name || 'Unassigned'}</td>
                    <td className="px-4 py-2 text-slate-400">{row.leads}</td>
                    <td className="px-4 py-2 text-slate-200">{formatRupees(row.pipelineValue)}</td>
                    <td className="px-4 py-2 text-emerald-300">{formatRupees(row.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default SalesDashboard;
```

- [ ] **Step 3: Register the route**

In `client/src/App.jsx`, add the import:

```jsx
import SalesDashboard from './pages/Sales/SalesDashboard';
```

and the route, beside the other two:

```jsx
                <Route path="/sales" element={<SalesDashboard />} />
```

- [ ] **Step 4: Add the nav entries**

In `client/src/utils/data.js`, add two entries — `Sales` → `/sales` and `Leads` → `/sales/leads` — to each role's nav array, copying the exact key names and icon import style the existing entries use.

The routes themselves stay open to any signed-in user. Hiding the link is a UI convenience; the API scope is what protects the data, and a member outside Sales who reaches `/sales` directly simply sees an empty pipeline.

- [ ] **Step 5: Verify**

Run: `npm run lint --prefix client && npm run build --prefix client`
Expected: lint clean, build succeeds.

Then, in the running app: sign in as the rep and confirm the tiles, funnel and Today/Overdue panels populate and that no "By salesperson" table appears. Sign in as the head and confirm the table does appear and covers the department.

- [ ] **Step 6: Run the whole suite**

Run: `npm test && npm run test:e2e`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Sales/SalesDashboard.jsx client/src/App.jsx client/src/utils/data.js
git commit -m "Add the sales dashboard and its navigation"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-09-16-sales-pipeline-design.md`:

- **Every spec section has a task.** Data model → Task 1. Scope generalisation → Task 1. The follow-up invariant → Task 2. Each endpoint in the API table → Tasks 2–7. The three pages → Tasks 8–10. All six spec test cases appear: scope isolation (Tasks 3, 4), creation invariant (Task 2), stage transition (Task 5), outcome (Task 6), cross-lead task rejection (Task 6), pipeline aggregation (Task 7).
- **One gap found and closed.** The spec was silent on how the query filters combine with the scope filter. The obvious reading — merge them into one object — is a privilege escalation, since a member passing `?owner=<someone else>` would overwrite their own scope key; and the obvious fix, letting scope win outright, would stop a head narrowing to one rep. Task 3 uses `$and` and tests both directions. The spec has been amended with a "Filters never widen scope" section so the two documents agree.
- **Names are consistent across tasks.** `scopeFor(user, field)`, `buildLeadFilters(scope, query)`, `stageForOutcome(stage, outcome)`, `createFollowUp({ lead, actor, dueDate, title })`, `findScopedLead(req)`, `CLOSED_STAGES`, `OUTCOMES`, `API_PATHS.LEADS.*`, `formatRupees`, `STAGE_TONE` are spelled identically everywhere they appear.
- **Two steps deliberately read before writing** rather than showing code: Task 8 Step 3 (the page shell) and Task 10 Steps 1 and 4 (the nav data shape). Both are places where the existing file's conventions must be copied and guessing the key names would produce a broken nav. Every other step contains the actual content.
