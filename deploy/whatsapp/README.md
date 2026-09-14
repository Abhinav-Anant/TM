# WhatsApp notifications (Blastup gateway)

TaskManager sends an alert on every assignment, start and completion. This is the
gateway that delivers them.

## How it fits together

```
TaskManager (:8000) ──POST /api/send/text──> Blastup API (127.0.0.1:3001) ──> WhatsApp
                          x-api-key                     │
                                                  Blastup dashboard (127.0.0.1:3000)
                                                  reached over an SSH tunnel only
```

Nothing new is exposed. Both Blastup processes bind to loopback, so ufw stays at
22/80/443 and the dashboard is unreachable except through `ssh -L`.

## Read this before you start

Blastup drives WhatsApp through **Baileys**, which speaks WhatsApp Web's protocol
as if it were a linked device. It is not the official Business API, and WhatsApp
does not sanction it. Two practical consequences:

- **The sending account can be banned.** Automated sending is what bans look for.
  Use a dedicated number you are willing to lose, not anyone's personal WhatsApp
  and not the company's main line.
- **The session is a linked device.** Logging the account out of linked devices,
  or letting it idle for long enough, drops the session and needs a fresh QR scan.
  Alerts silently stop until someone re-links it, so watch for that.

Blastup's own SafeMode (humanised delays, message variation) exists to reduce ban
risk on bulk campaigns. Task alerts are low volume and spread out, which is the
benign end of this — but the risk is not zero and it is not something the app can
control.

## 1. Install

From the **Proxmox console** as root (`ssh host "sudo ..."` does not work on this
box — only the taskmanager restart is passwordless):

```bash
bash /opt/taskmanager/deploy/whatsapp/install-blastup.sh
```

It clones to `/opt/blastup`, generates secrets, builds both halves, seeds the
admin account and installs two systemd units — `blastup-api` and `blastup-ui`.
It prints the generated dashboard password once; it is also in
`/opt/blastup/server/.env`.

systemd, not pm2, deliberately: pm2 was already tried on this host and failed
because systemd's `CHASE_SAFE` refuses to read a PID file under an unprivileged
user's home.

## 2. Link the WhatsApp account

```bash
ssh -L 3000:127.0.0.1:3000 taskmanager-prod
```

Open `http://127.0.0.1:3000`, log in as `admin`, and scan the QR code with the
phone whose number will send the alerts. The session is written to
`/opt/blastup/server/sessions` and survives restarts, so this is a one-time step
unless the device is unlinked.

## 3. Create the API key

Still in the dashboard, create an API key and copy it — **it is shown once**.
Then in `/opt/taskmanager/.env`:

```
BLASTUP_URL=http://127.0.0.1:3001
BLASTUP_API_KEY=<the key>
DEFAULT_COUNTRY_CODE=91
CLIENT_URL=https://tm.leoprime.in
```

```bash
ssh taskmanager-prod "sudo systemctl restart taskmanager"
```

The boot log flips from `WhatsApp notifications: disabled` to `enabled`. Until
both `BLASTUP_URL` and `BLASTUP_API_KEY` are set, every send is a deliberate
no-op and the app runs normally — a half-finished gateway cannot take it down.

## 4. Members add their numbers

Every signed-in user has **My Profile** in the sidebar. Anyone without a number
saved also gets a banner on every page until they add one; it can be dismissed
for the session but returns at the next sign-in.

Numbers are normalised on save: a bare 10-digit number is treated as Indian and
stored as `919876543210`; anything else needs an explicit `+<country code>`.
A number that cannot be normalised is rejected with a 400 rather than stored, so
nobody is left believing they are reachable when they are not.

**A member with no number still gets in-app and real-time alerts.** The WhatsApp
message is extra reach, never the only path — which is why the prompt nags rather
than blocks.

## 5. Verify

Assign yourself a task, then:

```bash
journalctl -u blastup-api -f
```

You should see the send and WhatsApp's acknowledgement. If nothing arrives:

| Symptom | Cause |
|---|---|
| App log: `WhatsApp notifications: disabled` | `BLASTUP_URL` or `BLASTUP_API_KEY` missing from `/opt/taskmanager/.env` |
| App log: `WhatsApp send failed (401)` | API key wrong or deleted in the dashboard |
| App log: `WhatsApp send failed (4xx)` about connection | Session dropped — re-scan the QR |
| Nothing logged at all for one person | That member has no number saved |

## What this does not do

Inbound messages, the chatbot, broadcast campaigns, contact sync. Blastup ships
all of it and none of it is wired up — TaskManager only ever sends a
notification. Leave it that way unless you actually want a bot answering replies,
which is a different project with different risk.
