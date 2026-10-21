#!/usr/bin/env bash
# Package the committed repo (no secrets, no local runs) for upload to the VM:
#   bash deploy/nebius/package.sh            -> /tmp/siliconsmith.tgz
#   scp /tmp/siliconsmith.tgz .env.local <user>@<vm-ip>:~
#   ssh <user>@<vm-ip> 'sudo mkdir -p /opt/siliconsmith && sudo tar xzf siliconsmith.tgz -C /opt/siliconsmith \
#       && sudo install -m 640 .env.local /etc/siliconsmith.env && sudo bash /opt/siliconsmith/deploy/nebius/setup.sh <ip>.sslip.io https://siliconsmith.vercel.app'
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git archive --format=tar.gz --prefix= -o /tmp/siliconsmith.tgz HEAD
ls -l /tmp/siliconsmith.tgz
