"use client";

import { useMemo } from "react";
import { ApiErrorView } from "../domain/ApiErrorView";
import { isDesignJson, type DesignJson } from "../domain/SchematicGraph";
import { blockDiagram, BLOCK_H, BLOCK_VIEW, BLOCK_W } from "./blocks";
import { CheckCards } from "./CheckCards";
import { boardChecks, type CheckCard } from "./verdict";
import type { BoardBench } from "./useBoardBench";
import { btnPrimary } from "./ui";

export function parseDesign(text: string): { design: (DesignJson & { mcu_ref?: string }) | null; error: string | null } {
  if (!text.trim()) return { design: null, error: null };
  try {
    const j: unknown = JSON.parse(text);
    if (!isDesignJson(j)) return { design: null, error: "The design has no parts and nets, so there is nothing to draw." };
    const m = Reflect.get(j, "mcu_ref");
    return { design: { ...j, mcu_ref: typeof m === "string" ? m : undefined }, error: null };
  } catch (e) {
    return { design: null, error: `The design is not valid JSON yet: ${e instanceof Error ? e.message : "parse error"}` };
  }
}

/** Four or five labelled blocks and the links between them, drawn from the real design. Not a schematic and not a layout. */
function BlockDiagram({ design, hot }: { design: DesignJson & { mcu_ref?: string }; hot: Set<string> }) {
  const g = useMemo(() => blockDiagram(design), [design]);
  const at = new Map(g.nodes.map((n) => [n.id, n]));
  const c = (id: string) => {
    const n = at.get(id as never)!;
    return [n.x + BLOCK_W / 2, n.y + BLOCK_H / 2] as const;
  };
  return (
    <svg viewBox={`0 0 ${BLOCK_VIEW.w} ${BLOCK_VIEW.h}`} className="mx-auto block h-auto w-full max-w-[560px]" role="img" aria-label={`Block diagram: ${g.nodes.map((n) => n.label).join(", ")}. ${g.links.length} links between blocks.`}>
      {g.links.map((l, k) => {
        const [x1, y1] = c(l.a);
        const [x2, y2] = c(l.b);
        return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={l.kind === "power" ? "var(--hw-warn)" : "var(--ink-3)"} strokeWidth="1.4" strokeDasharray={l.kind === "power" ? "4 3" : undefined} opacity="0.85" />;
      })}
      {g.nodes.map((n) => {
        const bad = n.parts.some((p) => hot.has(p));
        return (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={BLOCK_W} height={BLOCK_H} rx="10" fill="var(--raised)" stroke={bad ? "var(--hw-warn)" : "var(--line-2)"} strokeWidth={bad ? 2 : 1} />
            <text x={n.x + 10} y={n.y + 20} fontSize="12" fontWeight="600" fill="var(--ink)">
              {n.label}
            </text>
            <text x={n.x + 10} y={n.y + 38} fontSize="9.5" fill="var(--ink-3)" fontFamily="var(--font-code)">
              {n.parts.slice(0, 3).join(" · ")}
              {n.parts.length > 3 ? " …" : ""}
            </text>
          </g>
        );
      })}
      {g.links.map((l, k) => {
        const [x1, y1] = c(l.a);
        const [x2, y2] = c(l.b);
        return (
          <text key={`t${k}`} x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 3} fontSize="9" textAnchor="middle" fill="var(--ink-2)" fontFamily="var(--font-code)" stroke="var(--panel)" strokeWidth="3.5" paintOrder="stroke">
            {l.label}
          </text>
        );
      })}
    </svg>
  );
}

export function BoardPreview({ b, tab, onFix }: { b: BoardBench; tab: "preview" | "proof"; onFix: (c: CheckCard) => void }) {
  const check = b.result?.check ?? null;
  const cards = useMemo(() => (check ? boardChecks(check) : []), [check]);
  const parsed = useMemo(() => parseDesign(b.designText), [b.designText]);
  const hot = useMemo(() => {
    const s = new Set<string>();
    if (check) for (const r of check.rungs) if (r.status !== "pass") for (const id of r.evidence) s.add(check.evidence[id]?.part ?? id.replace(/^part:/, "").split(".")[0]);
    return s;
  }, [check]);

  if (b.failure && !check) return <div className="p-4"><ApiErrorView failure={b.failure} onRetry={() => void b.check()} /></div>;
  if (!check) {
    return (
      <div className="grid min-h-[320px] place-items-center p-6" role="status">
        {b.busy === "checking" || b.tplLoading || b.templates.state === "loading" ? (
          <div className="w-full max-w-sm text-center">
            <div className="mx-auto h-36 w-full animate-pulse rounded-2xl bg-raised" />
            <p className="mt-3 text-[13px] text-ink-3">{b.busy === "checking" ? "Checking the board against its firmware…" : "Loading the design…"}</p>
          </div>
        ) : (
          <div className="max-w-sm text-center">
            <h3 className="text-[16px] font-semibold text-ink">No board checked yet</h3>
            <p className="mt-1.5 text-[13px] leading-snug text-ink-3">Describe a board in the chat, or check the example one. It is free and takes a moment.</p>
            <button type="button" onClick={() => void b.check()} disabled={!b.designText.trim()} className={`${btnPrimary} mt-4`}>
              Check the example board
            </button>
          </div>
        )}
      </div>
    );
  }
  const stale = b.stale ? <p className="rounded-lg bg-amber-dim px-3 py-2 text-[12.5px] text-ink" role="status">The design changed after this check. Ask the agent to re-check, or open Advanced and press Check.</p> : null;
  if (tab === "proof") {
    return (
      <div className="flex flex-col gap-3 p-4">
        {stale}
        <p className="text-[12.5px] leading-snug text-ink-2">Five checks, run by deterministic code (no AI). Open one to see the part facts it used.</p>
        <CheckCards cards={cards} facts={check.evidence} detail={Object.fromEntries(check.ladder.map((l) => [l.id, l.tool]))} />
        <p className="text-[11.5px] leading-snug text-ink-3">{check.notice}</p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4" aria-live="polite">
      {stale}
      {b.failure && <ApiErrorView failure={b.failure} />}
      <section aria-label="Block diagram" className="rounded-xl border border-line bg-panel p-3">
        <h3 className="hw-label mb-1 !text-[10.5px]">What is on the board</h3>
        {parsed.design ? <BlockDiagram design={parsed.design} hot={hot} /> : <p className="py-6 text-center text-[13px] text-ink-3">{parsed.error}</p>}
        <p className="mt-1 text-[11.5px] leading-snug text-ink-3">Blocks and the signals between them, from your design. Dashed lines are power. Not a schematic or a layout.</p>
      </section>
      <CheckCards cards={cards} onFix={onFix} busy={b.busy !== "idle"} />
    </div>
  );
}
