# Department Module Access — Design

Date: 2026-09-17
Status: Approved for planning

## Summary

Restrict the Sales dashboard and the Leads screens to the departments that own
them, and let one person belong to more than one department.

Two changes carry the whole feature:

1. `User.department` (a single id) becomes
   `User.memberships: [{ department, head }]`. Headship stops being derived
   from `role` and becomes a property of each membership.
2. `Department.modules: ['sales' | 'leads']` decides which screens a
   department grants. Access is the union across a user's departments; admins
   get everything.

There is no change to the `Lead` model. The lead pool stays shared.

## Decisions and the reasoning behind them

### The split is between screens, not between data

Sales and Leads are two views over the same `Lead` collection:
`SalesDashboard` calls `GET /api/leads/pipeline`, and `Leads`/`LeadDetail`
call the rest of `/api/leads`. They share no endpoint except the generic
`GET /api/tasks?category=Sales`.

So "Sales for the Sales HOD, Leads for the Marketing HOD" is a question of
which endpoints each person may call, not of which records exist. No lead
carries a department, and none will.

**Consequence, accepted deliberately:** leads are scoped by `owner` id. If a
member belongs to both Sales and Marketing, *every* head who leads one of
those departments sees *all* of that member's leads — including ones worked
for the other team. Separating them would require a department on the `Lead`
and a handoff path between teams. That was considered and rejected: the unit
of management here is the person, not the pipeline.

### Membership becomes a list; headship becomes explicit

Today `scope.js` derives headship: you are head of the department you are in,
because `role === "head"`. Generalising membership to a list would silently
make a `role: head` user the head of *every* department they join — so a
Marketing HOD added to Sales as a rep would gain assign rights over the whole
Sales team.

Headship therefore moves onto the membership itself. One field still holds the
entire org chart, which preserves the property the current `scope.js` comment
names: there is no second copy to drift out of sync.

Rejected alternatives:

- **A `department` virtual returning the first membership**, to avoid
  rewriting read sites. Halves the diff, but `user.department` would come to
  mean "one of their departments, arbitrarily", and the call sites that look
  untouched are exactly the ones that would be quietly wrong.
- **Keeping `department` as primary and adding `extraDepartments[]`.** Near-zero
  migration, but two fields meaning the same thing, and "one head per
  department" becomes ambiguous across them.
- **A separate `headOf: [ObjectId]` array.** Works, but splits the org chart
  across two fields that must agree.

### `role` keeps its job, minus one

`role` continues to drive routing, menu selection and who may create tasks.
It no longer decides data scope — `memberships[].head` does.

A `role: head` user with no headships is legal (a head between assignments)
and scopes to their own records. The reverse is not: `head: true` on a
membership is rejected unless `role === "head"`.

### Module access is granted by the department, not the person

Alternatives were hard-coding the names `Sales` and `Marketing`, or ticking
modules per user. Hard-coded names break silently on rename and would give
`Field Sales` nothing. Per-user ticks drift from the org chart and must be
remembered for every new hire.

Tick boxes on the department survive renames, put the policy where an admin
can see it, and let any department grant either screen.

Initial configuration:

| Department | `modules` |
|---|---|
| Sales | `['sales', 'leads']` |
| Marketing | `['leads']` |
| Technical, Accounts, and the three demo departments | `[]` |

Sales gets both so its HOD can drill from the dashboard into a lead —
`GET /api/leads/:id` is a `leads` endpoint, so `sales` alone renders a funnel
whose rows are not clickable.

## Data model

### `User` (`server/model/user.model.js`)

```js
const membershipSchema = new mongoose.Schema({
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true },
    head: { type: Boolean, default: false },
}, { _id: false });

// ...on userSchema:
memberships: { type: [membershipSchema], default: [] },
```

This replaces `department`. The explicit sub-schema matches `historySchema` in
`lead.model.js`; an inline `_id: false` inside an array literal is not a
reliable way to suppress it.

Add `userSchema.index({ 'memberships.department': 1 })` — this field lands on
the hot path of nearly every scoped query.

Invariants, enforced on write in `department.controller.js`:

- `head: true` requires `role === "head"`.
- At most one membership per department per user.
- At most one user with `head: true` for a given department. (Unchanged rule;
  what it no longer blocks is one person heading two departments.)
- Admins hold no memberships.

### `Department` (`server/model/department.model.js`)

```js
modules: [{ type: String, enum: ['sales', 'leads'] }],
```

Empty by default, so an existing department grants nothing until an admin
ticks a box.

## Access rules

Two independent gates. **Modules decide which doors exist; `scopeFor` decides
what is behind them.** Neither widens the other.

### Scope

`scopeFor` collapses from three branches to two:

```js
const scopeFor = async (user, field = 'assignedTo') => {
    if (user.role === "admin") return {};
    // Self, plus everyone in the departments this user actually heads.
    const led = user.memberships.filter((m) => m.head).map((m) => m.department);
    return { [field]: { $in: [user._id, ...await departmentMemberIds(led)] } };
};
```

A member heads nothing, so this reduces to `[self]` — the current member
branch, for free. A Marketing head who is also a Sales rep gets all of
Marketing plus their own records, which today's model cannot express.

`departmentMemberIds` takes an array and queries
`{ 'memberships.department': { $in: ids } }`.

`canAccessTask` and `canAssignTo` re-base identically, from "my department" to
"departments I head".

### Modules

```js
const modulesFor = async (user) => {
    if (user.role === "admin") return ["sales", "leads"];
    const depts = await Department
        .find({ _id: { $in: user.memberships.map((m) => m.department) } })
        .select("modules");
    return [...new Set(depts.flatMap((d) => d.modules))];
};
```

Admins are special-cased because they hold no memberships.

| Module | Endpoints |
|---|---|
| `sales` | `GET /api/leads/pipeline` |
| `leads` | `GET`/`POST /api/leads`, `GET`/`PUT`/`DELETE /api/leads/:id`, `PUT /api/leads/:id/stage`, `POST /api/leads/:id/outcome` |

Enforced by a `requireModule(name)` middleware returning **403**.

This is a deliberate break from the codebase's out-of-scope 404 convention.
That convention exists so a 404 cannot confirm a record's existence; a module
gate reveals nothing about records, so a flat 403 is honest and easier to
diagnose.

`GET /api/tasks?category=Sales` — the dashboard's second call — stays ungated.
It is the generic task endpoint, already scoped, and gating it would break the
Tasks screen.

## Server changes

Ten files, plus the two models above.

**`server/utils/scope.js`** — `departmentMemberIds` takes an array; `scopeFor`,
`canAccessTask` and `canAssignTo` re-base onto headed departments; add
`modulesFor` and a `headedDepartmentIds(user)` helper.

**`server/middleware/authMiddleware.js`** — add `requireModule(name)`.

**`server/routes/lead.route.js`** — `requireModule('sales')` on `/pipeline`,
`requireModule('leads')` on everything else. Route ordering is unchanged and
still load-bearing: `/pipeline` must stay above `/:id`.

**`server/controller/department.controller.js`** — the largest change, because
membership becomes an operation rather than a field assignment:

- `addDepartmentMember` takes `{ userId, head }` and pushes a membership
  instead of overwriting one. Rejects `head: true` for a non-`head` role, and
  rejects a duplicate membership.
- The one-head-per-department check becomes
  `memberships: { $elemMatch: { department: id, head: true } }`.
- `removeDepartmentMember` → `$pull`.
- `deleteDepartment` → `$pull` the membership from every user, replacing
  `$set: { department: null }`.
- `getDepartments`, `getDepartmentById` and `headScopeMismatch` re-base onto
  the departments a user **heads**, not merely belongs to. A Marketing HOD who
  is also a Sales rep manages Marketing only and must not reach Sales' member
  list. `memberCount` counts `'memberships.department'`.
- `updateDepartment` accepts `modules`.

**`server/controller/task.controller.js`** — `completionWatchers` currently
finds `{ role: "head", department: { $in: depts } }`; it becomes an
`$elemMatch` requiring `head: true`. Without that, a dual-member would make
their second department's head a recipient of every completion notice there.
`getDashboardData`'s `memberIds` re-bases onto headed departments.

**`server/controller/user.controller.js`** — `getUser` and `getUserById`
re-base; `.populate("department", "name")` becomes
`.populate("memberships.department", "name")`. CSV import creates a single
non-head membership from the existing optional `department` column.

**`server/controller/lead.controller.js`** — no logic change; two error strings
become "a department you head".

**`server/controller/auth.controller.js`** — login and profile responses carry
a computed `modules: []`, so the client reads the decision instead of
re-deriving it.

**`server/utils/csv.js`** — unchanged. One department name per row still maps
cleanly to one membership.

**`server/scripts/seed-demo.js`** — emits memberships.

**`server/scripts/migrate-memberships.js`** — new, idempotent:
`{department: X}` → `[{department: X, head: role === "head"}]`; `null` → `[]`;
then tick `modules` on Sales and Marketing.

## Frontend

Six files. Only `ManageDepartments` ever reads a user's department today, so
the client blast radius is small.

- **`utils/roles.js`** — `hasModule(user, name)` reading the API's `modules`.
- **`utils/data.js`** — tag the Sales and Leads nav entries with
  `module: 'sales' | 'leads'`. They appear in all three menus; tagging is
  per-entry, so no menu is restructured.
- **`components/layouts/SideMenu.jsx`** — one `.filter()` after the role menu
  is chosen. An untagged entry always shows; a tagged one needs its module.
- **`routes/PrivateRoute.jsx`** — a `module` prop beside `allowedRoles`,
  redirecting to `homeFor(user)` exactly as a wrong role does.
- **`App.jsx`** — `/sales` under `module="sales"`; `/sales/leads` and
  `/sales/leads/:id` under `module="leads"`. The existing comment claiming
  that hiding the nav link is "a UI concern, not a guard" is no longer true
  and gets rewritten.
- **`pages/Admin/ManageDepartments.jsx`** — module tick boxes per department,
  an "add as head" checkbox on the member picker, and the line-125 candidate
  filter re-based onto memberships so someone already in a department is not
  offered for it again.

The route guard remains UX only. `requireModule` is what enforces access.

## Migration

The migration rewrites every user document and is one-way.

Order of operations on production:

1. `mongodump` the `users` collection. `/opt/taskmanager` is not a git
   repository and has no rollback ref, so this dump is the only undo.
2. Deploy the code.
3. Run `migrate-memberships.js`.
4. Restart `taskmanager`.

The script is idempotent: a user already holding `memberships` is skipped, so
a re-run after a partial failure is safe.

Backwards compatibility is not attempted. The old `department` field is
removed in the same migration, because leaving it would recreate exactly the
second-copy-of-the-org-chart problem this design avoids.

## Testing

Matching the existing two-file setup.

`server/test.smoke.js` — the branches that never touch the database: `scopeFor`
for admin and for a plain member, `modulesFor` for admin and for a user with no
departments, and `headedDepartmentIds` for the discriminating cases
(head-of-A-member-of-B, and role-without-headship). The head branches of
`scopeFor` need `User` lookups and are covered end-to-end instead, matching how
the existing smoke file already splits them.

`server/test.integration.js` — a new block with a genuine dual-member:

- The Marketing head sees the dual-member's leads.
- The Sales head sees them too (the accepted consequence above, pinned so it
  cannot change silently).
- The Marketing head cannot assign to a Sales-only member.
- A Technical member gets 403 on both `/api/leads` and `/api/leads/pipeline`.
- A Sales member gets 200 on both, scoped to their own records.
- `head: true` is refused for a `member` role.
- A second head of one department is still refused (409).
- A head of two departments is accepted.

The block uses its own departments and actors, as the sales-pipeline block
does, so it does not depend on fixtures an earlier block deletes.

## Out of scope

- A department on the `Lead`, and any Marketing-to-Sales handoff flow.
- Per-department roles beyond the head flag.
- Modules for any screen other than Sales and Leads. The `enum` is deliberately
  two values; widening it is a later decision with its own questions.
- Reworking `role` into something derived from memberships.

## Size

Twelve server files (the two models included), six client files and two
test files - twenty in all, one of them new.
No new dependencies, no new collections, no change to `Lead` or `Task`.
