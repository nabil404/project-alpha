#!/bin/bash
# Installs the nightly backup timer. Idempotent; deploy.sh runs it on every
# successful release so a change here ships like any other.
set -euo pipefail

cat >/etc/systemd/system/app-backup.service <<'EOF'
[Unit]
Description=Nightly pg_dump to S3
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/app/current/infra/server/backup.sh
EOF

cat >/etc/systemd/system/app-backup.timer <<'EOF'
[Unit]
Description=Nightly pg_dump to S3

[Timer]
OnCalendar=*-*-* 03:00:00 UTC
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now app-backup.timer >/dev/null
