#!/usr/bin/env bash
#
# Makes the gateway's Safe Mode usable for transactional task alerts from India,
# then turns it on at Tier 5.
#
# Why this is needed at all:
#
#   Safe Mode ships tuned for bulk marketing from a cold number being warmed up.
#   Its sending window is 09:00-21:00 UTC and, unlike every other rule, it is
#   checked BEFORE the tier config - so even Tier 5 enforces it. In IST that
#   window is 14:30-02:30, which means every task alert between 09:00 and 14:30
#   IST - most of the working morning - is rejected outright. Safe Mode throws on
#   violation rather than queueing, so those alerts are lost, not delayed.
#
#   This widens the window to 02:00-17:00 UTC = 07:30-22:30 IST: ordinary waking
#   hours in the only timezone this deployment serves, still refusing to message
#   anyone in the middle of the night.
#
# Tier 5 because the lower tiers are warm-up stages that actively break this use
# case: Tiers 1-2 block links in a first message and every alert carries a task
# deep link, and Tier 1 permits zero new chats a day, so no new colleague could
# ever be messaged. Tier 5 keeps what is actually protective here - the sending
# window and the minimum gap between messages.
#
# Run from the Proxmox console or an interactive SSH session:
#     sudo bash /opt/taskmanager/deploy/whatsapp/safemode-ist.sh
#
# Re-running is safe: the patch is idempotent and re-enabling is a no-op.

set -euo pipefail

BLASTUP=/opt/blastup
TIERS="$BLASTUP/server/src/safemode/tiers.ts"

[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo - restarting blastup-api needs root.' >&2; exit 1; }
[ -f "$TIERS" ] || { echo "Not found: $TIERS" >&2; exit 1; }

echo '==> Patching the sending window'
if grep -q 'SENDING_WINDOW_START_UTC = Number' "$TIERS"; then
    echo '    already patched'
else
    cp "$TIERS" "$TIERS.orig"
    python3 - "$TIERS" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8').read()

old_start = 'export const SENDING_WINDOW_START_UTC = 9;'
old_end = 'export const SENDING_WINDOW_END_UTC = 21;'
assert old_start in s and old_end in s, 'window constants not found - upstream may have changed'

new = (
    '// Widened for an IST-only deployment. The default 9-21 UTC is 14:30-02:30 IST,\n'
    '// which rejects every alert sent before 14:30 IST - most of the working day.\n'
    '// 2-17 UTC is 07:30-22:30 IST: waking hours here, still no 3am messages.\n'
    '// Override per-environment without another rebuild if the hours ever change.\n'
    'export const SENDING_WINDOW_START_UTC = Number(process.env.SENDING_WINDOW_START_UTC ?? 2);\n'
    'export const SENDING_WINDOW_END_UTC = Number(process.env.SENDING_WINDOW_END_UTC ?? 17);'
)
s = s.replace(old_start + '\n' + old_end, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('    patched (original kept as tiers.ts.orig)')
PY
fi

echo '==> Rebuilding the gateway'
cd "$BLASTUP/server"
sudo -u aadmin npm run build 2>&1 | tail -3

echo '==> Restarting'
systemctl restart blastup-api
sleep 6
systemctl is-active blastup-api

echo '==> Enabling Safe Mode at Tier 5'
KEY=$(grep '^BLASTUP_API_KEY=' /opt/taskmanager/.env | cut -d= -f2-)
INSTANCE=$(curl -s -H "x-api-key: $KEY" http://127.0.0.1:3001/api/whatsapp/status \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["instanceId"])')
echo "    instance: $INSTANCE"

curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
    -d '{"tier":5}' "http://127.0.0.1:3001/api/safemode/$INSTANCE/enable" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("    enable ->", json.dumps(d.get("data", d))[:200])'

echo '==> Verifying'
curl -s -H "x-api-key: $KEY" http://127.0.0.1:3001/api/whatsapp/status \
    | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print("    safeModeEnabled:", d.get("safeModeEnabled"), "| tier:", d.get("safeModeStartTier"), "| status:", d.get("status"))'

cat <<'DONE'

Done. Safe Mode is on at Tier 5 with an IST-appropriate sending window.

What is still enforced: a 1s minimum gap between messages, and no sending
outside 07:30-22:30 IST. TaskManager paces its own sends to respect the gap
(WHATSAPP_SEND_GAP_MS, default 1200ms).

Note for upgrades: this edits a vendored file, so `git pull` in /opt/blastup
will clobber it. Re-run this script afterwards - it is idempotent.
DONE
