import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { Workstation } from "@/components/workstation/Workstation";
import type { RunIndexEntry } from "@/components/workstation/ProjectRail";

export const metadata: Metadata = { title: "Workstation" };

/** The recorded replays, read from each file's own `run.started` event at build time. */
function recordedRuns(): RunIndexEntry[] {
  const dir = join(process.cwd(), "public", "replays");
  const out: RunIndexEntry[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ndjson")).sort()) {
    const first = readFileSync(join(dir, f), "utf8").split(/\r?\n/, 1)[0];
    try {
      const e = JSON.parse(first) as { type?: string; workload?: { title?: string }; backend?: string };
      if (e.type === "run.started" && e.workload?.title) out.push({ id: f.replace(/\.ndjson$/, ""), title: e.workload.title, backend: e.backend ?? "unknown" });
    } catch {
      // a replay whose first line is not a run.started event is not listed
    }
  }
  // The headline run first.
  return out.sort((a, b) => Number(b.id === "r_w1_contree3") - Number(a.id === "r_w1_contree3") || a.id.localeCompare(b.id));
}

export default function WorkstationPage() {
  return <Workstation runs={recordedRuns()} />;
}
