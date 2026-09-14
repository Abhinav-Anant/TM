# Mail server (Stalwart) — send-only relay for TaskManager

TaskManager emails an alert on every assignment, start and completion. This sets up
the transport that actually delivers them.

## Before you start: the domain already has a mail provider

`leoprime.in` is on **StackMail** today:

```
MX      leoprime.in     ->  mx.stackmail.com
TXT     leoprime.in     ->  v=spf1 include:spf.stackmail.com a mx -all
```

Two consequences:

1. **Inbound mail is not ours to touch.** This setup never claims the MX. Stalwart
   only sends; anything addressed *to* `@leoprime.in` keeps going to StackMail.
2. **That SPF record ends in `-all`** — a hard fail. Until `43.229.72.101` is added
   to it, every message this box sends is rejected or junked by receivers that
   check SPF, which is effectively all of them.

If you have a StackMail mailbox with SMTP credentials, pointing the app at it is
five minutes of `.env` editing and needs none of what follows. The app talks plain
SMTP either way. Self-hosting buys independence and unlimited volume; it costs you
ownership of IP reputation. Your call — this doc assumes you want Stalwart.

## 1. Install

From the **Proxmox console** as root (`ssh host "sudo ..."` does not work on this
box — only the taskmanager restart is passwordless):

```bash
bash /opt/taskmanager/deploy/mail/install-stalwart.sh
```

It refuses to continue if outbound port 25 is blocked, since Stalwart would install
cleanly and then never deliver. Verified open from this host on 2026-09-14.

## 2. Configure Stalwart

The admin UI is on `:8080` and ufw does not expose it. Tunnel in:

```bash
ssh -L 8080:127.0.0.1:8080 taskmanager-prod
```

Then at `http://127.0.0.1:8080/admin`, using the bootstrap password the installer
printed:

1. Change the admin password.
2. Add **`leoprime.in`** as a domain.
3. Generate a **DKIM key** for it. Note the selector and the public key — you need
   both for DNS below.
4. Create one account, e.g. `taskmanager@leoprime.in`, with a long random password.
   This is the app's SMTP login and the only account that will ever exist.
5. Under listeners, bind submission to **`127.0.0.1:587`** and the SMTP listener to
   `0.0.0.0:25` for outbound. Nothing else should listen publicly.

## 3. DNS — none of this is optional

| Type | Host | Value | Why |
|---|---|---|---|
| TXT | `leoprime.in` | `v=spf1 include:spf.stackmail.com a mx ip4:43.229.72.101 -all` | Authorises this box. **Edit the existing record — do not add a second one**; two SPF records is itself a permanent failure. |
| TXT | `<selector>._domainkey.leoprime.in` | *(public key from step 2.3)* | Lets receivers verify the signature. |
| TXT | `_dmarc.leoprime.in` | `v=DMARC1; p=none; rua=mailto:postmaster@leoprime.in` | None exists today. Start at `p=none` so you get reports without mail being dropped while you tune; tighten to `p=quarantine` once the reports are clean. |

**PTR / reverse DNS — ask your hosting provider.** `43.229.72.101` currently reverses
to `spiderdc`, which is not a FQDN. It must resolve to **`tm.leoprime.in`**, matching
the HELO name the installer sets. Only the IP's owner can change this, and Gmail in
particular is unforgiving about the mismatch. This is the single most common reason
a correctly-configured self-hosted mail server still lands in spam.

Use `tm.leoprime.in`, not `mail.leoprime.in` — the latter is a CNAME to StackMail.

## 4. Point the app at it

In `/opt/taskmanager/.env`:

```
SMTP_HOST=127.0.0.1
SMTP_PORT=587
SMTP_USER=taskmanager@leoprime.in
SMTP_PASS=<the password from step 2.4>
MAIL_FROM=taskmanager@leoprime.in
CLIENT_URL=https://tm.leoprime.in
```

```bash
ssh taskmanager-prod "sudo systemctl restart taskmanager"
```

The boot log flips from `Email notifications: disabled` to `enabled`. Until
`SMTP_HOST`/`SMTP_USER` are both set, every send is a deliberate no-op and the app
runs normally — so a half-finished mail server cannot take the app down.

## 5. Verify

Assign yourself a task, then:

```bash
journalctl -u stalwart -f          # delivery attempts and remote responses
```

Send a probe to `check-auth@verifier.port25.com` from the Stalwart UI; it replies
with a per-check SPF/DKIM/DMARC/PTR scorecard. Aim for `pass` on all four before
trusting it with real notifications.

## What this does not do

Inbound mail, mailboxes, IMAP/JMAP, webmail, spam filtering. Stalwart supports all
of it and none of it is wired up, because the app only sends. If you later want
TaskManager to *receive* mail, that is a real project — it means moving the MX off
StackMail.
