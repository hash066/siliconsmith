// Old /workstation links keep working: `?run=<id>` opens that recorded run, `?wb=` keeps the workbench, everything else is dropped.
export function workstationRedirect(sp: Record<string, string | string[] | undefined>): string {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const run = one(sp.run);
  const wb = one(sp.wb);
  const q = new URLSearchParams();
  if (run && /^[A-Za-z0-9_-]{1,64}$/.test(run)) {
    q.set("wb", "silicon");
    q.set("run", run);
  } else if (wb === "board" || wb === "matter" || wb === "silicon") q.set("wb", wb);
  const s = q.toString();
  return s ? `/app?${s}` : "/app";
}
