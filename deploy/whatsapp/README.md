# WhatsApp notifications (Blastup gateway)

Every employee links their **own** WhatsApp. When someone acts on a task, the alert goes out from their
phone:

| Who acts | Their own phone messages | Everyone else on the alert |
|---|---|---|
| Employee | the heads of their department | company number, if one is set |
| Head | the admins, and the people in the departments they lead | company number, if one is set |
| Admin | anyone | - |

Admins can also message everyone, one department or chosen people from the **Team** page (Send WhatsApp).
That goes from the admin's own phone, or from the company number with their name on it if they have not
linked. Alerts with no person behind them (due-date reminders, overdue escalations) use the company number.
If there's no company number, those alerts stay in-app. Someone who has not linked yet is treated the same way.

## How it fits together

```
TaskManager (:8000) ──x-api-key per employee──> Blastup API (127.0.0.1:3001) ──> each person's WhatsApp
       │                                                  │
  My Profile: QR code or pairing code              one gateway account + session per employee
```

TaskManager creates a gateway account for each person the first time they link (they never see it), keeps
its API key encrypted with `WHATSAPP_SECRET`, and shows the QR / pairing code on their Profile page.
Blastup's own dashboard is not built or run. The API listens on 127.0.0.1 only; ufw stays at 22/80/443.

## Read this before you start

Blastup drives WhatsApp through **Baileys**, which acts as a WhatsApp Web "linked device". It is not the
official Business API and WhatsApp does not sanction it.

- **People are linking personal accounts.** Get each employee's agreement first. A linked device receives
  their messages. `patch-blastup.py` makes the gateway drop them: no history sync, nothing stored, no
  auto-replies (`READ_INCOMING=false`). Even so, the server holds a login to each account.
- **An account can be banned** for automated sending. Task alerts are low volume and paced (1 message
  per second per number), which is the benign end. The risk is still not zero.
- **Unlinking on the phone stops that person's alerts** silently going out from their number. They fall
  back to the company number (or in-app) until the person links again; the admin's Team page shows who is linked.
- **Memory:** each linked phone costs roughly 50-100 MB on the server. 2 GB is fine for about 10 people.
  Plan 4 GB for 30, 8 GB for 50.

## 1. Install

On the server, after `deploy/server/install.sh`:

```bash
bash /opt/taskmanager/deploy/whatsapp/install-blastup.sh
```

The script:
- installs Redis (required, it is Safe Mode's store) and clones Blastup to `/opt/blastup`
- applies `patch-blastup.py` and builds the API
- runs it as the `blastup-api` service (user `blastup`)
- adds `BLASTUP_URL` and `WHATSAPP_SECRET` to `/opt/taskmanager/.env` and restarts TaskManager

Re-running it updates and re-patches. Linked sessions are kept.

What `patch-blastup.py` changes (each edit asserts its anchor, so an upstream change fails loudly):

| Change | Why |
|---|---|
| No history sync; history, contacts and incoming handlers return early | personal chats never reach the database, no chatbot replies |
| `markOnlineOnConnect: false` | otherwise the phone stops showing its own notifications |
| `POST /api/whatsapp/pair` | a phone cannot scan a QR on its own screen |
| `SAFE_MODE_DEFAULT_TIER` (set to 5) | tiers 1-2 block links and new chats, so no alert would get through |
| `SENDING_WINDOW_*_UTC` (set to 0-19 = 05:30-00:30 IST) | stock 09-21 UTC drops every alert before 14:30 IST |
| listen on `BIND_HOST` (127.0.0.1) | stock code binds every interface |

## 2. Everyone links their phone

**My Profile → Your WhatsApp**:
- **On a computer:** Show QR code, then in WhatsApp on the phone go to **Linked devices → Link a device** and scan it.
- **On the phone:** enter the number and tap Get code. Then in WhatsApp go to **Linked devices → Link a device → Link with phone number instead** and type the code.
  The same option is on the mobile app's Profile tab.

The card turns green when the link is live. **Unlink** logs the gateway out of that phone.

Each person also needs their **WhatsApp number** saved on My Profile. That is where alerts to them are delivered.

## 3. Optional: a company number

For reminders and people who have not linked:
1. Create a TaskManager user for it, for example `whatsapp@yourcompany.com`.
2. Sign in as that user and link a dedicated phone.
3. Set `WHATSAPP_COMPANY_EMAIL=whatsapp@yourcompany.com` in `/opt/taskmanager/.env`.
4. Run `systemctl restart taskmanager`.

Without a company number those alerts are in-app only.

## 4. Verify

Assign a task to someone in your department, then:

```bash
journalctl -u taskmanager -u blastup-api -f
```

| Symptom | Cause |
|---|---|
| Profile has no WhatsApp card | `BLASTUP_URL` missing from `/opt/taskmanager/.env` |
| "The WhatsApp gateway did not answer" | `systemctl status blastup-api`; Redis or MongoDB down |
| Pairing code never connects | the code expires in about a minute; get a new one |
| `WhatsApp send failed (4xx) ... window` | outside `SENDING_WINDOW_*_UTC`; the queue retries for a few hours |
| Alert came from the company number | that person's phone is not linked (or dropped); check the Team page |
| `blastup-api` journal loops on `Redis connection error` | `redis-server` not running; sends fail |
