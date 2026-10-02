# TODO — SOHO redesign

- [x] Phase 1: security, file access, auth cookie, CORS
- [ ] Phase 1: organization (multi-company) isolation — DECISION NEEDED: single-tenant per deployment vs `organization` on every model
- [ ] Phase 1: self-registration policy (open `/register` lets anyone create a member account)
- [ ] Phase 1: login rate limiting
- [ ] Phase 2: task model (statuses, subtasks, dependencies, tags, watchers, activity)
- [ ] Phase 3: projects
- [ ] Phase 4: My Work, dashboards, time tracking, reminders
- [ ] Phase 5: Kanban, calendar, search, saved filters
- [ ] Phase 6: notification engine + preferences
- [ ] Phase 7: reports + export
- [ ] Phase 8: mobile
- [ ] Background jobs: replace `setInterval` reminders with a lock/queue (multi-instance safe)
- [ ] S3 driver is untested against a real bucket
