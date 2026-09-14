#!/usr/bin/env bash
#
# Installs Stalwart as a SEND-ONLY local relay for TaskManager on spiderdc
# (43.229.72.101 / tm.leoprime.in).
#
# Shape, and why:
#   - Stalwart listens on 127.0.0.1 only. The Node app is its single client, so
#     there is no reason to expose a submission port to the internet - that keeps
#     ufw at 22/80/443 and leaves no public auth surface to brute-force.
#   - Outbound delivery goes out on port 25, which this box can already reach.
#   - The MX for leoprime.in is left alone. Inbound mail keeps flowing to
#     StackMail; this server only ever sends.
#
# Run as root FROM THE PROXMOX CONSOLE. `ssh host "sudo ..."` does not work on
# this box - sudo needs a real TTY for everything except the taskmanager restart.
#
# Re-running is safe: the official installer is idempotent and this script makes
# no destructive changes.

set -euo pipefail

HELO_HOST="tm.leoprime.in"   # matches the existing A record AND the PTR you must request
PREFIX="/opt/stalwart"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (Proxmox console)." >&2; exit 1; }

echo "==> Pre-flight"

# Outbound 25 is the one thing that cannot be worked around from here. If the
# provider blocks it, Stalwart installs fine and then silently never delivers,
# so fail loudly now rather than debug a quiet queue later.
if timeout 8 bash -c "</dev/tcp/gmail-smtp-in.l.google.com/25" 2>/dev/null; then
    echo "    outbound port 25: OPEN"
else
    echo "    outbound port 25: BLOCKED - Stalwart cannot deliver from this host." >&2
    echo "    Ask the provider to unblock it, or relay through StackMail instead." >&2
    exit 1
fi

if ss -lntp | grep -qE ':(25|587|465)\s'; then
    echo "    WARNING: something already listens on a mail port:" >&2
    ss -lntp | grep -E ':(25|587|465)\s' >&2
fi

echo "==> Installing Stalwart (official installer)"
curl --proto '=https' --tlsv1.2 -sSf https://get.stalw.art/install.sh -o /tmp/stalwart-install.sh
sh /tmp/stalwart-install.sh "$PREFIX"

echo "==> Setting the HELO hostname to $HELO_HOST"
# Receiving servers compare the HELO name against the sending IP's PTR record.
# A mismatch is one of the strongest spam signals there is, so this must equal
# whatever the provider sets as reverse DNS for 43.229.72.101.
hostnamectl set-hostname "$HELO_HOST" || echo "    (set it by hand if this failed)"

echo "==> Recovering the bootstrap admin password"
sleep 3
journalctl -u stalwart -n 200 --no-pager | grep -A8 'bootstrap mode' || \
    echo "    Not in the log yet - run: journalctl -u stalwart -n 200 | grep -A8 'bootstrap mode'"

cat <<EOF

================================================================================
Installed. Stalwart is in bootstrap mode; nothing is configured yet.

The admin UI is on :8080, which ufw does NOT expose - that is deliberate.
Reach it from your laptop over an SSH tunnel:

    ssh -L 8080:127.0.0.1:8080 taskmanager-prod
    # then open http://127.0.0.1:8080/admin

Remaining steps are in deploy/mail/README.md - the DNS records in particular are
not optional. With the domain's current "-all" SPF record, mail sent from this
box is hard-failed by every receiver until you add its IP.
================================================================================
EOF
