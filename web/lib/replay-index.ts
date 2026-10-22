// Server-only: the recorded replays, read from each file's own `run.started` event at build/request time.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ReplayIndexEntry {
  id: string;
  title: string;
  backend: string;
  domain: string;
}

export function recordedRuns(dir = join(process.cwd(), "public", "replays")): ReplayIndexEntry[] {
  const out: ReplayIndexEntry[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ndjson")).sort()) {
    const first = readFileSync(join(dir, f), "utf8").split(/\r?\n/, 1)[0];
    try {
      const e = JSON.parse(first) as { type?: string; workload?: { title?: string }; backend?: string; domain?: string };
      if (e.type === "run.started" && e.workload?.title) out.push({ id: f.replace(/\.ndjson$/, ""), title: e.workload.title, backend: e.backend ?? "unknown", domain: e.domain ?? "silicon" });
    } catch {
      // a replay whose first line is not a run.started event is not listed
    }
  }
  // The headline run first.
  return out.sort((a, b) => Number(b.id === "r_w1_contree3") - Number(a.id === "r_w1_contree3") || a.id.localeCompare(b.id));
}
