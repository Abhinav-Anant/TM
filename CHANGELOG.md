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
