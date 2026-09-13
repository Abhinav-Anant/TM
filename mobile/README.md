# Task Manager - Mobile (Expo / React Native)

Companion app for the MERN Task Manager. Talks to the same Express API.

## Run

```bash
cd mobile
npm install
npx expo start
```

Then press `a` (Android), `i` (iOS) or scan the QR code with Expo Go.

## Point it at your server

The app reads the API base URL from, in order:

1. `EXPO_PUBLIC_API_URL` environment variable
2. `expo.extra.apiUrl` in `app.json`
3. `http://localhost:8000`

A physical device cannot reach `localhost` - use your machine's LAN IP:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx expo start
```

## What it does

| Screen | Covers |
|---|---|
| Login | JWT sign-in, token kept in AsyncStorage |
| Tasks | Search, status/priority/category filters, pull to refresh |
| Task detail | Checklist toggling (drives progress + status), attachments, comments |
| Notifications | Assignment, update, comment, deadline and overdue alerts |
| Progress | Completion rate, per-status and per-category progress, next deadlines |

Notifications poll every 30s - React Native's `fetch` cannot stream a response
body, so the web app's SSE channel does not apply here. Add `expo-notifications`
if you need true push.

Creating and editing tasks stays admin-only on the web client.
