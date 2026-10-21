# Hosting the engine API on Nebius AI Cloud

> **Status: not deployed, and these scripts have not been run on a real VM.** We tried to create the VM on Nebius AI Cloud but the
> project refused compute writes (`PermissionDenied`), so the public demo is replay-only. The kit is kept for anyone who wants to host
> the API; treat it as a starting point and expect small fixes on the first run.

The web app on Vercel is replay-only. To let `/try` start live runs, the engine API runs on a small CPU VM:

* the API and the agent loop (calls Nemotron on Token Factory);
* every candidate CPU is verified in **Token Factory Sandboxes** (`SS_BACKEND=contree`), so the VM does not need to be big;
* Fmax place-and-route (Yosys + nextpnr) runs on the VM, so the toolchain is installed there too.

## Guard rails already in the API

whitelisted workloads only, capped search parameters, one active run, 2 runs per IP per hour, a daily Nemotron spend cap
(`SS_DAILY_BUDGET_USD`, persisted in a ledger file), and a per-run cap. `X-Forwarded-For` is only trusted with `SS_TRUST_PROXY=1`
(set by `setup.sh`, because Caddy is the only thing that can reach the API).

## Steps

1. In the Nebius AI Cloud console create a VM: Ubuntu 24.04, about 4 vCPU and 8 GB RAM, a public IP, a 40 GB disk,
   and open inbound TCP 22, 80 and 443. Check the hourly price in the console before creating it.
2. From this repo: `bash deploy/nebius/package.sh`, then copy `/tmp/siliconsmith.tgz` and your `.env.local` to the VM
   (the command is in `package.sh`). The key travels only by `scp`, never through git.
3. On the VM: `sudo bash /opt/siliconsmith/deploy/nebius/setup.sh <ip>.sslip.io https://siliconsmith.vercel.app`.
4. Check `https://<ip>.sslip.io/api/health`.
5. Point the web app at it: set `NEXT_PUBLIC_ENGINE_URL=https://<ip>.sslip.io` in the Vercel project and redeploy.
6. Rerun `node scripts/loadtest.mjs` against the web URL and start one live run from `/try`.

Stop the VM after judging windows if you want to save credit: replays keep working without it.
