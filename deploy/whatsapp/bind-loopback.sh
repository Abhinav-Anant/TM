#!/usr/bin/env bash
#
# Binds the Blastup API to loopback instead of every interface.
#
# Why: the runbook says both Blastup processes listen on 127.0.0.1 only, and the
# dashboard does - but the API does not. `server.listen(env.PORT)` in
# server/src/index.ts takes no host argument, so Node binds 0.0.0.0, and the app
# exposes no HOST/BIND setting to change that. ufw is currently the only thing
# keeping an API that controls a linked WhatsApp account off the internet. One
# flushed rule, one `ufw disable`, one provider firewall change and it is public.
#
# Nothing legitimate needs the wider bind: TaskManager runs on this same host and
# the dashboard is reached over an SSH tunnel.
#
# Run from the Proxmox console or an interactive SSH session:
#     sudo bash /opt/taskmanager/deploy/whatsapp/bind-loopback.sh
#
# Re-running is safe. The original is kept as index.ts.orig, and BIND_HOST can
# widen it again without another source edit.

set -euo pipefail

BLASTUP=/opt/blastup
ENTRY="$BLASTUP/server/src/index.ts"

[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo - restarting blastup-api needs root.' >&2; exit 1; }
[ -f "$ENTRY" ] || { echo "Not found: $ENTRY" >&2; exit 1; }

echo '==> Patching the listen call'
if grep -q 'BIND_HOST' "$ENTRY"; then
    echo '    already patched'
else
    cp "$ENTRY" "$ENTRY.orig"
    python3 - "$ENTRY" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8').read()

old = '    server.listen(env.PORT, () => {'
assert old in s, 'listen call not found - upstream may have changed'

new = (
    "    // Loopback by default: the only client is TaskManager on this same host,\n"
    "    // and the dashboard is reached over an SSH tunnel. Binding every interface\n"
    "    // left an API that controls a linked WhatsApp account one firewall rule\n"
    "    // away from the internet. Set BIND_HOST to widen it deliberately.\n"
    "    server.listen(env.PORT, process.env.BIND_HOST || '127.0.0.1', () => {"
)
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(old, new, 1))
print('    patched (original kept as index.ts.orig)')
PY
fi

echo '==> Rebuilding'
cd "$BLASTUP/server"
sudo -u aadmin npm run build 2>&1 | tail -3

echo '==> Restarting'
systemctl restart blastup-api
sleep 6
systemctl is-active blastup-api

echo '==> Verifying the bind'
ss -lnt | grep ':3001' | awk '{print "    listening on: " $4}'
if ss -lnt | grep -qE '(0\.0\.0\.0|\*):3001'; then
    echo '    STILL ON ALL INTERFACES - patch did not take effect' >&2
    exit 1
fi

echo '==> Verifying nothing broke'
KEY=$(grep '^BLASTUP_API_KEY=' /opt/taskmanager/.env | cut -d= -f2-)
curl -s -o /dev/null -w '    API /api/health -> %{http_code}\n' http://127.0.0.1:3001/api/health
curl -s -H "x-api-key: $KEY" http://127.0.0.1:3001/api/whatsapp/status \
    | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print("    whatsapp:", d.get("status"), "| safeMode:", d.get("safeModeEnabled"), "tier", d.get("safeModeStartTier"))'

echo
echo 'Done. The API now answers only on 127.0.0.1:3001.'
echo 'A git pull in /opt/blastup will clobber this - re-run the script afterwards.'
