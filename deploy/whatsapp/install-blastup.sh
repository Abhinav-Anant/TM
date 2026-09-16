#!/usr/bin/env bash
#
# Installs Blastup as the WhatsApp gateway for TaskManager on spiderdc.
#
# Shape, and why:
#   - Both Blastup processes bind to 127.0.0.1 only. TaskManager is the API's
#     single client and the dashboard is reached over an SSH tunnel, so ufw stays
#     at 22/80/443 and nothing new faces the internet.
#   - Its own Mongo database (wa_platform) on the Mongo already running here.
#     Separate database, same server - nothing touches the taskmanager data.
#   - systemd units, not pm2. pm2 was already tried on this box and failed:
#     systemd's CHASE_SAFE refuses to read a PID file under an unprivileged
#     user's home. Do not reintroduce it.
#
# Run as root FROM THE PROXMOX CONSOLE - `ssh host "sudo ..."` does not work here.
#
# Re-running is safe: it pulls, rebuilds and restarts without touching .env or
# the linked WhatsApp session.

set -euo pipefail

PREFIX="/opt/blastup"
REPO="https://github.com/kalpintelligence/Blastup.git"
SERVICE_USER="aadmin"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (Proxmox console)." >&2; exit 1; }

echo "==> Pre-flight"
command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Blastup needs Node >= 18 (found $NODE_MAJOR)" >&2; exit 1; }
systemctl is-active --quiet mongod || { echo "mongod is not running" >&2; exit 1; }
echo "    node $(node -v), mongod active"

# Blastup wraps the Baileys socket in SafeMode and SafeMode's store is Redis, so
# every send goes through it - without Redis, sends fail rather than merely
# degrade. Its in-code fallback to a memory store never fires: that catch only
# wraps client construction, which succeeds even when nothing is listening.
echo "==> Redis"
if ! systemctl is-active --quiet redis-server; then
    apt-get update -qq
    apt-get install -y redis-server
    systemctl enable --now redis-server
fi
redis-cli ping

echo "==> Fetching source into $PREFIX"
if [ -d "$PREFIX/.git" ]; then
    git -C "$PREFIX" pull --ff-only
else
    git clone --depth 1 "$REPO" "$PREFIX"
fi

# Generated once and then left alone - regenerating JWT_SECRET on every run would
# invalidate the API key TaskManager is holding.
if [ ! -f "$PREFIX/server/.env" ]; then
    echo "==> Writing server/.env (first run)"
    ADMIN_PW="$(openssl rand -base64 18)"
    cat > "$PREFIX/server/.env" <<EOF
NODE_ENV=production
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/wa_platform
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=24h
COOKIE_SECRET=$(openssl rand -hex 32)
BCRYPT_ROUNDS=12
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PW
CLIENT_URL=http://127.0.0.1:3000
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
SESSION_DIR=./sessions
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
LOGIN_RATE_LIMIT_MAX=5
ACCOUNT_LOCK_DURATION_MINUTES=30
LOG_LEVEL=info
EOF
    chmod 600 "$PREFIX/server/.env"
    echo "NEXT_PUBLIC_API_URL=http://127.0.0.1:3001" > "$PREFIX/client/.env"
    echo "    dashboard login: admin / $ADMIN_PW"
    echo "    (also saved in $PREFIX/server/.env - it is not shown again)"
else
    echo "==> server/.env exists, leaving it alone"
fi

echo "==> Installing dependencies and building (a few minutes)"
cd "$PREFIX"
npm run install:all
npm run build

# Next.js excludes these from the standalone bundle on purpose; without the copy
# the dashboard loads with no CSS or client JS.
echo "==> Copying standalone assets"
cp -r client/.next/static client/.next/standalone/.next/static
[ -d client/public ] && cp -r client/public client/.next/standalone/public

echo "==> Seeding the admin account"
npm run seed || echo "    (already seeded)"

chown -R "$SERVICE_USER:$SERVICE_USER" "$PREFIX"

echo "==> Installing systemd units"
cat > /etc/systemd/system/blastup-api.service <<EOF
[Unit]
Description=Blastup WhatsApp API
After=network.target mongod.service redis-server.service
Requires=mongod.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$PREFIX/server
EnvironmentFile=$PREFIX/server/.env
# The Baileys socket is a singleton - never run more than one of these.
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/blastup-ui.service <<EOF
[Unit]
Description=Blastup dashboard
After=network.target blastup-api.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$PREFIX/client/.next/standalone
Environment=NODE_ENV=production
Environment=PORT=3000
# Loopback only: the dashboard is reached over an SSH tunnel, never published.
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now blastup-api blastup-ui
sleep 4
systemctl --no-pager --lines=5 status blastup-api || true

cat <<EOF

================================================================================
Blastup is up on 127.0.0.1:3001 (API) and 127.0.0.1:3000 (dashboard).

Neither is reachable from outside this box. To finish setup, tunnel in:

    ssh -L 3000:127.0.0.1:3000 taskmanager-prod
    # then open http://127.0.0.1:3000

There you must:
  1. Log in and scan the QR code with the WhatsApp account that will send.
  2. Create an API key and put it in /opt/taskmanager/.env as BLASTUP_API_KEY.

Full steps in deploy/whatsapp/README.md.
================================================================================
EOF
