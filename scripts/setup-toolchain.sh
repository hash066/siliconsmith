#!/usr/bin/env bash
# Runs INSIDE the `siliconsmith` WSL distro (and inside the sandbox image).
# Installs: build tools, RISC-V bare-metal GCC, Python, OSS CAD Suite
# (Verilator, Yosys, SymbiYosys + solvers, nextpnr-himbaechel, openFPGALoader).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  build-essential git curl wget ca-certificates xz-utils make jq \
  python3 python3-venv python3-pip \
  gcc-riscv64-unknown-elf binutils-riscv64-unknown-elf picolibc-riscv64-unknown-elf >/dev/null
if [ ! -x /opt/oss-cad-suite/bin/yosys ]; then
  url=$(curl -fsSL https://api.github.com/repos/YosysHQ/oss-cad-suite-build/releases/latest \
        | jq -r '.assets[] | select((.name|startswith("oss-cad-suite-linux-x64-")) and (.name|endswith(".tgz"))) | .browser_download_url' | head -1)
  echo "OSS CAD Suite: $url"
  curl -fsSL "$url" -o /tmp/ocs.tgz
  tar -xzf /tmp/ocs.tgz -C /opt && rm -f /tmp/ocs.tgz
fi
grep -q oss-cad-suite /etc/profile.d/ocs.sh 2>/dev/null || echo 'export PATH=/opt/oss-cad-suite/bin:$PATH' > /etc/profile.d/ocs.sh
export PATH=/opt/oss-cad-suite/bin:$PATH
echo "--- versions ---"
riscv64-unknown-elf-gcc --version | head -1
verilator --version
yosys -V
sby --help >/dev/null 2>&1 && echo "sby ok"
nextpnr-himbaechel --version 2>&1 | head -1 || true
python3 --version
