#!/usr/bin/env bash
# Draft & Draft on one small Debian server (Google Cloud e2-micro). See deploy/gcp/README.md.
#
#   sudo bash dnd.sh setup <domain> <email> <release.tar.gz>   one time: installs everything, then deploys
#   sudo dnd deploy <release.tar.gz>                           ship a new build (keeps the database and keys)
#   sudo dnd seed <users.json>                                 load the season, drivers, and league; prints setup links
#   sudo dnd logs                                              follow the app's log
#   sudo dnd status                                            is everything running?
#   sudo dnd backup                                            take a database backup now
set -euo pipefail

APP_DIR=/opt/draft-and-draft
CONF_DIR=/etc/draft-and-draft
BACKUP_DIR=/var/backups/draft-and-draft
APP_USER=dnd
DB_NAME=draft_and_draft
SERVICE=draft-and-draft

die() { echo "Error: $*" >&2; exit 1; }
# Any command that fails stops the script; say where, so the log never just ends.
trap 'echo "Error: failed at line $LINENO: $BASH_COMMAND" >&2' ERR
step() { echo; echo "==> $*"; }
[[ $EUID -eq 0 ]] || die "run this with sudo."

# Runs a command as the app user with the server's environment loaded.
as_app() { sudo -u "$APP_USER" -H bash -c "set -a; . $CONF_DIR/server.env; set +a; $1"; }

setup() {
  local domain=${1:-} email=${2:-} tarball=${3:-}
  [[ -n $domain && -n $email && -f $tarball ]] || die "usage: sudo bash dnd.sh setup <domain> <email> <release.tar.gz>"

  step "Swap space (1 GB of RAM isn't enough to build the app)"
  if ! swapon --show | grep /swapfile >/dev/null; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  fi

  step "System packages"
  export DEBIAN_FRONTEND=noninteractive
  # A fresh VM runs its own updates at first boot; wait for them instead of failing on the package lock.
  apt-get() { command apt-get -o DPkg::Lock::Timeout=1200 "$@"; }
  apt-get update -q
  apt-get upgrade -yq -o Dpkg::Options::=--force-confold
  apt-get install -yq curl ca-certificates gnupg postgresql unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

  step "Node.js 22"
  if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 22 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -yq nodejs
  fi

  step "Caddy (HTTPS certificates, automatically)"
  if ! command -v caddy >/dev/null; then
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -yq caddy
  fi

  step "App user and folders"
  id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/$APP_USER --shell /usr/sbin/nologin "$APP_USER"
  mkdir -p "$APP_DIR" "$CONF_DIR" "$BACKUP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  chown postgres:postgres "$BACKUP_DIR"
  chmod 750 "$BACKUP_DIR"

  step "Database"
  if [[ ! -f $CONF_DIR/db-password ]]; then
    # Hex from a fixed-size read: no pipe that ends early (which `set -o pipefail` would treat as a failure).
    head -c 16 /dev/urandom | od -An -tx1 | tr -d ' 
' >"$CONF_DIR/db-password"
    chmod 600 "$CONF_DIR/db-password"
  fi
  local db_pass
  db_pass=$(cat "$CONF_DIR/db-password")
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$APP_USER'" | grep 1 >/dev/null; then
    sudo -u postgres psql -qc "CREATE ROLE $APP_USER LOGIN PASSWORD '$db_pass'"
  fi
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep 1 >/dev/null; then
    sudo -u postgres createdb -O "$APP_USER" "$DB_NAME"
  fi

  step "App settings (written once; push keys must never change, or every phone has to re-subscribe)"
  if [[ ! -f $CONF_DIR/server.env ]]; then
    # A VAPID key pair for web push: P-256, public key as an uncompressed point, both base64url.
    local keys
    keys=$(node -e '
      const { generateKeyPairSync } = require("node:crypto");
      const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const pub = publicKey.export({ format: "jwk" });
      const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
      console.log(raw.toString("base64url"), privateKey.export({ format: "jwk" }).d);')
    cat >"$CONF_DIR/server.env" <<EOF
# The name shown in the app. Keep the quotes. Takes effect on the next deploy.
APP_NAME="Draft & Draft"
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://$APP_USER:$db_pass@localhost:5432/$DB_NAME
SESSION_COOKIE_NAME=dnd_session
FRONTEND_ORIGIN=https://$domain
# Caddy is the one proxy hop in front of the app.
TRUST_PROXY=1
VAPID_PUBLIC_KEY=${keys% *}
VAPID_PRIVATE_KEY=${keys#* }
VAPID_SUBJECT=mailto:$email
DISCORD_WEBHOOK_URL=
NASCAR_FEED_BASE_URL=https://cf.nascar.com
FEED_POLL_ENABLED=true
SENTRY_DSN=
MIN_CLIENT_VERSION=
LEAGUE_TIMEZONE=America/Chicago
QUIET_HOURS_START=22:00
QUIET_HOURS_END=08:00
PICK_REMINDER_HOURS=12
DEADLINE_WARNING_HOURS=12
EOF
    chown root:"$APP_USER" "$CONF_DIR/server.env"
    chmod 640 "$CONF_DIR/server.env"
  fi

  step "Service (restarts on crash and on reboot)"
  cat >/etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Draft & Draft
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$CONF_DIR/server.env
ExecStart=$APP_DIR/node_modules/.bin/tsx src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable $SERVICE >/dev/null

  step "HTTPS for $domain"
  cat >/etc/caddy/Caddyfile <<EOF
$domain {
	encode zstd gzip
	reverse_proxy localhost:3001
}
EOF
  systemctl enable caddy >/dev/null
  systemctl reload-or-restart caddy

  step "Nightly database backup (kept 14 days)"
  cat >/etc/cron.daily/draft-and-draft-backup <<EOF
#!/bin/sh
sudo -u postgres pg_dump -Fc $DB_NAME >"$BACKUP_DIR/$DB_NAME-\$(date +%F).dump"
find "$BACKUP_DIR" -name '*.dump' -mtime +14 -delete
EOF
  chmod 755 /etc/cron.daily/draft-and-draft-backup

  install -m 755 "$(readlink -f "$0")" /usr/local/bin/dnd
  deploy "$tarball"

  echo
  echo "Setup complete. Next: upload your users.json and run   sudo dnd seed ~/users.json"
}

deploy() {
  local tarball=${1:-}
  [[ -f $tarball ]] || die "usage: sudo dnd deploy <release.tar.gz>"
  tarball=$(readlink -f "$tarball")

  step "Unpacking $tarball"
  local next=$APP_DIR.next
  rm -rf "$next"
  mkdir -p "$next"
  tar -xzf "$tarball" -C "$next"
  chown -R "$APP_USER:$APP_USER" "$next"

  step "Installing packages (a few minutes on this small server)"
  sudo -u "$APP_USER" -H bash -c "cd $next && npm ci --no-audit --no-fund"

  step "Building the app"
  # Build-time client settings: the push public key (must match the server's) and the league's app name.
  local pub name
  pub=$(grep '^VAPID_PUBLIC_KEY=' "$CONF_DIR/server.env" | cut -d= -f2- || true)
  name=$(grep '^APP_NAME=' "$CONF_DIR/server.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true)
  printf 'VITE_VAPID_PUBLIC_KEY=%s\nVITE_APP_NAME="%s"\n' "$pub" "$name" >"$next/client/.env.production.local"
  chown "$APP_USER:$APP_USER" "$next/client/.env.production.local"
  sudo -u "$APP_USER" -H bash -c "cd $next && npm run build -w client"

  step "Updating the database"
  as_app "cd $next/server && npx prisma migrate deploy"

  step "Switching to the new build"
  systemctl stop $SERVICE || true
  rm -rf "$APP_DIR.previous"
  if [[ -d $APP_DIR/server ]]; then mv "$APP_DIR" "$APP_DIR.previous"; else rm -rf "$APP_DIR"; fi
  mv "$next" "$APP_DIR"
  systemctl start $SERVICE

  step "Checking it came up"
  for _ in $(seq 1 30); do
    if curl -fs http://localhost:3001/api/health >/dev/null; then
      echo "Running. $(grep '^FRONTEND_ORIGIN=' "$CONF_DIR/server.env" | cut -d= -f2-)"
      return
    fi
    sleep 2
  done
  journalctl -u $SERVICE -n 40 --no-pager
  die "the app didn't answer on its health check. The previous build is in $APP_DIR.previous."
}

seed() {
  local users=${1:-}
  [[ -f $users ]] || die "usage: sudo dnd seed <users.json>"
  install -o "$APP_USER" -g "$APP_USER" -m 600 "$users" "$APP_DIR/server/prisma/seed-data/users.json"
  as_app "cd $APP_DIR/server && npx tsx prisma/seed.ts"
}

case ${1:-} in
  setup) shift; setup "$@" ;;
  deploy) shift; deploy "$@" ;;
  seed) shift; seed "$@" ;;
  logs) journalctl -u $SERVICE -f ;;
  status)
    systemctl --no-pager status $SERVICE caddy postgresql | grep -E '●|Active:'
    curl -s http://localhost:3001/api/health && echo
    ;;
  backup) /etc/cron.daily/draft-and-draft-backup && ls -lh "$BACKUP_DIR" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
