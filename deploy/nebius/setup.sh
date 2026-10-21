#!/usr/bin/env bash
# Provision the SiliconSmith engine API on a fresh Ubuntu 24.04 VM (Nebius AI Cloud, CPU-only is enough:
# candidate verification runs in Token Factory Sandboxes; the VM runs the API, the agent loop and Fmax place-and-route).
#
#   sudo bash setup.sh <public-hostname> <allowed-web-origin>
#   e.g. sudo bash setup.sh 203.0.113.7.sslip.io https://siliconsmith.vercel.app
#
# Expects the repo at /opt/siliconsmith (see deploy/nebius/package.sh) and the secrets file at /etc/siliconsmith.env
# (copy it from your machine with scp; it is never part of the repo). sslip.io gives a real hostname for a bare IP so Caddy
# can obtain a Let's Encrypt certificate without owning a domain.
set -euo pipefail
HOST="${1:?public hostname, e.g. 203.0.113.7.sslip.io}"
ORIGIN="${2:?web origin allowed by CORS, e.g. https://siliconsmith.vercel.app}"
APP=/opt/siliconsmith
[ -d "$APP/engine" ] || { echo "$APP/engine missing: upload the repo first" >&2; exit 1; }
[ -f /etc/siliconsmith.env ] || { echo "/etc/siliconsmith.env missing: scp your .env.local there" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
bash "$APP/scripts/setup-toolchain.sh"            # Verilator, Yosys, SymbiYosys, nextpnr, RISC-V GCC (Fmax needs Yosys + nextpnr)
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gpg >/dev/null
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sed 's#^deb #deb [signed-by=/usr/share/keyrings/caddy.gpg] #' > /etc/apt/sources.list.d/caddy.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

python3 -m venv /opt/ss-venv
/opt/ss-venv/bin/pip install -q -e "$APP/engine[sandboxes,server]"

id -u siliconsmith >/dev/null 2>&1 || useradd --system --home /var/lib/siliconsmith --create-home siliconsmith
mkdir -p /var/tmp/ss-runs "$APP/runs/logs"
chown -R siliconsmith:siliconsmith /var/tmp/ss-runs "$APP/runs"
chmod 640 /etc/siliconsmith.env && chown root:siliconsmith /etc/siliconsmith.env

# Server-side limits (the API also enforces its own caps). Appended once.
grep -q '^SS_BACKEND=' /etc/siliconsmith.env || cat >> /etc/siliconsmith.env <<EOF
SS_BACKEND=contree
SS_TRUST_PROXY=1
SS_MAX_ACTIVE_RUNS=1
SS_RUNS_PER_IP_HOUR=2
SS_DAILY_BUDGET_USD=3
SS_RUN_BUDGET_USD=1.5
EOF
grep -q '^SS_CORS_ORIGINS=' /etc/siliconsmith.env || echo "SS_CORS_ORIGINS=${ORIGIN}" >> /etc/siliconsmith.env

cat > /etc/systemd/system/siliconsmith-api.service <<EOF
[Unit]
Description=SiliconSmith engine API
After=network-online.target

[Service]
User=siliconsmith
WorkingDirectory=$APP/engine
EnvironmentFile=/etc/siliconsmith.env
Environment=PATH=/opt/oss-cad-suite/bin:/opt/ss-venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/opt/ss-venv/bin/uvicorn siliconsmith.api:app --host 127.0.0.1 --port 8080 --proxy-headers
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
${HOST} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080 {
		flush_interval -1
		transport http {
			read_timeout 1h
		}
	}
}
EOF

systemctl daemon-reload
systemctl enable --now siliconsmith-api
systemctl restart caddy
sleep 4
curl -fsS http://127.0.0.1:8080/api/health && echo
echo "API up. Check https://${HOST}/api/health (needs ports 80 and 443 open in the VM's security group)."
