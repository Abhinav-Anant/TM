# Department Module Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict the Sales dashboard to departments granting `sales` and the Leads screens to departments granting `leads`, and let one person belong to several departments while heading only the ones they actually lead.

**Architecture:** `User.department` (one id) becomes `User.memberships: [{department, head}]`, so headship is explicit rather than derived from `role`. `Department.modules` holds tick boxes naming which screens the department grants. Two independent gates result: `requireModule` middleware decides which endpoints exist for a caller, and `scopeFor` decides which records come back. Neither widens the other.

**Tech Stack:** Node 20, Express 4, Mongoose 8, MongoDB 4.4 (production is pinned — no `$getField`, no `$setWindowFields`), React 19 + Vite, `node:assert` for tests.

**Spec:** `docs/superpowers/specs/2026-09-17-department-module-access-design.md`

## Global Constraints

- **MongoDB 4.4 only.** Production runs an EOL 4.4 because the CPU lacks AVX. Any aggregation operator newer than 4.4 will pass locally and fail in production.
- **No new dependencies.** Nothing gets added to `package.json`.
- **Tests are `node:assert`, not a framework.** `npm test` runs `server/test.smoke.js` (pure functions, no database). `npm run test:e2e` runs `server/test.integration.js` (boots `mongodb-memory-server`, a fake WhatsApp gateway and the real server, then drives HTTP).
- **The smoke file's success line is owned by a trailing async IIFE.** Any new async assertion must go inside that IIFE, before `console.log("All smoke checks passed.")` — a `.then()` assertion elsewhere in the file prints success before it runs and reports a false green.
- **Route order in `lead.route.js` is load-bearing.** `/pipeline` must stay above `/:id`, or Express matches it as a lead id and throws a 500 on `Cast to ObjectId`.
- **The middleware file is `server/middleware/authMiddleware.js`** (not `auth.js`).
- **CSS is the project's design-token system, not raw Tailwind.** Use `panel`, `field`, `field-label`, `chip chip-*`, `btn`, `text-beam`, `hairline`. Read a neighbouring page before writing markup.
- **Module names are exactly `'sales'` and `'leads'`.** They are a Mongoose enum; a typo silently stores nothing.
- Admins hold no memberships and always get both modules.

## File Structure

**Created:**
- `server/scripts/migrate-memberships.js` — one-off, idempotent data migration.

**Modified (server):**
- `server/model/user.model.js` — `memberships` replaces `department`; new index.
- `server/model/department.model.js` — `modules`.
- `server/utils/scope.js` — the heart of the change: every access predicate re-bases onto headed departments, plus the new `modulesFor`.
- `server/middleware/authMiddleware.js` — `requireModule`.
- `server/routes/lead.route.js` — apply `requireModule`.
- `server/controller/department.controller.js` — membership becomes an operation, not a field assignment.
- `server/controller/task.controller.js`, `user.controller.js`, `auth.controller.js`, `lead.controller.js`.
- `server/scripts/seed-demo.js`.
- `server/test.smoke.js`, `server/test.integration.js`.

**Modified (client):**
- `client/src/utils/roles.js`, `client/src/utils/data.js`
- `client/src/components/layouts/SideMenu.jsx`, `client/src/routes/PrivateRoute.jsx`, `client/src/App.jsx`
- `client/src/pages/Admin/ManageDepartments.jsx`

**A note on sequencing.** This refactor removes a field the whole server reads, and the spec rejected a compatibility shim. So the app is **not runnable between Tasks 1 and 4** — `npm run test:e2e` will fail until Task 4 completes. That is expected, not a symptom. Smoke tests stay green throughout. Do not "fix" a controller out of order to make the server boot.

---

### Task 1: Membership schema and the access predicates

The foundation. Everything else reads these.

**Files:**
- Modify: `server/model/user.model.js`
- Modify: `server/model/department.model.js`
- Modify: `server/utils/scope.js` (full rewrite)
- Test: `server/test.smoke.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `headedDepartmentIds(user) -> ObjectId[]` (synchronous)
  - `departmentMemberIds(departmentIds: ObjectId[]) -> Promise<ObjectId[]>` — **note the signature change: it now takes an array, not a single id**
  - `scopeFor(user, field = 'assignedTo') -> Promise<object>`
  - `canAccessTask(user, task) -> Promise<boolean>`
  - `canAssignTo(user, userIds) -> Promise<boolean>`
  - `modulesFor(user) -> Promise<string[]>`
  - `MODULES = ['sales', 'leads']`
  - `idStr(value) -> string` (unchanged)

- [ ] **Step 1: Write the failing smoke tests**

Replace the existing final async IIFE in `server/test.smoke.js` (it currently starts with the comment `// --- scopeFor is field-agnostic, so leads can reuse it ---`) with this. Note the member assertion changes shape: `scopeFor` now always returns `$in`, so the old `{ owner: "u1" }` expectation is replaced — both forms mean the same thing to Mongo.

```js
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
```

- [ ] **Step 2: Run the smoke tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `headedDepartmentIds is not a function`.

- [ ] **Step 3: Add `memberships` to the User model**

In `server/model/user.model.js`, add the sub-schema above `userSchema` and replace the `department` field. Delete the old field and its two comment lines entirely — leaving it would recreate the second-copy-of-the-org-chart problem this design exists to avoid.

```js
// A person can sit in several departments; `head` marks the ones they lead.
// Headship lives here rather than being derived from `role`, so joining a
// second department as a rep cannot make you its head.
const membershipSchema = new mongoose.Schema({
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true },
    head: { type: Boolean, default: false },
}, { _id: false });
```

Replace the `department: {...}` line inside `userSchema` with:

```js
    memberships: { type: [membershipSchema], default: [] },
```

And after the schema definition, before `mongoose.model`:

```js
// Nearly every scoped query filters on this, so it is not optional.
userSchema.index({ 'memberships.department': 1 });
```

- [ ] **Step 4: Add `modules` to the Department model**

In `server/model/department.model.js`, inside `departmentSchema`, after `name`:

```js
    // Which screens membership of this department grants. Empty by default:
    // a department grants nothing until an admin ticks a box.
    modules: [{ type: String, enum: ['sales', 'leads'] }],
```

- [ ] **Step 5: Rewrite `server/utils/scope.js`**

Replace the whole file:

```js
/**
 * Who may see and touch what.
 *
 * Membership lives in one place only - `User.memberships`, where each entry
 * names a department and whether this user HEADS it. Headship is not derived
 * from `role`, because a head of one department may sit in another as an
 * ordinary rep and must not gain that team's records.
 *
 * Two independent gates live here. `scopeFor` narrows WHICH RECORDS come
 * back; `modulesFor` decides WHICH SCREENS exist at all. Neither widens the
 * other.
 */
const User = require('../model/user.model.js');
const Department = require('../model/department.model.js');

/** Every module a department can grant. */
const MODULES = ['sales', 'leads'];

const idStr = (value) => String(value?._id || value);

/** The departments this user leads. A plain member leads none. */
const headedDepartmentIds = (user) =>
    (user.memberships || []).filter((m) => m.head).map((m) => m.department);

/** Every user in any of these departments, heads included. */
const departmentMemberIds = async (departmentIds) => {
    const ids = (departmentIds || []).filter(Boolean);
    if (!ids.length) return [];
    const members = await User.find({ 'memberships.department': { $in: ids } }).select('_id').lean();
    return members.map((member) => member._id);
};

/**
 * Mongo filter narrowing a query to what `user` is allowed to see.
 *
 * `field` is the ownership field on the collection being queried - tasks use
 * `assignedTo` (an array), leads use `owner` (a single id). `$in` is correct
 * against both.
 *
 * One branch covers heads and members alike: you always see your own records,
 * plus everyone's in the departments you head. A member heads nothing, so this
 * collapses to themselves.
 */
const scopeFor = async (user, field = 'assignedTo') => {
    if (user.role === "admin") return {};
    const led = headedDepartmentIds(user);
    return { [field]: { $in: [user._id, ...await departmentMemberIds(led)] } };
};

/** May `user` open / comment on / update this task? */
const canAccessTask = async (user, task) => {
    if (user.role === "admin") return true;

    const assignees = (task.assignedTo || []).map(idStr);
    if (assignees.includes(idStr(user._id))) return true;

    const led = headedDepartmentIds(user);
    if (!led.length) return false;

    const memberIds = (await departmentMemberIds(led)).map(idStr);
    return assignees.some((assignee) => memberIds.includes(assignee));
};

/** May `user` assign work to *every* id in `userIds`? Limited to departments they head. */
const canAssignTo = async (user, userIds) => {
    if (user.role === "admin") return true;

    const led = headedDepartmentIds(user);
    if (!led.length) return false;

    const memberIds = (await departmentMemberIds(led)).map(idStr);
    return userIds.every((id) => memberIds.includes(idStr(id)));
};

/**
 * Which screens this user may reach. The union across their departments -
 * being in Sales AND Marketing grants both sets.
 *
 * Admins are special-cased: they hold no memberships, so nothing would grant
 * them anything.
 */
const modulesFor = async (user) => {
    if (user.role === "admin") return [...MODULES];

    const ids = (user.memberships || []).map((m) => m.department).filter(Boolean);
    if (!ids.length) return [];

    const departments = await Department.find({ _id: { $in: ids } }).select('modules').lean();
    return [...new Set(departments.flatMap((department) => department.modules || []))];
};

module.exports = {
    MODULES, departmentMemberIds, headedDepartmentIds,
    scopeFor, canAccessTask, canAssignTo, modulesFor, idStr,
};
```

- [ ] **Step 6: Run the smoke tests to verify they pass**

```bash
npm test
```

Expected: PASS, ending with `All smoke checks passed.`

- [ ] **Step 7: Commit**

```bash
git add server/model/user.model.js server/model/department.model.js server/utils/scope.js server/test.smoke.js
git commit -m "Let a person belong to several departments and head only some"
```

---

### Task 2: Membership as an operation

`addDepartmentMember` currently overwrites `user.department`. It has to push instead, and headship has to be asked for explicitly.

**Files:**
- Modify: `server/controller/department.controller.js`

**Interfaces:**
- Consumes: `headedDepartmentIds`, `departmentMemberIds` from Task 1.
- Produces: `POST /api/departments/:id/members` now accepts `{ userId, head }` (`head` defaults to `false`). No other signature changes.

- [ ] **Step 1: Re-base the read paths**

In `server/controller/department.controller.js`:

Replace `headScopeMismatch` (line ~7):

```js
/** A head may only ever act on a department they actually lead. */
const headScopeMismatch = (req) =>
    req.user.role === "head" &&
    !headedDepartmentIds(req.user).some((id) => String(id) === String(req.params.id));
```

Add the import at the top:

```js
const { headedDepartmentIds } = require('../utils/scope.js');
```

In `getDepartments`, replace the filter block. A head manages only what they lead — a Marketing HOD who is also a Sales rep must not get Sales' roster:

```js
        const led = headedDepartmentIds(req.user);
        if (req.user.role === "head" && !led.length) {
            return res.json({ departments: [] });
        }
        const filter = req.user.role === "head" ? { _id: { $in: led } } : {};
```

In the same function, the member count becomes:

```js
            memberCount: await User.countDocuments({ 'memberships.department': department._id }),
```

In `getDepartmentById`, replace the member lookup:

```js
        const members = await User.find({ 'memberships.department': department._id })
```

- [ ] **Step 2: Rewrite `addDepartmentMember`**

Replace the body from the `user.role === "admin"` check through `await user.save();`:

```js
        if (user.role === "admin") {
            return res.status(400).json({ message: "Admins do not belong to a department" });
        }

        const wantsHead = Boolean(req.body.head);

        // Headship is a role-level privilege, so a member cannot be made head
        // of anything - otherwise adding a rep to a department would hand them
        // assign rights over the whole team.
        if (wantsHead && user.role !== "head") {
            return res.status(400).json({ message: "Only a user with the head role can lead a department" });
        }

        if (user.memberships.some((m) => String(m.department) === String(department._id))) {
            return res.status(409).json({ message: `${user.name} is already in this department` });
        }

        // One head per department. Two people with assign rights over the same
        // team is the thing this prevents; one person heading TWO departments
        // is fine and deliberate.
        if (wantsHead) {
            const existingHead = await User.findOne({
                memberships: { $elemMatch: { department: department._id, head: true } },
                _id: { $ne: user._id },
            });
            if (existingHead) {
                return res.status(409).json({
                    message: `${existingHead.name} is already head of this department`,
                });
            }
        }

        user.memberships.push({ department: department._id, head: wantsHead });
        await user.save();
```

- [ ] **Step 3: Rewrite `removeDepartmentMember`**

Replace from the `String(user.department ...)` check through `await user.save();`:

```js
        const before = user.memberships.length;
        user.memberships = user.memberships.filter(
            (m) => String(m.department) !== String(req.params.id)
        );
        if (user.memberships.length === before) {
            return res.status(400).json({ message: "User is not in this department" });
        }

        await user.save();
```

- [ ] **Step 4: Detach members on department delete**

In `deleteDepartment`, replace the `User.updateMany` line:

```js
        // Members outlive their department - drop the membership rather than
        // orphaning a dangling reference.
        await User.updateMany(
            { 'memberships.department': department._id },
            { $pull: { memberships: { department: department._id } } }
        );
```

- [ ] **Step 5: Accept `modules` on update**

In `updateDepartment`, the call is currently `Department.findByIdAndUpdate(req.params.id, { name }, ...)`. Replace the update document so an admin can tick boxes. Build it conditionally so a rename does not wipe the modules:

```js
        const changes = {};
        if (req.body.name !== undefined) changes.name = req.body.name;
        // Filtered against the enum: an unknown string would fail validation
        // on save and 500, and silently dropping it is the kinder failure.
        if (req.body.modules !== undefined) {
            changes.modules = (req.body.modules || []).filter((m) => MODULES.includes(m));
        }

        const department = await Department.findByIdAndUpdate(
            req.params.id,
            changes,
```

Add `MODULES` to the scope import at the top of the file:

```js
const { headedDepartmentIds, MODULES } = require('../utils/scope.js');
```

- [ ] **Step 6: Check the file parses**

```bash
node -e "require('./server/controller/department.controller.js'); console.log('ok')"
```

Expected: `ok`. (The e2e suite still fails at this point — other controllers have not been converted yet. That is expected.)

- [ ] **Step 7: Commit**

```bash
git add server/controller/department.controller.js
git commit -m "Make joining a department an operation rather than a field assignment"
```

---

### Task 3: Convert the remaining controllers

**Files:**
- Modify: `server/controller/task.controller.js`
- Modify: `server/controller/user.controller.js`
- Modify: `server/controller/auth.controller.js`
- Modify: `server/controller/lead.controller.js`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: login, register and profile responses now carry `modules: string[]`. The client reads this in Task 6.

- [ ] **Step 1: Fix the completion-notice recipients**

In `server/controller/task.controller.js`, replace the body of `completionWatchers`:

```js
const completionWatchers = async (task) => {
    const assignees = await User.find({ _id: { $in: task.assignedTo || [] } }).select("memberships");
    const departments = [...new Set(
        assignees.flatMap((user) => (user.memberships || []).map((m) => String(m.department)))
    )];
    // `head: true` matters: without it a head would be copied on completions
    // from a department they merely belong to as a rep.
    const oversight = await User.find({
        $or: [
            { role: "admin" },
            { memberships: { $elemMatch: { department: { $in: departments }, head: true } } },
        ],
    }).select("_id");

    return [...watchersOf(task), ...oversight.map((user) => user._id)];
};
```

- [ ] **Step 2: Re-base the dashboard scope**

In the same file, in `getDashboardData`, replace the `memberIds` lines:

```js
        const scope = await scopeFor(req.user);
        const led = headedDepartmentIds(req.user);
        const memberIds = led.length ? await departmentMemberIds(led) : null;
        const userFilter = memberIds ? { _id: { $in: memberIds } } : {};
```

Update the import at the top of the file to include `headedDepartmentIds`:

```js
const { scopeFor, canAccessTask, canAssignTo, departmentMemberIds, headedDepartmentIds } = require('../utils/scope.js');
```

- [ ] **Step 3: Re-base the user lists**

In `server/controller/user.controller.js`, in `getUser`:

```js
        // Admins may assign to anyone (members and heads alike); a head only
        // ever sees the people in departments they lead.
        const led = headedDepartmentIds(req.user);
        const filter = req.user.role === "head"
            ? { _id: { $in: await departmentMemberIds(led) } }
            : { role: { $in: ["member", "head"] } };

        const users = await User.find(filter)
            .select("-password")
            .populate("memberships.department", "name");
```

In `getUserById`, replace the head branch of the allowed-ids expression:

```js
                ? (await departmentMemberIds(headedDepartmentIds(req.user))).map(String)
```

Update the import:

```js
const { departmentMemberIds, headedDepartmentIds } = require('../utils/scope.js');
```

In the CSV import, replace the `department: row.department,` line in the user-creation object with:

```js
                // One department per CSV row, joined as an ordinary member.
                memberships: row.department ? [{ department: row.department, head: false }] : [],
```

- [ ] **Step 4: Return `modules` from the auth endpoints**

In `server/controller/auth.controller.js`, add the import at the top:

```js
const { modulesFor } = require("../utils/scope.js");
```

In `registerUser` and `loginUser`, add one line to each response object, after `role: user.role,`:

```js
            modules: await modulesFor(user),
```

In `getUserProfile`, replace `res.json(user);` with:

```js
        // The client gates its nav and routes on this, so the rule has exactly
        // one implementation and it lives on the server.
        res.json({ ...user.toObject(), modules: await modulesFor(user) });
```

- [ ] **Step 5: Correct two error strings**

In `server/controller/lead.controller.js`, both occurrences (around lines 89 and 200) of:

```js
"You can only assign leads to members of your own department"
```

become:

```js
"You can only assign leads to members of a department you head"
```

- [ ] **Step 6: Check every file parses**

```bash
node -e "['task','user','auth','lead'].forEach(n => require('./server/controller/'+n+'.controller.js')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 7: Commit**

```bash
git add server/controller/
git commit -m "Re-base every access check onto departments a user heads"
```

---

### Task 4: The module gate

**Files:**
- Modify: `server/middleware/authMiddleware.js`
- Modify: `server/routes/lead.route.js`
- Test: `server/test.integration.js`

**Interfaces:**
- Consumes: `modulesFor` from Task 1.
- Produces: `requireModule(name) -> middleware`, exported from `authMiddleware.js`.

- [ ] **Step 1: Update the existing sales block so headship is explicit**

This is a **breaking change to tests that currently pass.** The sales block adds `crmHead` with a bare `{ userId }`, which used to confer headship implicitly via `role: "head"`. It no longer does, so `headList` and `headPipe` would silently narrow to that user's own leads.

In `server/test.integration.js`, find the loop at approximately line 782:

```js
        for (const u of [crmHead, rep, rival]) {
            await call("POST", "/api/departments/" + crm._id + "/members", { token: A, body: { userId: u._id } });
        }
```

Replace it with:

```js
        for (const u of [crmHead, rep, rival]) {
            await call("POST", "/api/departments/" + crm._id + "/members", {
                // Headship is explicit now - the head role alone does not grant it.
                token: A, body: { userId: u._id, head: String(u._id) === String(crmHead._id) },
            });
        }
        // The CRM department must grant both screens or every call below 403s.
        await call("PUT", "/api/departments/" + crm._id, { token: A, body: { modules: ["sales", "leads"] } });
```

Then search the whole file for any other `"/members"` POST and add `head:` where the user being added is meant to lead — an earlier block sets up a `head` for task tests and will otherwise lose its scope.

- [ ] **Step 2: Write the failing integration assertions**

In `server/test.integration.js`, insert this immediately before the `pass("Sales Pipeline", ...)` line (around line 975). It introduces a genuine dual-member.

```js
        // ---------- DEPARTMENT MODULE ACCESS ----------
        // Marketing grants Leads only; Sales grants both. A rep in BOTH is the
        // case the single-department model could not express at all.
        const mkt = (await call("POST", "/api/departments", { token: A, body: { name: "Mktg" } })).body.department;
        const walled = (await call("POST", "/api/departments", { token: A, body: { name: "Walled" } })).body.department;
        await call("PUT", "/api/departments/" + mkt._id, { token: A, body: { modules: ["leads"] } });
        // `walled` deliberately gets no modules at all.

        const mktHead = (await call("POST", "/api/auth/register", {
            body: { name: "Maya Marketing", email: "mkthead@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        const outsider = (await call("POST", "/api/auth/register", {
            body: { name: "Owen Outsider", email: "outsider@example.test", password: "pw123456" },
        })).body;
        const MH = mktHead.token, OU = outsider.token;

        await call("POST", "/api/departments/" + mkt._id + "/members", { token: A, body: { userId: mktHead._id, head: true } });
        await call("POST", "/api/departments/" + walled._id + "/members", { token: A, body: { userId: outsider._id } });
        // The dual-member: already a CRM rep, now also in Marketing.
        await call("POST", "/api/departments/" + mkt._id + "/members", { token: A, body: { userId: rep._id } });

        // A department with no modules ticked loses both screens entirely.
        assert.strictEqual((await call("GET", "/api/leads", { token: OU })).status, 403,
            "a department granting nothing cannot reach the lead list");
        assert.strictEqual((await call("GET", "/api/leads/pipeline", { token: OU })).status, 403,
            "...nor the pipeline");

        // Marketing grants leads but not sales.
        assert.strictEqual((await call("GET", "/api/leads", { token: MH })).status, 200,
            "the marketing head reaches the lead list");
        assert.strictEqual((await call("GET", "/api/leads/pipeline", { token: MH })).status, 403,
            "the marketing head does NOT reach the sales dashboard");

        // Modules are a union: the rep is in CRM (both) and Marketing (leads).
        assert.strictEqual((await call("GET", "/api/leads/pipeline", { token: R })).status, 200,
            "a member of a sales-granting department keeps the dashboard");

        // The accepted consequence of a shared lead pool: leads carry no
        // department, so BOTH of the rep's heads see all of the rep's leads.
        const mktList = await call("GET", "/api/leads", { token: MH });
        assert.ok(mktList.body.leads.some((l) => String(l.owner._id) === String(rep._id)),
            "the marketing head sees the dual-member's leads, including CRM ones");

        // A head's assign rights follow the departments they LEAD. rival is
        // CRM-only, and mktHead heads Marketing, so this must be refused.
        assert.strictEqual(
            (await call("POST", "/api/leads", {
                token: MH,
                body: { company: "Out Of Reach", product: "Internet", source: "Website", owner: rival._id },
            })).status,
            403, "a head cannot assign a lead to someone outside the departments they lead");

        // Headship is not implied by the role, and not granted by joining.
        assert.strictEqual(
            (await call("POST", "/api/departments/" + walled._id + "/members", { token: A, body: { userId: rep._id, head: true } })).status,
            400, "a member cannot be made head of a department");
        assert.strictEqual(
            (await call("POST", "/api/departments/" + mkt._id + "/members", { token: A, body: { userId: rep._id } })).status,
            409, "joining the same department twice is refused");

        // One head per department still holds...
        const spare = (await call("POST", "/api/auth/register", {
            body: { name: "Sam Spare", email: "spare@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        assert.strictEqual(
            (await call("POST", "/api/departments/" + mkt._id + "/members", { token: A, body: { userId: spare._id, head: true } })).status,
            409, "a department still cannot have two heads");

        // ...but one person heading two departments is now allowed.
        assert.strictEqual(
            (await call("POST", "/api/departments/" + walled._id + "/members", { token: A, body: { userId: mktHead._id, head: true } })).status,
            200, "a head may lead a second department");

        // A head merely a member elsewhere gains no rights there: mktHead heads
        // Marketing and Walled, but is not in CRM, so CRM-only leads owned by
        // rival stay invisible.
        const mktLeads = (await call("GET", "/api/leads", { token: MH })).body.leads;
        assert.ok(!mktLeads.some((l) => String(l.owner._id) === String(rival._id)),
            "a head sees nothing from a department they do not lead or belong to");

        // The profile carries the computed modules, so the client never re-derives them.
        const mktProfile = await call("GET", "/api/auth/profile", { token: MH });
        assert.deepStrictEqual(mktProfile.body.modules, ["leads"], "profile reports the granted modules");
        const adminProfile = await call("GET", "/api/auth/profile", { token: A });
        assert.deepStrictEqual(adminProfile.body.modules.sort(), ["leads", "sales"], "an admin gets everything");

        pass("Module Access", "sales/leads gated per department, dual membership, explicit headship");
```

- [ ] **Step 3: Run the integration suite to verify it fails**

```bash
npm run test:e2e
```

Expected: FAIL — the module endpoints return 200 where 403 is asserted, because no gate exists yet.

- [ ] **Step 4: Add the middleware**

In `server/middleware/authMiddleware.js`, add the import at the top:

```js
const { modulesFor } = require('../utils/scope.js');
```

Add before `module.exports`:

```js
/**
 * Gate a route on a module a department grants, e.g. requireModule("leads").
 *
 * 403, not the 404 used for out-of-scope records: that 404 exists so a
 * response cannot confirm a record's existence, and a module gate reveals
 * nothing about records.
 */
const requireModule = (name) => async (req, res, next) => {
    try {
        const modules = await modulesFor(req.user);
        if (!modules.includes(name)) {
            return res.status(403).json({
                message: `Access denied, ${name} is not enabled for your department`,
            });
        }
        next();
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
```

And extend the exports:

```js
module.exports = { adminOnly, allowRoles, protect, requireModule }
```

- [ ] **Step 5: Apply the gate to the lead routes**

Replace the route block in `server/routes/lead.route.js`:

```js
const { protect, adminOnly, requireModule } = require('../middleware/authMiddleware.js');
const sales = requireModule('sales');
const leads = requireModule('leads');

// Static paths must stay above '/:id' or Express matches them as a lead id.
// The dashboard is the only `sales` endpoint; everything else is `leads`.
router.get('/pipeline', protect, sales, getPipeline);

router.get('/', protect, leads, listLeads);
// Anyone whose department grants leads may log one - a rep who takes a call
// must be able to record it. Ownership rules live in the controller.
router.post('/', protect, leads, createLead);

router.put('/:id/stage', protect, leads, updateLeadStage);
router.post('/:id/outcome', protect, leads, logOutcome);

router.get('/:id', protect, leads, getLeadById);
router.put('/:id', protect, leads, updateLead);
router.delete('/:id', protect, leads, adminOnly, deleteLead);
```

- [ ] **Step 6: Run the integration suite to verify it passes**

```bash
npm run test:e2e
```

Expected: PASS, with `[PASS] Module Access` in the summary. **This is the first point at which the whole server is working again.**

- [ ] **Step 7: Commit**

```bash
git add server/middleware/authMiddleware.js server/routes/lead.route.js server/test.integration.js
git commit -m "Gate the Sales and Leads endpoints on department modules"
```

---

### Task 5: Migration and seed

**Files:**
- Create: `server/scripts/migrate-memberships.js`
- Modify: `server/scripts/seed-demo.js`

**Interfaces:**
- Consumes: nothing (the migration deliberately uses the raw driver, not the models).
- Produces: nothing other code imports.

- [ ] **Step 1: Write the migration**

Create `server/scripts/migrate-memberships.js`:

```js
/**
 * One-way migration: `User.department` (a single id) becomes
 * `User.memberships: [{department, head}]`, and the two live departments get
 * their module tick boxes.
 *
 * Idempotent - a user who already has `memberships` is skipped, so a re-run
 * after a partial failure is safe.
 *
 * Uses the raw driver rather than the Mongoose models on purpose: `department`
 * no longer exists on the schema, so a model read cannot see the value this
 * script has to migrate.
 *
 *     node server/scripts/migrate-memberships.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

// Which department grants which screen. Matched by name, once, here - after
// this the tick boxes live in the database and an admin edits them in the UI.
const GRANTS = { Sales: ['sales', 'leads'], Marketing: ['leads'] };

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const users = mongoose.connection.collection('users');
    const departments = mongoose.connection.collection('departments');

    let migrated = 0, skipped = 0;
    for await (const user of users.find({})) {
        if (Array.isArray(user.memberships)) { skipped += 1; continue; }

        // An admin holds no memberships; everyone else keeps the one they had,
        // and heads keep headship of it.
        const memberships = (user.department && user.role !== 'admin')
            ? [{ department: user.department, head: user.role === 'head' }]
            : [];

        await users.updateOne(
            { _id: user._id },
            { $set: { memberships }, $unset: { department: "" } }
        );
        migrated += 1;
    }

    // Default everything to "grants nothing", then tick the two that do.
    await departments.updateMany({ modules: { $exists: false } }, { $set: { modules: [] } });
    for (const [name, modules] of Object.entries(GRANTS)) {
        const result = await departments.updateOne({ name }, { $set: { modules } });
        console.log(`  ${name.padEnd(12)} ${result.matchedCount ? modules.join(', ') : 'NOT FOUND - tick it by hand'}`);
    }

    console.log(`\n  ${migrated} users migrated, ${skipped} already had memberships.`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((error) => { console.error('MIGRATION FAILED:', error.message); process.exit(1); });
```

- [ ] **Step 2: Verify the migration against a throwaway database**

```bash
node -e "
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
(async () => {
  const m = await MongoMemoryServer.create();
  process.env.MONGO_URI = m.getUri() + 'migtest';
  await mongoose.connect(process.env.MONGO_URI);
  const d = await mongoose.connection.collection('departments').insertOne({ name: 'Sales' });
  await mongoose.connection.collection('users').insertMany([
    { name: 'head', role: 'head', department: d.insertedId },
    { name: 'member', role: 'member', department: d.insertedId },
    { name: 'admin', role: 'admin', department: null },
  ]);
  await mongoose.disconnect();
  require('child_process').execSync('node server/scripts/migrate-memberships.js', { stdio: 'inherit', env: process.env });
  await mongoose.connect(process.env.MONGO_URI);
  const users = await mongoose.connection.collection('users').find({}).toArray();
  console.log(JSON.stringify(users.map(u => ({ n: u.name, m: u.memberships, old: u.department })), null, 1));
  const assert = require('assert');
  assert.strictEqual(users.find(u => u.name === 'head').memberships[0].head, true, 'head keeps headship');
  assert.strictEqual(users.find(u => u.name === 'member').memberships[0].head, false, 'member does not gain it');
  assert.deepStrictEqual(users.find(u => u.name === 'admin').memberships, [], 'admin holds none');
  assert.ok(users.every(u => u.department === undefined), 'the old field is gone');
  console.log('migration verified');
  await mongoose.disconnect(); await m.stop(); process.exit(0);
})();
"
```

Expected: ends with `migration verified`.

- [ ] **Step 3: Re-run it to prove idempotence**

Run the same command again. Expected: the summary line reports `0 users migrated, 3 already had memberships` on the second pass of the script within the block.

- [ ] **Step 4: Update the demo seed**

In `server/scripts/seed-demo.js`, find the user-creation object (around line 146) and replace:

```js
                department: departments[person.department]._id,
```

with:

```js
                memberships: [{
                    department: departments[person.department]._id,
                    head: person.role === 'head',
                }],
```

Then replace the remaining-members count in the `--clean` path (around line 107):

```js
        const remaining = await User.countDocuments({ 'memberships.department': dept._id });
```

- [ ] **Step 5: Commit**

```bash
git add server/scripts/
git commit -m "Migrate existing users onto memberships"
```

---

### Task 6: Gate the client nav and routes

**Files:**
- Modify: `client/src/utils/roles.js`
- Modify: `client/src/utils/data.js`
- Modify: `client/src/components/layouts/SideMenu.jsx`
- Modify: `client/src/routes/PrivateRoute.jsx`
- Modify: `client/src/App.jsx`

**Interfaces:**
- Consumes: `modules` on the user object, from Task 3.
- Produces: `hasModule(user, name) -> boolean`; `PrivateRoute` accepts a `requiresModule` prop.

- [ ] **Step 1: Add the helper**

Append to `client/src/utils/roles.js`:

```js
/**
 * Which screens this user's departments grant. The server computes it and
 * sends it on the profile, so the rule has exactly one implementation.
 */
export const hasModule = (user, name) => (user?.modules || []).includes(name);
```

- [ ] **Step 2: Tag the nav entries**

In `client/src/utils/data.js`, add `module:` to all six Sales/Leads entries — two in each of the three menus:

```js
  { id: "06a", label: "Sales", icon: LuTrendingUp, path: "/sales", module: "sales" },
  { id: "06b", label: "Leads", icon: LuContact, path: "/sales/leads", module: "leads" },
```

Keep each entry's existing `id` and formatting; only the `module` key is new. In `SIDE_MENU_HEAD_DATA` the ids are `05a`/`05b` and in `SIDE_MENU_USER_DATA` they are `04a`/`04b`.

- [ ] **Step 3: Filter the menu**

In `client/src/components/layouts/SideMenu.jsx`, add the import:

```js
import { hasModule } from '../../utils/roles';
```

Replace the `setSideMenuData` line inside the `useEffect`:

```js
      // An untagged entry always shows; a tagged one needs its module, so a
      // department that grants nothing simply has no Sales or Leads link.
      const menu = menuByRole[user?.role] || SIDE_MENU_USER_DATA;
      setSideMenuData(menu.filter((item) => !item.module || hasModule(user, item.module)));
```

- [ ] **Step 4: Add the route guard**

In `client/src/routes/PrivateRoute.jsx`, update the import:

```js
import { homeFor, hasModule } from '../utils/roles';
```

Change the signature to `const PrivateRoute = ({ allowedRoles, requiresModule }) => {` and add this immediately after the existing wrong-role check:

```js
  // Same treatment as a wrong role: a bookmarked /sales for someone whose
  // department does not grant it behaves like any other unauthorised URL.
  // UX only - requireModule on the server is what enforces this.
  if (requiresModule && !hasModule(user, requiresModule)) {
    return <Navigate to={homeFor(user)} replace />;
  }
```

Update the docblock's second line to:

```
 * `allowedRoles` omitted means "any signed-in user"; `requiresModule` gates on
 * a module the user's departments grant.
```

- [ ] **Step 5: Split the sales routes**

In `client/src/App.jsx`, remove the three sales routes and their comment from the "any signed-in user" block, and add two new blocks immediately after it:

```jsx
              {/* Sales and Leads are granted per department (Department.modules).
                  This guard is UX only - requireModule on the API enforces it. */}
              <Route element={<PrivateRoute requiresModule="sales" />}>
                <Route path="/sales" element={<SalesDashboard />} />
              </Route>
              <Route element={<PrivateRoute requiresModule="leads" />}>
                <Route path="/sales/leads" element={<Leads />} />
                <Route path="/sales/leads/:id" element={<LeadDetail />} />
              </Route>
```

- [ ] **Step 6: Lint and build**

```bash
npm run lint --prefix client && npm run build --prefix client
```

Expected: no errors. If `eslint` is not found, run `npm install --prefix client` first — the worktree may not have client dependencies installed.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/roles.js client/src/utils/data.js client/src/components/layouts/SideMenu.jsx client/src/routes/PrivateRoute.jsx client/src/App.jsx
git commit -m "Hide Sales and Leads from departments that do not grant them"
```

---

### Task 7: Admin controls for modules and headship

**Files:**
- Modify: `client/src/pages/Admin/ManageDepartments.jsx`
- Modify: `client/src/utils/apiPaths.js` (comment only)

**Interfaces:**
- Consumes: `PUT /api/departments/:id` accepting `{ modules }` and `POST /api/departments/:id/members` accepting `{ userId, head }`, both from Task 2.
- Produces: nothing other code imports.

- [ ] **Step 1: Update the API path comment**

In `client/src/utils/apiPaths.js`, line 42:

```js
        ADD_MEMBER: (id) => `/api/departments/${id}/members`,            // { userId, head }
```

- [ ] **Step 2: Fix the candidate filter**

In `client/src/pages/Admin/ManageDepartments.jsx`, the `candidates` filter at
line ~125 currently reads:

```js
  const candidates = assignableUsers.filter(
    (user) => String(user.department?._id || user.department || '') !== selectedId
  );
```

Replace it so someone already in the open department is not offered again:

```js
  const candidates = assignableUsers.filter(
    (user) => !(user.memberships || []).some(
      (m) => String(m.department?._id || m.department || '') === selectedId
    )
  );
```

- [ ] **Step 3: Add the "as head" checkbox**

Add state near the other `useState` calls:

```js
  const [asHead, setAsHead] = useState(false);
```

In `addMember`, include it in the POST body — the existing state variable is `addUserId`:

```js
        API_PATHS.DEPARTMENTS.ADD_MEMBER(selected.department._id),
        { userId: addUserId, head: asHead }
```

Reset it on success, immediately after `toast.success('Member added');`:

```js
      setAsHead(false);
```

Add the control beside the existing Add button (around line 231), matching the surrounding token classes:

```jsx
              <label className="flex items-center gap-2 text-xs text-mist shrink-0">
                <input
                  type="checkbox"
                  checked={asHead}
                  onChange={(e) => setAsHead(e.target.checked)}
                  className="accent-[#7fc7ff]"
                />
                as head
              </label>
```

- [ ] **Step 4: Add the module tick boxes**

Add a handler beside the other actions:

```js
  const toggleModule = async (department, name) => {
    const next = (department.modules || []).includes(name)
      ? department.modules.filter((m) => m !== name)
      : [...(department.modules || []), name];
    try {
      await axiosInstance.put(API_PATHS.DEPARTMENTS.UPDATE(department._id), { modules: next });
      toast.success(`${department.name}: ${next.length ? next.join(' + ') : 'no screens'}`);
      loadDepartments();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update modules');
    }
  };
```

Render it inside each department card, directly below the member-count `<p>` at
line ~187 and above the "Manage members" button. The card itself is not
clickable (that button is), so no event-bubbling guard is needed:

```jsx
                    <div className="flex items-center gap-3">
                      {[['sales', 'Sales'], ['leads', 'Leads']].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-1.5 text-xs text-mist">
                          <input
                            type="checkbox"
                            checked={(department.modules || []).includes(key)}
                            onChange={() => toggleModule(department, key)}
                            className="accent-[#7fc7ff]"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
```


- [ ] **Step 5: Show who heads what**

The member list at line ~245 renders `roleLabel[member.role]`, which now overstates things — a `head` listed under a department they do not lead would read "Head of Department". Replace that expression with a per-department lookup:

```jsx
                      {(member.memberships || []).some(
                        (m) => String(m.department?._id || m.department) === selectedId && m.head
                      ) ? 'Head of Department' : 'Member'}
```

- [ ] **Step 6: Lint and build**

```bash
npm run lint --prefix client && npm run build --prefix client
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Admin/ManageDepartments.jsx client/src/utils/apiPaths.js
git commit -m "Let an admin tick department screens and name a head"
```

---

### Task 8: Full verification

The previous sales-pipeline work shipped a production bug that every automated test passed. Click the thing.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Run both suites**

```bash
npm test && npm run test:e2e
```

Expected: both pass; `[PASS] Module Access` appears in the e2e summary.

- [ ] **Step 2: Lint and build the client**

```bash
npm run lint --prefix client && npm run build --prefix client
```

- [ ] **Step 3: Confirm nothing still reads the removed field**

```bash
grep -rn "\.department\b" server/ client/src/ --include=*.js --include=*.jsx | grep -v node_modules | grep -v "memberships.department" | grep -v "selected.department" | grep -v "department.name" | grep -v "department._id"
```

Expected: no hit that reads a **user's** `department`. Hits on a Department document's own fields are fine. Investigate anything else.

- [ ] **Step 4: Seed a local database and click through**

```bash
node server/scripts/seed-demo.js
```

Then run the app (`npm run dev`) and verify by hand:

1. Sign in as an admin → both Sales and Leads appear in the sidebar.
2. On Manage Departments, tick **Sales** and **Leads** on one department and only **Leads** on another.
3. Sign in as a member of the leads-only department → **Sales is absent from the sidebar**, Leads is present, and browsing directly to `/sales` redirects to their dashboard.
4. Sign in as a member of a department with nothing ticked → neither link appears.
5. Add one member to two departments. Sign in as each department's head and confirm both see that person's leads.
6. Add a `head`-role user to a second department **without** ticking "as head" → confirm the member list shows them as **Member** there, and that they cannot assign tasks to that department's people.
7. Try to add a second head to one department → expect the 409 message.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "Fix <what manual testing found>"
```

If nothing was found, skip this step.

---

### Task 9: Production migration

**Do not start this task without explicit approval.** It rewrites every user document on the live system, and `/opt/taskmanager` is not a git repository — there is no rollback ref. The `mongodump` is the only undo.

**Files:** none in the repo.

- [ ] **Step 1: Back up the users collection**

```bash
ssh taskmanager-prod "mongodump --db taskmanager --collection users --out ~/taskmanager-backups/premembership-\$(date +%Y%m%d-%H%M%S) && ls -la ~/taskmanager-backups/"
```

Expected: a dated directory containing `taskmanager/users.bson`.

- [ ] **Step 2: Deploy the changed files**

One file per `scp` — a multi-file `scp` has silently skipped files on this host,
and a zero exit code is not evidence the bytes landed. Never put `ssh` inside a
`while read` loop; it eats the file list from stdin and reports success for one
file.

```bash
FILES="server/model/user.model.js server/model/department.model.js server/utils/scope.js server/middleware/authMiddleware.js server/routes/lead.route.js server/controller/department.controller.js server/controller/task.controller.js server/controller/user.controller.js server/controller/auth.controller.js server/controller/lead.controller.js server/scripts/seed-demo.js server/scripts/migrate-memberships.js client/src/utils/roles.js client/src/utils/data.js client/src/utils/apiPaths.js client/src/components/layouts/SideMenu.jsx client/src/routes/PrivateRoute.jsx client/src/App.jsx client/src/pages/Admin/ManageDepartments.jsx"
for f in $FILES; do
  ssh -n taskmanager-prod "mkdir -p /opt/taskmanager/$(dirname $f)"
  scp "$f" "taskmanager-prod:/opt/taskmanager/$f" || echo "SCP FAILED: $f"
done
# Verify every one landed, counting matches rather than trusting "no failures".
for f in $FILES; do
  L=$(sha256sum "$f" | cut -d' ' -f1)
  R=$(ssh -n taskmanager-prod "tr -d '' < /opt/taskmanager/$f | sha256sum | cut -d' ' -f1")
  Lx=$(tr -d '' < "$f" | sha256sum | cut -d' ' -f1)
  [ "$R" = "$Lx" ] && echo "ok   $f" || echo "DRIFT $f"
done | tee /tmp/verify.txt
grep -c '^ok' /tmp/verify.txt   # must equal the file count
```

Both line endings must be tried: the box has a mix of LF and CRLF even where
content is identical, so a bare hash mismatch is not evidence of drift.

Then rebuild the client with zero downtime — building straight into `dist`
empties it first and the live site 404s its assets for the length of the build:

```bash
ssh taskmanager-prod "cd /opt/taskmanager/client && npx vite build --outDir dist-new --emptyOutDir && ls dist-new/index.html && mv dist dist-old-\$(date +%Y%m%d-%H%M%S) && mv dist-new dist"
```

- [ ] **Step 3: Run the migration**

```bash
ssh taskmanager-prod "cd /opt/taskmanager && node server/scripts/migrate-memberships.js"
```

Expected: a per-department line for Sales and Marketing, then the migrated/skipped summary. If either department reports `NOT FOUND`, tick it by hand in the UI afterwards.

- [ ] **Step 4: Restart and verify**

```bash
ssh taskmanager-prod "sudo systemctl restart taskmanager && sleep 3 && systemctl is-active taskmanager && curl -s -o /dev/null -w '%{http_code}\n' https://tm.leoprime.in"
```

Expected: `active` then `200`.

- [ ] **Step 5: Verify the live data**

```bash
ssh taskmanager-prod "mongosh --quiet taskmanager --eval 'db.users.countDocuments({department:{\$exists:true}})' --eval 'db.departments.find({},{name:1,modules:1}).toArray()'"
```

Expected: `0` users still carrying the old field, and Sales showing `['sales','leads']` with Marketing showing `['leads']`.

- [ ] **Step 6: Sign in and confirm** that a Sales member sees both screens, a Marketing member sees Leads only, and a Technical member sees neither.

---

## Notes for the executor

- **`departmentMemberIds` changed signature.** It takes an **array** now. A stray single-id call silently returns `[]` — which fails open as "sees only themselves", so it is a scope *narrowing*, not a leak, but it will look like a bug report about missing data.
- **`scopeFor` returns `$in` for members now**, where it used to return a bare equality. Semantically identical to Mongo; only assertions care.
- **Do not add a `department` virtual** to smooth the transition. The spec rejected it explicitly: it would make every unconverted call site look correct while being arbitrary.
