#!/usr/bin/env bash
#
# Installs Blastup as TaskManager's WhatsApp gateway on the same box (run after deploy/server/install.sh).
#   sudo bash /opt/taskmanager/deploy/whatsapp/install-blastup.sh
#
# Shape, and why:
#   - API only, on 127.0.0.1:3001. TaskManager is its single client: it creates one gateway account per
#     employee and shows the QR / pairing code on their Profile page, so Blastup's own dashboard is not
#     built or run. Nothing new faces the internet; ufw stays at 22/80/443.
#   - Patched by patch-blastup.py: no chat history, contacts or incoming messages are stored (people link
#     their personal phones), no auto-replies, phone keeps its own notifications, pairing-code linking.
#   - Its own database (wa_platform) on the local MongoDB; Redis is required (Safe Mode's store).
#
# Re-running is safe: pulls, re-patches, rebuilds, restarts. .env and linked sessions are kept.
set -euo pipefail

PREFIX=/opt/blastup
REPO=https://github.com/kalpintelligence/Blastup.git
HERE="$(cd "$(dirname "$0")" && pwd)"
TM_ENV=/opt/taskmanager/.env

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
systemctl is-active --quiet mongod || { echo "mongod is not running - run deploy/server/install.sh first" >&2; exit 1; }

echo "== Redis (Safe Mode's store - sends fail without it)"
command -v redis-server >/dev/null || { apt-get update -q; apt-get install -yq redis-server; }
systemctl enable --now redis-server
redis-cli ping

echo "== source"
id blastup >/dev/null 2>&1 || useradd --system --home "$PREFIX" --shell /usr/sbin/nologin blastup
git config --global --add safe.directory "$PREFIX"
if [ -d "$PREFIX/.git" ]; then
    git -C "$PREFIX" checkout -q -- server/src
    git -C "$PREFIX" pull -q --ff-only
else
    git clone -q --depth 1 "$REPO" "$PREFIX"
fi
python3 "$HERE/patch-blastup.py" "$PREFIX"

# Generated once: a new JWT_SECRET would not break API keys, but there is no reason to churn it.
if [ ! -f "$PREFIX/server/.env" ]; then
    cat > "$PREFIX/server/.env" <<EOF
NODE_ENV=production
PORT=3001
BIND_HOST=127.0.0.1
MONGODB_URI=mongodb://127.0.0.1:27017/wa_platform
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=24h
COOKIE_SECRET=$(openssl rand -hex 32)
BCRYPT_ROUNDS=12
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$(openssl rand -base64 18)
CLIENT_URL=http://127.0.0.1:3000
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
SESSION_DIR=./sessions
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100000
LOGIN_RATE_LIMIT_MAX=1000
ACCOUNT_LOCK_DURATION_MINUTES=30
LOG_LEVEL=info
# Personal phones: never store or act on incoming messages, chats or contacts.
READ_INCOMING=false
# Tier 5 keeps the 1s gap between messages; lower tiers block task links and new chats.
SAFE_MODE_DEFAULT_TIER=5
# 00:00-19:00 UTC = 05:30-00:30 IST. Sends outside it are rejected (TaskManager retries later).
SENDING_WINDOW_START_UTC=0
SENDING_WINDOW_END_UTC=19
EOF
fi
chmod 600 "$PREFIX/server/.env"

echo "== build (a few minutes)"
cd "$PREFIX/server"
chown -R blastup:blastup "$PREFIX"
sudo -u blastup -H npm ci --no-audit --no-fund
sudo -u blastup -H npm run build

cat > /etc/systemd/system/blastup-api.service <<EOF
[Unit]
Description=Blastup WhatsApp gateway (TaskManager)
After=network.target mongod.service redis-server.service
Requires=mongod.service redis-server.service

[Service]
User=blastup
WorkingDirectory=$PREFIX/server
EnvironmentFile=$PREFIX/server/.env
# One process only: it owns every employee's WhatsApp socket.
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable blastup-api
systemctl restart blastup-api

echo "== wiring TaskManager"
grep -q '^BLASTUP_URL=' "$TM_ENV" || echo 'BLASTUP_URL=http://127.0.0.1:3001' >> "$TM_ENV"
# Encrypts the per-employee gateway keys TaskManager stores. Changing it means everyone links again.
grep -q '^WHATSAPP_SECRET=' "$TM_ENV" || echo "WHATSAPP_SECRET=$(openssl rand -hex 32)" >> "$TM_ENV"
systemctl restart taskmanager

for i in $(seq 1 30); do
    curl -fs -o /dev/null http://127.0.0.1:3001/api/health && break
    sleep 2
done
curl -fs -o /dev/null -w "gateway health: %{http_code}\n" http://127.0.0.1:3001/api/health
ss -lnt | grep ':3001' | awk '{print "gateway listening on: " $4}'
echo "Done. Each employee links their phone from My Profile -> WhatsApp in TaskManager."
