# TODO — SOHO redesign

- [x] Phase 1: security, file access, auth cookie, CORS
- [x] Phase 1: one deployment per company (decided); signup closed; login throttle
- [ ] Hide the /signup link on the login page when sign-up is closed
- [x] Phase 2: task model (statuses, subtasks, dependencies, tags, watchers, activity)
- [ ] Quick Add Task (Task / Assign / Due / Priority) - build with My Work in Phase 4
- [ ] Mobile: show tags, subtasks, blocked state, timeline (Phase 8)
- [ ] Task lists are not paginated yet (Phase 8 of the spec's performance section; do before Phase 4 dashboards)
- [ ] Phase 3: projects
- [ ] Phase 4: My Work, dashboards, time tracking, reminders
- [ ] Phase 5: Kanban, calendar, search, saved filters
- [ ] Phase 6: notification engine + preferences
- [ ] Phase 7: reports + export
- [ ] Phase 8: mobile
- [ ] Background jobs: replace `setInterval` reminders with a lock/queue (multi-instance safe)
- [ ] S3 driver is untested against a real bucket
