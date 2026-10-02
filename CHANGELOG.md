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
