"use client";

import { useEffect, useState } from "react";
import type { RunController, Snapshot } from "@/lib/controller";
import { allPass, candidates, passCount, rungCell, rungsOf, replayFileUrl } from "@/lib/domain";
import { ArtifactList, DomainHeader, Panel } from "./DomainShell";
import { CellGlyph, MatrixLegend, RungMatrix, type RungSelection } from "./RungMatrix";
import { isDesignJson, SchematicGraph, type DesignJson } from "./SchematicGraph";

/** One-line result for the header. Passing is stated only when every announced rung passed on the best design. */
export function boardFinding(s: Snapshot["state"]): string {
  const rungs = rungsOf(s);
  const best = s.best ? s.nodes[s.best] : null;
  if (s.status === "failed") return `The run failed: ${s.error}`;
  if (best && allPass(best, rungs)) return `${best.id} passes all ${rungs.length} rungs (${rungs.map((r) => r.id).join(", ")}). The checks use author-curated facts.`;
  if (s.status === "completed") {
    const top = candidates(s).sort((a, b) => passCount(b, rungs).pass - passCount(a, rungs).pass)[0];
    return top ? `No design passed every rung. Closest: ${top.id} with ${passCount(top, rungs).pass} of ${rungs.length}.` : "No design was judged.";
  }
  const c = candidates(s);
  return c.length ? `Judging design ${c.at(-1)!.id} · ${c.length} judged so far` : "Waiting for the first design…";
}

function useDesign(runId: string | null, nodeId: string | null): { state: "idle" | "loading" | "missing" | "bad" | "ok"; design: DesignJson | null } {
  const [r, setR] = useState<{ key: string; state: "loading" | "missing" | "bad" | "ok"; design: DesignJson | null } | null>(null);
  const key = runId && nodeId ? `${runId}/${nodeId}` : "";
  useEffect(() => {
    if (!key) return;
    let dead = false;
    (async () => {
      try {
        const res = await fetch(replayFileUrl(runId!, nodeId!, "design.json"), { cache: "no-store" });
        if (!res.ok) return !dead && setR({ key, state: "missing", design: null });
        const j: unknown = await res.json();
        if (!dead) setR(isDesignJson(j) ? { key, state: "ok", design: j } : { key, state: "bad", design: null });
      } catch {
        if (!dead) setR({ key, state: "missing", design: null });
      }
    })();
    return () => {
      dead = true;
    };
  }, [key, runId, nodeId]);
  if (!key) return { state: "idle", design: null };
  return r && r.key === key ? r : { state: "loading", design: null };
}

export function BoardCanvas({ c, snap, sel, onSelect }: { c: RunController; snap: Snapshot; sel: RungSelection | null; onSelect: (s: RungSelection) => void }) {
  const s = snap.state;
  const rungs = rungsOf(s);
  const nodes = candidates(s);
  const graphNode = sel?.nodeId ?? s.best ?? nodes.at(-1)?.id ?? null;
  const design = useDesign(s.runId, graphNode);
  const cited = new Set<string>();
  if (sel && graphNode) {
    const n = s.nodes[graphNode];
    const rung = rungs.find((r) => r.id === sel.rung);
    if (n && rung) for (const f of rungCell(n, rung).evidence) cited.add(f.replace(/^part:/, "").split(".")[0]);
  }
  const selNode = sel ? s.nodes[sel.nodeId] : null;
  const selRung = sel ? rungs.find((r) => r.id === sel.rung) : null;
  const selCell = selNode && selRung ? rungCell(selNode, selRung) : null;

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <DomainHeader
        title={s.workload?.title ?? s.runId ?? "Board run"}
        sub={`Board · ${s.workload?.id ?? ""} · ${nodes.length} design${nodes.length === 1 ? "" : "s"} judged · ${snap.mode === "live" ? "live" : "replay"}`}
        finding={boardFinding(s)}
        notice="Netlist-level co-design check only: no PCB layout, routing, EMC or fabrication, and no claim that a design will work on a real board. Part facts are author-curated from public documents, not independently verified. Battery life is a model, not a measurement."
        c={c}
        snap={snap}
      />

      <Panel title="Check matrix" aside={<span className="num text-[12px] text-ink-3">{rungs.length} rungs · {nodes.length} designs</span>}>
        <RungMatrix state={s} selected={sel} onSelect={onSelect} />
        <div className="border-t border-line px-4 py-2.5">
          <MatrixLegend />
        </div>
      </Panel>

      {selCell && selNode && selRung && (
        <Panel title={`${selNode.id} · ${selRung.id}`} aside={<span className="flex items-center gap-1.5 text-[12px] text-ink-2"><CellGlyph status={selCell.status} />{selCell.status}</span>}>
          <div className="px-4 py-3 text-[13px] leading-snug">
            {selCell.claim ? <p className="text-ink">{selCell.claim}</p> : <p className="text-ink-2">{selRung.id} did not pass on {selNode.id}; its label is not shown as a claim.</p>}
            {selCell.detail && <p className="mt-1.5 break-words text-ink-2">{selCell.detail}</p>}
            <p className="mt-1.5 text-[12px] text-ink-3">The evidence drawer lists the fact ids this check used.</p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)] [&>*]:min-w-0">
        <Panel title="Connection graph" aside={<span className="num text-[12px] text-ink-3">{graphNode ?? "no design"}</span>}>
          {design.state === "ok" && design.design ? (
            <div className="p-3">
              <SchematicGraph design={design.design} highlight={cited} />
              <p className="mt-1 text-[12px] text-ink-3">Parts are boxes, nets are dots. This is a connection graph, not a laid-out schematic{cited.size ? "; amber parts are the ones the selected check cited" : ""}.</p>
            </div>
          ) : (
            <p className="px-4 py-4 text-[13px] leading-snug text-ink-3" role="status">
              {design.state === "loading"
                ? "Loading the design file…"
                : design.state === "bad"
                  ? "The design file for this node is not in the expected format."
                  : "No design file is shipped with this replay for this node, so there is no graph to draw. A design file is written only for a design that passed every rung."}
            </p>
          )}
        </Panel>
        <Panel title="Artifacts" aside={<span className="num text-[12px] text-ink-3">{s.artifacts.length}</span>}>
          <ArtifactList artifacts={s.artifacts} />
        </Panel>
      </div>
    </div>
  );
}
