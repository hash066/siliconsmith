# Creates a dedicated WSL distro `siliconsmith` on E: (keeps C: free) and installs the toolchain.
# Uses the official Ubuntu 24.04 WSL rootfs, so Docker is not required.
$ErrorActionPreference = 'Stop'
$root = 'E:\WSL\siliconsmith'
$tgz  = 'E:\WSL\ubuntu-noble-wsl-amd64.rootfs.tar.gz'
$url  = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz'
New-Item -ItemType Directory -Force $root | Out-Null
$distros = ((wsl.exe -l -q) -replace "`0","") -split "`r?`n" | ForEach-Object { $_.Trim() }
if ($distros -notcontains 'siliconsmith') {
  if (-not (Test-Path $tgz)) { curl.exe -fsSL $url -o $tgz }
  wsl.exe --import siliconsmith $root $tgz --version 2
  Remove-Item $tgz -Force
}
$script = '/mnt/e/Winter/siliconsmith/scripts/setup-toolchain.sh'
wsl.exe -d siliconsmith -u root -- bash -lc "sed -i 's/\r$//' $script && bash $script"
