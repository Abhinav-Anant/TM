# Single-server deploy (Ubuntu 24.04)

One box runs MongoDB (local only), the Node app (serves the API and the built web app on port 8000) and nginx (HTTPS in front).
About 2 GB of RAM is enough; the script adds 1 GB of swap.

Point your domain's A record at the server, then as root:

```bash
curl -fsSLO https://raw.githubusercontent.com/Jitugandhare/Task-management/main/deploy/server/install.sh
DOMAIN=tm.example.com bash install.sh
```

It enables the firewall (SSH, 80, 443), installs Node 22, MongoDB 8, nginx and a Let's Encrypt certificate, writes
`/opt/taskmanager/.env` with a random `JWT_SECRET` (only on the first run) and starts the `taskmanager` service.
Open `https://<domain>` and create the first account: it becomes the admin.

| Task | Command |
|---|---|
| Update to the latest code | re-run the same command (keeps `.env` and the database) |
| Logs | `journalctl -u taskmanager -f` |
| Restart after editing `.env` | `systemctl restart taskmanager` |
| Also answer on `http://<server ip>` (DNS trouble) | re-run with `IP_ACCESS=true` (plain http; `IP_ACCESS=false` turns it off) |
| Back up the database | `mongodump --db taskmanager --archive=/root/tm-$(date +%F).gz --gzip` |

Uploaded files live in `/opt/taskmanager/server/uploads` (back these up too) unless `STORAGE_DRIVER=s3`.
Optional settings (email, WhatsApp, S3) are described in `.env.example`.
