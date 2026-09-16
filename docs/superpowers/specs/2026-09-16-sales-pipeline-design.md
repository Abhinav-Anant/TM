# Sales Pipeline — Design

Date: 2026-09-16
Status: Approved for planning

## Summary

Add a sales pipeline to TaskManager as a native module: one new Mongoose
collection (`Lead`), one new field on `Task`, one new Express route file, and
three React pages. Sales follow-ups are ordinary Tasks carrying a `lead`
reference, so assignment, due dates, overdue reminders, SSE pushes, WhatsApp
alerts, comments and department scoping all come from machinery that already
runs in production.

## Decisions and the reasoning behind them

### EspoCRM is not part of this system

The original proposal placed EspoCRM behind the app as a headless
system-of-record, with a REST integration layer, outbound webhooks and a
scheduled reconciliation job.

Rejected. EspoCRM requires PHP 8.3–8.5, MariaDB/MySQL, a per-minute cron
daemon and a ZeroMQ/Ratchet websocket daemon. The production box already runs
Node, nginx, MongoDB (pinned to 4.4 because the CPU lacks AVX) and the Blastup
WhatsApp gateway. Adding a second language runtime and a second database buys
a lead table plus a permanent two-datastore consistency problem.

Because the pipeline is one linear list of eight stages across nine products
and ten sources, and because there is no existing lead data to migrate, one
Mongoose model and one field on `Task` cover the requirement with no sync
layer at all.

A shallow clone lives at `C:\Projects\espocrm` as a **reference only** — its
lead field set and stage semantics are worth consulting. Nothing in this
project depends on it and nothing imports from it.

### No Opportunity model, no Account model

A lead past `Qualified` carrying a `value` *is* the opportunity. There is no
conversion step and no second collection.

Known ceiling: a repeat customer who buys Internet and later CCTV becomes two
unlinked `Lead` documents. Group by `company` when repeat business actually
appears in the data; introducing an `Account` now would add a dedupe problem
that does not yet exist.

### Sales is a Department, not a role

Roles stay `admin` / `head` / `member`. The sales manager is the `head` of a
Department named "Sales". This reuses the existing org chart and permission
model without adding a role, a middleware or a migration.

## Data model

### New: `server/model/lead.model.js`

| Field | Type | Notes |
|---|---|---|
| `company` | String, required, trimmed | |
| `contactName` | String, trimmed | |
| `phone` | String, default `null` | Normalised through `utils/phone.js` on write, exactly as `User.phone` is |
| `email` | String, trimmed, lowercased | |
| `source` | String, enum, default `Other` | |
| `product` | String, enum, default `Other` | |
| `value` | Number, default `0` | Rupees. Formatted as ₹L in the client only |
| `stage` | String, enum, default `New` | |
| `owner` | ObjectId → User, required | Single owner, not an array |
| `lostReason` | String, default `null` | |
| `closedAt` | Date, default `null` | Stamped when stage becomes `Won` or `Lost`, cleared if it moves back |
| `history` | array of `{ by: ObjectId→User, text: String, at: Date }` | Append-only |

Enums:

- `source`: `Website`, `WhatsApp`, `Inbound Call`, `Existing Customer`, `Referral`, `Google`, `Facebook`, `Partner`, `Salesperson`, `Other`
- `product`: `Internet`, `Firewall`, `LeoPrime`, `SD-WAN`, `Hotspot`, `VPS`, `CCTV`, `Cloud`, `Other`
- `stage`: `New`, `Contacted`, `Qualified`, `Demo`, `Proposal`, `Negotiation`, `Won`, `Lost`

`timestamps: true`, matching every other model in the project.

Indexes:

- `{ owner: 1, stage: 1 }` — serves both the scoped list and the pipeline aggregation
- `{ createdAt: -1 }` — default list sort

`history` is stored rather than derived. Reconstructing the CRM history panel
from stage diffs plus task records is more code than appending one line per
change.

### Changed: `server/model/task.model.js`

One field added:

```js
lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true }
```

This is the entire link between tasks and leads. They share a database, so
there is no sync, no reconciliation and no stale-stage failure mode.

### Changed: `server/utils/scope.js`

`scopeFor` is hardcoded to the `assignedTo` field. Generalise it:

```js
const scopeFor = async (user, field = 'assignedTo') => {
    if (user.role === "admin") return {};
    if (user.role === "head") {
        return { [field]: { $in: await departmentMemberIds(user.department) } };
    }
    return { [field]: user._id };
};
```

Existing callers are unchanged by the default parameter. Lead code calls
`scopeFor(user, 'owner')`. The `$in` branch works against a single-ObjectId
field as well as an array.

No `canAccessLead` function is added. Every single-lead read and write uses the
scope filter as the authorization check:

```js
const lead = await Lead.findOne({ _id: req.params.id, ...await scopeFor(req.user, 'owner') });
if (!lead) return res.status(404).json({ message: "Lead not found" });
```

A lead outside the caller's scope is indistinguishable from one that does not
exist, which is the correct disclosure behaviour.

## Invariant: an owned lead always has a next action

**Creating a lead always creates its first follow-up Task.** Assigning a lead
to a different owner also creates one.

This is load-bearing in two ways:

1. It guarantees every lead appears in someone's Today or Overdue list. A lead
   cannot go quiet.
2. It means lead alerts ride the existing `utils/notify.js` path unchanged —
   Mongo row, SSE push, WhatsApp through Blastup — with no new
   `Notification.type` enum value and a deep link (`/user/task-details/:id`)
   that already resolves. `notify()` filters out the actor, so a rep logging
   their own lead correctly receives no alert.

The first task is created with `dueDate` from an optional `firstFollowUp` in
the request body, defaulting to 24 hours out; `assignedTo: [owner]`,
`createdBy: req.user._id`, `category: "Sales"`, `lead: lead._id`, and title
`Follow up — <company>` unless the caller supplies one.

## API — `server/routes/lead.route.js`, mounted at `/api/leads`

All routes sit behind `protect`.

| Method | Path | Access | Behaviour |
|---|---|---|---|
| GET | `/` | any | Scoped list. Filters: `stage`, `owner`, `product`, `source`, `q`. Sorted `createdAt: -1` |
| POST | `/` | any | Create. Also creates the first follow-up Task and notifies |
| GET | `/pipeline` | any | Per-stage counts and summed value, scoped. Declared above `/:id` |
| GET | `/:id` | scoped | Lead, its Tasks (`{ lead: id }`, sorted `dueDate: 1`), and its history |
| PUT | `/:id` | scoped | Edit fields |
| PUT | `/:id/stage` | scoped | Advance stage |
| POST | `/:id/outcome` | scoped | Log a touch |
| DELETE | `/:id` | adminOnly | Matches the existing task delete rule |

`/pipeline` must be registered above `/:id`, following the comment already in
`task.route.js` about Express matching static paths as ids.

### POST `/` — create

`owner` defaults to `req.user._id`. A `member` supplying a different `owner`
gets 403; `admin` and `head` may assign freely, with `head` restricted to their
own department via the existing `canAssignTo`.

This is a deliberate deviation from the task rules, where only `admin` and
`head` may create. A rep who takes a call must be able to log the lead.

`phone` is passed through `normalizePhone` before storage. An unparseable
number is stored as `null` rather than rejecting the lead — matching how user
profiles already behave, and degrading reach without blocking the record.

### PUT `/:id` — edit

A `member` supplying `owner` gets 403. `stage` is ignored here; it moves only
through `/stage`, so every stage change is guaranteed to append history.

### PUT `/:id/stage` — advance

Body: `{ stage, note }`. Appends to `history`. Sets `closedAt` when the new
stage is `Won` or `Lost`, clears it when moving back off those. `lostReason`
is accepted and stored when the new stage is `Lost`.

Any stage may move to any other stage. The pipeline is a label, not a state
machine — reps legitimately skip Demo, and a deal legitimately comes back from
Lost.

### POST `/:id/outcome` — log a touch

Body: `{ taskId, outcome, note, nextFollowUp, nextTitle }`.

`outcome` enum: `Interested`, `Follow-up required`, `Proposal requested`,
`Not interested`, `Wrong number`.

Steps, in order:

1. If `taskId` is supplied, load it and verify `String(task.lead) === String(lead._id)`.
   A mismatch is 400. Set its status to `Completed` and `completedAt` to now.
2. If the lead is in stage `New`, move it to `Contacted` — logging any touch
   means contact happened.
3. Apply the stage mapping for the outcome:
   - `Not interested` → `Lost`
   - `Wrong number` → `Lost`
   - `Proposal requested` → `Proposal`
   - `Interested`, `Follow-up required` → no further change
4. Append one history entry recording the outcome and `note`. Only the final
   stage is stored; a `New` lead closed as `Not interested` passes through
   `Contacted` without logging a separate line for it. `closedAt` follows the
   same rule as `/stage` — stamped when the resulting stage is `Won` or `Lost`.
5. If `nextFollowUp` is supplied **and** the resulting stage is neither `Won`
   nor `Lost`, create the successor Task (same shape as the first follow-up,
   title from `nextTitle` or defaulted). Suppressing it on a closed lead keeps
   dead work out of Today lists; the response states that it was skipped.

Returns the updated lead and the created task, if any.

### GET `/pipeline`

```js
Lead.aggregate([
  { $match: await scopeFor(req.user, 'owner') },
  { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
])
```

Returns `stages[]` covering all eight stages including zeroes, so the client
renders a stable funnel rather than a shifting one.

For `admin` and `head` it also returns `owners[]` — per-rep lead count,
pipeline value and won value — which is the management table. A `member` does
not receive `owners[]`.

"Pipeline value" is the sum of `value` over open stages (`New` through
`Negotiation`). "Won value" is the sum over `Won`. Neither is weighted by
probability; there is no forecasting model in this scope.

### Search

`q` matches `company` and `contactName` by case-insensitive regex, with the
input escaped for regex metacharacters.

Known ceiling: a regex scan, correct and fast into the low tens of thousands of
leads. Swap for a text index if the collection outgrows that.

## Frontend

Three new pages, registered in `client/src/App.jsx` behind `PrivateRoute` with
no `allowedRoles` — the API scopes every response, which is the pattern the
existing `/calendar` and `/analytics` routes already use.

| Route | Page | Content |
|---|---|---|
| `/sales` | `pages/Sales/SalesDashboard.jsx` | Stat tiles, pipeline funnel, Overdue and Today panels |
| `/sales/leads` | `pages/Sales/Leads.jsx` | List with stage, product, owner and text filters |
| `/sales/leads/:id` | `pages/Sales/LeadDetail.jsx` | Contact, value, stage control, next actions, history, outcome dialog |

The Overdue and Today panels are the existing task queries filtered to
`lead != null`; they are not a second implementation of due-date logic.

Components come from the existing `components/Cards` and `components/Charts`
so the module matches the dark glass redesign rather than looking bolted on.
Money renders as ₹L in the client; the API always returns plain rupees.

Navigation entry points are added to the existing layout only for users whose
department is Sales, plus `admin`. The routes themselves stay open to any
signed-in user: a member outside Sales who navigates directly to `/sales` sees
an empty pipeline, because the scope filter returns nothing. That is a
deliberate non-guard — hiding the nav link is a UI concern, and the API is
what actually protects the data.

## Testing

Cases added to `server/test.integration.js`, which already runs against
`mongodb-memory-server`:

1. **Scope isolation** — a `member` cannot read, edit or delete another rep's
   lead; a `head` sees their department's leads and not another department's;
   `admin` sees all. This is a permission boundary and is not optional.
2. **Creation invariant** — creating a lead creates exactly one follow-up Task
   carrying the `lead` reference, assigned to the owner.
3. **Stage transition** — appends history, stamps `closedAt` on `Won`/`Lost`,
   clears it on moving back.
4. **Outcome** — completes the referenced task, applies the stage mapping,
   appends history, creates the successor task, and suppresses that successor
   when the lead lands on `Won` or `Lost`.
5. **Cross-lead task rejection** — a `taskId` belonging to a different lead is
   rejected with 400.
6. **Pipeline aggregation** — counts and sums are correct and scoped; `owners[]`
   is absent for a `member`.

## Out of scope

EspoCRM, PHP, MariaDB, webhooks, reconciliation jobs, Account/Contact/
Opportunity models, lead conversion flows, the public website intake endpoint,
CSV import, customer-facing WhatsApp messaging, quote and proposal documents,
email-to-lead, and probability-weighted forecasting.

The public intake endpoint is the most likely next phase. It is a genuine trust
boundary — an unauthenticated write — and needs rate limiting, field validation
and a honeypot designed deliberately rather than bolted on here.

## Size

Roughly 1000 lines: one model, one controller, one route file, a two-line
change to `scope.js`, a one-field change to `task.model.js`, three React pages
and the test cases. No new npm dependencies and no new services on the
production box.
