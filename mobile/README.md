# Task Manager - Mobile (Expo / React Native)

Companion app for the Task Manager web app. Talks to the same Express API.

## Run

```bash
cd mobile
npm install
npx expo start
```

Then press `a` (Android), `i` (iOS) or scan the QR code with Expo Go.

### Point it at your server

The app reads the API base URL from, in order:

1. `EXPO_PUBLIC_API_URL` environment variable
2. `expo.extra.apiUrl` in `app.json`
3. `http://localhost:8000`

A physical device cannot reach `localhost` - use your machine's LAN IP:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx expo start
```

### Try it in a browser (no phone needed)

`react-native-web` is installed, so the whole app also runs as a web page. Handy for development and
for checking a change quickly. The server must allow that origin (`CORS_ORIGINS=http://localhost:8081`):

```bash
EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo export --platform web --clear --output-dir web-build
# serve web-build/ on port 8081 with any static server
```

Camera, push notifications and the native file picker only work on a real device.

## Screens

Bottom tabs: **Home, My Work, Projects, Alerts, Profile**.

| Screen | What it does |
|---|---|
| Home | Greeting and the five numbers (overdue, due today, in progress, upcoming, done this week); tap one to open My Work on that tab. Managers also see their team's numbers; admins see company totals. Links to New task, Calendar and Progress |
| My Work | Tabs All / Today / Upcoming / Overdue / Completed, filters by priority and project, **Quick Add** (task, assignee, due date, priority), infinite scroll, pull to refresh |
| Task | Change status, mark done / submit for review / approve or send back, checklist, subtasks, time tracking (estimate, spent, start/stop timer), blocked-by banner, tags, follow, comments with @mentions, attachments (camera, photo library, any file), activity timeline. Admin/head get **Edit** |
| New / Edit task | Title and assignee are required; due date, project, tags, reminder, estimate, checklist optional. Members can create tasks for themselves; admin/head can assign anyone and edit |
| Projects | Progress, task counts, overdue and blocked per project; project page lists its tasks |
| Calendar | Month grid with a dot per day something is due; tap a day for tasks, project deadlines and upcoming repeats |
| Alerts | Notification inbox with unread badge; tap to open the task |
| Profile | Name, WhatsApp number, **Notification settings** (per event and channel, plus master switches), sign out |

## Push notifications

The server already sends mobile push (Expo's push service). To turn it on for your build:

1. Run `eas init` once to create an EAS project, and make sure `expo.extra.eas.projectId` is set in `app.json`.
2. Build with a development or production build, or use Expo Go on a physical device.
3. Sign in. The app asks for permission and registers the phone's token with the server
   (`POST /api/notifications/push-token`); signing out removes it.

Without a project id the app simply skips registration; in-app alerts keep working, polled every 30 seconds
(React Native's `fetch` cannot stream, so the web app's live channel does not apply).

## Tests

```bash
npm test
```

Runs the pure logic (dates, My Work tab ranges, durations, calendar grid, @mentions) under plain Node.

## Not included yet

Offline mode (deliberately left for later so it does not delay the core release), creating projects, and editing
what a task is blocked by (do those on the web).
