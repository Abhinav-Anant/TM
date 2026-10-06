#!/usr/bin/env bash
# One-box install on Ubuntu 24.04: firewall, swap, Node 22, MongoDB 8 (local only), nginx, HTTPS.
# Safe to re-run; a second run updates the code and keeps .env and the database.
#   sudo DOMAIN=tm.example.com bash install.sh
# Optional: REPO=<git url>  BRANCH=<branch>
#           IP_ACCESS=true also serves the app on http://<server ip> (stays on until IP_ACCESS=false)
set -euo pipefail

DOMAIN=${DOMAIN:?set DOMAIN, e.g. DOMAIN=tm.example.com}
REPO=${REPO:-https://github.com/Jitugandhare/Task-management.git}
BRANCH=${BRANCH:-main}
APP=/opt/taskmanager
export DEBIAN_FRONTEND=noninteractive

echo "== firewall (SSH first, so this can never lock you out)"
ufw allow OpenSSH
ufw allow 'Nginx Full' 2>/dev/null || { ufw allow 80/tcp; ufw allow 443/tcp; }
ufw --force enable

echo "== swap"
if ! swapon --show | grep -q .; then
    fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== packages"
apt-get update -q
apt-get install -yq curl gnupg git nginx certbot python3-certbot-nginx

if ! command -v node >/dev/null || [[ $(node -v) != v22.* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -yq nodejs
fi

if ! command -v mongod >/dev/null; then
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
        > /etc/apt/sources.list.d/mongodb-org-8.0.list
    apt-get update -q
    apt-get install -yq mongodb-org
fi
# Default config listens on 127.0.0.1 only; keep the cache small on a 2 GB box.
grep -q 'cacheSizeGB' /etc/mongod.conf || sed -i 's/^storage:/storage:\n  wiredTiger:\n    engineConfig:\n      cacheSizeGB: 0.4/' /etc/mongod.conf
systemctl enable --now mongod

echo "== app"
id tm >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin tm
git config --global --add safe.directory "$APP"
if [ -d "$APP/.git" ]; then
    git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" checkout -q -B "$BRANCH" FETCH_HEAD
else
    git clone -q --branch "$BRANCH" "$REPO" "$APP"
fi
cd "$APP"
npm ci --omit=dev --no-audit --no-fund
npm ci --prefix client --no-audit --no-fund
npm run build --prefix client

if [ ! -f .env ]; then
    cat > .env <<EOF
MONGO_URI=mongodb://127.0.0.1:27017/taskmanager
JWT_SECRET=$(openssl rand -hex 48)
PORT=8000
CLIENT_URL=https://$DOMAIN
CORS_ORIGINS=
COOKIE_SECURE=true
ALLOW_SIGNUP=false
STORAGE_DRIVER=local
DEFAULT_COUNTRY_CODE=91
EOF
fi
chmod 600 .env
mkdir -p server/uploads
chown -R tm:tm "$APP"

install -m 644 deploy/server/taskmanager.service /etc/systemd/system/taskmanager.service
systemctl daemon-reload
systemctl enable taskmanager
systemctl restart taskmanager

echo "== nginx + HTTPS"
if [ ! -f /etc/nginx/sites-available/taskmanager ]; then
    sed "s/tm.example.com/$DOMAIN/" deploy/server/nginx-taskmanager.conf > /etc/nginx/sites-available/taskmanager
fi
ln -sf /etc/nginx/sites-available/taskmanager /etc/nginx/sites-enabled/taskmanager
rm -f /etc/nginx/sites-enabled/default
if [ "${IP_ACCESS:-}" = true ]; then
    install -m 644 deploy/server/nginx-ip-access.conf /etc/nginx/sites-available/taskmanager-ip
    ln -sf /etc/nginx/sites-available/taskmanager-ip /etc/nginx/sites-enabled/taskmanager-ip
elif [ "${IP_ACCESS:-}" = false ]; then
    rm -f /etc/nginx/sites-enabled/taskmanager-ip
fi
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo "== done: https://$DOMAIN (the first account you create becomes the admin)"
