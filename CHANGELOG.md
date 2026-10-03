# Changelog

## Unreleased — SOHO redesign

### Phase 1 — Foundation (security)
- Uploaded files are no longer public. `/uploads` static serving removed; files are stored through a
  storage driver (`local` or `s3`/MinIO/R2) and served by `GET /api/files/:id`, which requires a session
  and the same access as the task that references the file (uploader, admin, assignee, or head of an
  assignee's department). Non-image files download as attachments, with `nosniff`.
- `POST /api/auth/upload-image` now requires authentication; sign-up uploads the photo after the account exists.
- Web sessions use an HttpOnly, SameSite=Lax cookie (`COOKIE_SECURE=true` to add Secure); mobile keeps Bearer tokens.
  Added `POST /api/auth/logout`. The web app no longer keeps the JWT in `localStorage`.
- CORS is closed by default; allowed origins come from `CORS_ORIGINS`.
- Server refuses to start without `JWT_SECRET`; auth failures no longer echo internal error text.
- Profile avatars may only point at our own `/api/files/...` URLs.
- `server/scripts/migrate-uploads.js` converts legacy `/uploads/` URLs on users and tasks (run once on existing data).
- Sign-up is closed by default (`ALLOW_SIGNUP=true` to reopen). The first account on an empty database becomes admin; invite tokens still work.
- Login throttle: 10 failed attempts per IP+email per 15 minutes returns 429 (in-memory, per process).
- Decision: one deployment per company (no `organization` field); tenant isolation = separate database.

### Phase 2 — Core tasks
- Statuses are now To Do, In Progress, Blocked, In Review, Completed, Cancelled. The old "Pending" is renamed
  "To Do"; existing rows are converted automatically on server start (idempotent). Cancelled counts as closed:
  never open, overdue or blocking. Added the Urgent priority. Due date is now optional (recurring tasks still need one).
- Tags (`#website`): normalised, filterable (`?tag=`), `GET /api/tasks/tags`.
- Subtasks (title, assignee, status, due date) embedded on the task: `POST/PUT/DELETE /api/tasks/:id/subtasks`.
  Deliberate deviation from the spec's `parentTask`: embedded subtasks never pollute task lists, counts or scoping.
  A subtask's assignee must already be on the parent task.
- Blocked by: `PUT /api/tasks/:id/blocked-by`. Refuses self/circular links and tasks the caller cannot open.
  A task waiting on unfinished work cannot be started or completed (409 naming what it waits for); lists and
  the detail view carry `waitingFor`.
- Watchers: `PUT /api/tasks/:id/watch`; followers are included in status/comment/update notifications.
- Activity timeline on each task (created, assigned, reassigned, status, priority, due date, comment, attachment,
  completed, reopened, review, blocked, subtask). Lists omit it to stay light.
- UI: tags, subtasks, blocked banner + picker, follow button, status select and timeline on the task page;
  tag filter and Blocked/Cancelled tabs on task lists; relaxed task form (only title + assignee required).

### Pagination
- `GET /api/tasks` pages in the database: `page`, `limit` (default 25, max 500) and a `pagination` block
  `{page, limit, total, pages}`. Priority sorting is now done in the database too, with a stable `_id` tiebreak.
  Added indexes for the common assignee/status/due and newest-first queries.
- Task lists show 24 per page with a pager; the calendar asks for a whole month grid (limit 500); mobile asks for 100
  until it gets infinite scroll.

### Phase 3 — Projects
- New `Project` (name, description, manager, department, members, start/due date, status Planning/Active/On Hold/Completed/Cancelled,
  priority, tags, creator). `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id`.
- Visibility: admins see all; everyone else sees projects they manage, belong to or created, plus every project of a department they
  sit in (404 for the rest). Create: admin or head (a head only inside a department they lead). Edit: admin, manager, creator or the
  department head. Delete: admin only; tasks are kept and simply leave the project.
- Project dashboard numbers (total, completed, in progress, overdue, blocked, due soon, progress %) come from one aggregation shared by
  the list and the detail view. Cancelled tasks are ignored; "blocked" is a Blocked status or an unfinished blocker; undated tasks are never overdue.
- Tasks gain `project` and `department` (validated: a task can only join a project the caller can see). `GET /api/tasks?project=` and
  `?department=` filter, scoped like every task list.
- UI: Projects list (search, status filter, pager, progress cards), project page (stats, members, tasks with pager, edit, delete),
  project/department pickers on the task form, project filter on task lists, project link on the task page, "Projects" in every menu.

### Phase 4 — Productivity
- **My Work** (`/my-work`, every role): tabs All / Today / Upcoming / Overdue / Completed, filters by project, priority and tag, and a
  Quick Add bar (task, assignee, due date, priority). `GET /api/tasks?mine=true` narrows even an admin's wide scope to their own tasks;
  new `open=true` and `assignee=` filters. "Today" uses the browser's day (`tzOffset`), and a task due today is *Due Today*, not overdue.
- Members may now create tasks **for themselves only** (`POST /api/tasks`); assigning to anyone else is still admin/head.
- **Employee dashboard**: Overdue / Due today / In progress / Upcoming / Done this week (`GET /api/tasks/my-dashboard`), each linking into My Work.
  The old dashboard endpoint now uses aggregation instead of loading every task.
- **Manager dashboard** (admin = company, head = department): Open / Overdue / Due today / Blocked / In review / Done this week plus a
  per-employee Open/Overdue table; clicking a name opens that person's tasks (`GET /api/tasks/manager-dashboard`). "Blocked" here is the
  Blocked status.
- **Time tracking** (optional): estimate, actual time, start/stop timer. One running timer per person and per task, claimed atomically
  (two clicks cannot both win); a forgotten timer logs at most 24h; time changes appear in the timeline.
- **Reminders**: none / at due time / 1 hour before / 1 day before / custom, per task. Sent once, from any number of app instances
  (claim by conditional update); changing the due date or reminder re-arms it. Recurring copies inherit the reminder.

### Phase 5 — Views
- **Board** (`/board`): To Do / In Progress / Blocked / In Review / Completed, drag and drop (native HTML5, plus a "Move to" select on every
  card for keyboard and touch). A drop is the normal status change, so the same rules apply (blocked tasks refuse to start, only the
  assigned/permitted can move a card). In Review is never a drop target: drop on Completed and the server routes a task that needs sign-off
  to In Review. Cards snap back with the server's message when a move is refused. Per-column "Show more"; Completed lists the latest finish first.
- **Calendar**: Month / Week / Day views over one feed, `GET /api/calendar?start=&end=` (max 62 days): due tasks, project deadlines and
  *projected* future occurrences of open recurring tasks (they do not exist as rows until the current one completes). Scoped like task lists.
- **Global search** (Ctrl/Cmd+K or the navbar button): tasks, projects, people, departments (`GET /api/search?q=`), keyboard navigable.
  Every kind is scoped: you only find what you could already open; members find only colleagues in their own departments.
- **Saved filters**: name and keep any task-list filter (`/api/saved-filters`, private, max 20, only whitelisted keys stored).
- Task filters grew Employee, Department, "Assigned to me" and due-date presets (overdue / today / this week / next 7 days) for admins and heads;
  the board reuses the same filter bar.

### Phase 6 — Notifications
- **One engine** (`utils/notify.js`): every alert is stored in-app and pushed live, then WhatsApp / email / mobile push are queued per the
  recipient's preferences. Slow or fallible channels never run inside a request.
- **Events** (`utils/notificationPrefs.js`): task assigned, reassigned (whoever is taken off the task), mentioned, due tomorrow, due today,
  overdue, completed, sent for review, approved (to the people who did the work, instead of "completed"), blocked (status Blocked, or a blocker
  link), plus the existing updated / status / comment / escalation alerts.
- **Preferences** (`GET/PUT /api/notifications/preferences`, Profile page): a per-event grid (in-app, WhatsApp, email, push) and a master switch
  for WhatsApp, email and push. Stored as overrides, so new events and changed defaults reach everyone who never touched them. Defaults follow the
  spec (Assigned: in-app + WhatsApp; Overdue: all; Mention: in-app only). Each switch says when nothing is behind it (no number, no SMTP, no device).
- **Email**: plain SMTP through nodemailer (`SMTP_HOST`, `SMTP_FROM`, ...); off when unset.
- **Push**: Expo push for the mobile app. `POST/DELETE /api/notifications/push-token`; devices that change hands move, dead tokens are pruned,
  max five per person. The mobile app does not register tokens yet (Phase 8).
- **@mentions** in comments: the picker sends ids; only people who can open the task are notified (so a mention cannot leak a task), and a
  mentioned person is not also told "new comment".
- **Background jobs** (`utils/jobs.js`): a MongoDB-backed queue with atomic claims, retry with backoff (5 attempts, then parked for a week),
  deferral, and crash recovery (an abandoned job's lock expires). WhatsApp sends share one pacing slot across all instances. The deadline,
  escalation and reminder scans now run under a shared lock, so several instances scan once, not once each. Decision: no Redis; the queue is the
  same shape as BullMQ's, confined to one file, if you ever want to swap it.
- Tests: new `server/test.jobs.js` (queue, concurrent claimers, retries, lock races) runs as part of `npm test`; end-to-end tests use a fake SMTP server
  and a fake Expo service.

### Phase 7 — Reports
- **Reports** (`/reports`, admin and head; `GET /api/reports/:kind`): Tasks, Employees, Departments, Projects. Admin sees the company, a head sees their
  own department. Date range (quick presets or from/to, up to a year) in the caller's timezone.
  - *Tasks*: Created, Completed, Open, Overdue, Blocked, plus a per-day trend on screen.
  - *Employees*: Assigned, Completed, On time, On-time %, Open, Overdue, with each person's departments. On-time % is blank (not 0%) when nothing was finished.
  - *Departments*: Open, Completed, Overdue, Blocked. A task counts for its own department, else the departments of the people it is assigned to;
    an admin also sees a "No department" row.
  - *Projects*: Open, Completed, Overdue, Progress % - the same numbers as the project dashboard (a snapshot of now, so no date range).
  Created/completed follow the range; open, overdue and blocked are always the position right now. Cancelled tasks are never open.
- **Export**: every report downloads as CSV or Excel (`?format=csv|xlsx`) and is the same table as the screen. CSV is UTF-8 with a BOM, and any cell that
  starts with = + - @ is written as text, so a project named like a spreadsheet formula cannot run when the file is opened.
- Fixed: the older "download all tasks" Excel export crashed (500) on a task without a due date, and ignored department scope. It is now scoped and heads may use it.
