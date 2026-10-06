# Deploy (ticket T5)

Target: one LXC container on the Proxmox box, running Docker Compose, exposed through a
Cloudflare Tunnel. Done when the app loads on cellular data and a restore from backup has been
tested once.

## 1. LXC on Proxmox

1. Create a Debian 12 or Ubuntu 24.04 LXC (2 vCPU, 2 GB RAM, 16 GB disk is plenty).
   Tick **Nesting** under Options → Features so Docker can run inside it. Unprivileged is fine.
2. Inside the container:
   ```sh
   apt update && apt install -y ca-certificates curl git
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/enesuio/Google-Maps-Tutorial.git /opt/hydrox45
   cd /opt/hydrox45
   cp .env.example .env
   ```
3. Edit `.env`: set `SESSION_SECRET` (`openssl rand -base64 48`) and
   `APP_ORIGIN=https://hydrox.yourdomain.com` (the hostname you will give the tunnel).
4. `docker compose up -d --build`. The `app` service runs migrations and the seed, then serves
   on port 3000. Check: `curl -s localhost:3000/health` → `{"ok":true,"db":true}`.

## 2. Cloudflare Tunnel

No port forwarding; works with a dynamic home IP.

1. In Cloudflare Zero Trust → Networks → Tunnels → **Create a tunnel** (Cloudflared), name it
   `hydrox45`, and copy the install command for Debian. Run it in the LXC. It installs
   `cloudflared` as a systemd service with the tunnel token.
2. Add a **Public hostname**: `hydrox.yourdomain.com` → service `http://localhost:3000`.
3. Optional but recommended: Zero Trust → Access → Applications → add a self-hosted app for the
   same hostname with a policy that allows only your two emails (one-time PIN). This puts a
   second lock in front of the app; the app's own setup-link login still applies.
4. Test on a phone with Wi-Fi off. `/health` should answer and the setup link should sign in.

## 3. Setup links

```sh
docker compose exec app node api/dist/cli/setup-link.js enes
docker compose exec app node api/dist/cli/setup-link.js partner
```

Each link works once and sets a 1-year cookie. Generate a new one if a phone is replaced.

## 4. Nightly backup

`scripts/backup.sh` dumps the database with `pg_dump` from the `db` container and keeps 30 days.
Install it as a cron job in the LXC:

```sh
chmod +x /opt/hydrox45/scripts/*.sh
mkdir -p /var/backups/hydrox45
crontab -e
# add:
15 3 * * * /opt/hydrox45/scripts/backup.sh /var/backups/hydrox45 >> /var/log/hydrox45-backup.log 2>&1
```

Copy the backup directory somewhere else as well: a second disk on the Proxmox host (bind-mount
it into the LXC), or an rclone sync to cloud storage. 45 days of data is small but irreplaceable.

## 5. Restore test (do this once, before Day 3)

```sh
# make a dump
/opt/hydrox45/scripts/backup.sh /var/backups/hydrox45
# restore it into a scratch database and count rows
/opt/hydrox45/scripts/restore-test.sh /var/backups/hydrox45/<latest>.sql.gz
```

`restore-test.sh` creates `hydrox_restore_test`, loads the dump, prints row counts for `users`,
`goals` and `checkins`, and drops the scratch database. To restore for real, stop `app`, drop and
recreate `hydrox`, load the dump with `psql`, and start `app` again.

## 6. Updating

```sh
cd /opt/hydrox45 && git pull && docker compose up -d --build
```

Migrations are append-only and run on every start, so updates are safe to repeat.
