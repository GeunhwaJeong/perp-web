#!/usr/bin/env bash
# Prepares the Sigma VPS once, as root: swap, Postgres, the sigma user and directories, the
# keeper's database and its backup, Caddy's site file and the systemd units. Idempotent. Secrets
# (keys, env files) are placed by hand into /etc/sigma afterwards; see README.md.
set -euo pipefail

# 2 GB of swap on a 4 GB box: a safety net for the indexer's backfill and Postgres peaks.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update
apt-get install -y postgresql postgresql-contrib libpq5
systemctl enable --now postgresql

id sigma >/dev/null 2>&1 || useradd --system --home /opt/sigma --shell /usr/sbin/nologin sigma
install -d -o sigma -g sigma -m 750 /opt/sigma /opt/sigma/bin
install -d -o root -g sigma -m 750 /etc/sigma
install -d -o caddy -g caddy -m 755 /var/www/sigma

# One database, one role with a password kept only in the env files.
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='sigma'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE sigma LOGIN PASSWORD '${SIGMA_DB_PASSWORD:?set SIGMA_DB_PASSWORD}'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='perp_indexer'" | grep -q 1 || \
  sudo -u postgres createdb -O sigma perp_indexer
# The keeper's own database: the order tickets' details exist nowhere else, so it is kept apart
# from the indexer's and dumped daily (sigma-keeper-backup.timer).
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='sigma_keeper'" | grep -q 1 || \
  sudo -u postgres createdb -O sigma sigma_keeper
install -d -o postgres -g postgres -m 700 /var/backups/sigma-keeper
install -m 755 "$(dirname "$0")/sigma-keeper-backup" /usr/local/sbin/sigma-keeper-backup
# The indexer's database is trimmed daily instead (sigma-indexer-prune.timer): nothing in the
# indexer deletes, and its two largest tables would fill the disk.
install -m 755 "$(dirname "$0")/sigma-indexer-prune" /usr/local/sbin/sigma-indexer-prune
install -m 755 "$(dirname "$0")/sigma-watchdog" /usr/local/sbin/sigma-watchdog

# Login bots fill sshd's default connection backlog (10) and the box drops our sessions.
printf 'MaxStartups 50:30:200\nLoginGraceTime 20\n' > /etc/ssh/sshd_config.d/70-sigma.conf
sshd -t && systemctl reload ssh

install -m 644 "$(dirname "$0")/systemd/"sigma-*.service "$(dirname "$0")/systemd/"sigma-*.timer /etc/systemd/system/
systemctl daemon-reload
install -m 644 "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
echo "bootstrap done"
