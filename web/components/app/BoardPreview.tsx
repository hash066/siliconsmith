"use client";

import { useMemo, useState } from "react";
import { markersFor, type Marker } from "@/lib/layout";
import { PcbView } from "./PcbView";
import { SchematicView } from "./SchematicView";
import { Ledger } from "./Ledger";
import { Board3DView } from "./Board3DView";
import { DrcPanel, ManufacturePanel, useDrcText } from "./FabPanels";
import { PartsPanel } from "./PartsPanel";
import type { ProductFile } from "./files";
import { boardLedger } from "@/lib/ledger";
import type { Generation, LayoutOptions, LayoutState } from "./useBoardLayout";
import { ApiErrorView } from "../domain/ApiErrorView";
import { isDesignJson, type DesignJson } from "../domain/SchematicGraph";
import { blockDiagram, BLOCK_H, BLOCK_VIEW, BLOCK_W } from "./blocks";
import { CheckCards } from "./CheckCards";
import { boardChecks, type CheckCard } from "./verdict";
import type { BoardBench } from "./useBoardBench";
import { btnGhost, btnPrimary } from "./ui";
import { MakeBoardCard, RequestNote } from "./MakeBoardCard";

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

type Layout = LayoutState & { design: Parameters<typeof markersFor>[0]; generation: Generation; generate: (opts?: LayoutOptions) => void; cancel: () => void };

type Stage = "design" | "parts" | "drc" | "manufacture";
type View = "layout" | "studio" | "3d" | "schematic" | "blocks";

export function BoardPreview({ b, tab, onFix, layout, files, onAsk }: { b: BoardBench; tab: "preview" | "proof"; onFix: (c: CheckCard) => void; layout: Layout; files: ProductFile[]; onAsk: (text: string) => void }) {
  const [focus, setFocus] = useState<Marker | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [stage, setStage] = useState<Stage>("design");
  const [focusAt, setFocusAt] = useState<{ x: number; y: number } | null>(null);
  const drcHref = layout.status === "ready" && layout.dir && !layout.downloads ? `/boards/${layout.dir}/drc.txt` : null;
  const drcB64 = layout.status === "ready" ? (layout.downloads?.find((d) => d.name === "drc.txt")?.base64 ?? null) : null;
  const drcText = useDrcText(drcHref, drcB64);
  const gerber = files.find((f) => f.name === "gerbers-and-drill.zip") ?? null;
  const check = b.result?.check ?? null;
  const cards = useMemo(() => (check ? boardChecks(check) : []), [check]);
  const parsed = useMemo(() => parseDesign(b.designText), [b.designText]);
  const hot = useMemo(() => {
    const s = new Set<string>();
    if (check) for (const r of check.rungs) if (r.status !== "pass") for (const id of r.evidence) s.add(check.evidence[id]?.part ?? id.replace(/^part:/, "").split(".")[0]);
    return s;
  }, [check]);

  const markers = useMemo(() => (layout.status === "ready" ? markersFor(layout.design, layout.summary, check) : []), [layout, check]);
  const showable = useMemo(() => new Set(markers.map((m) => m.rung)), [markers]);
  const shown: View = view ?? (layout.status === "ready" ? "layout" : layout.design ? "schematic" : "blocks");
  const onShow = (c: CheckCard) => setFocus(markers.find((m) => m.rung === c.id && m.kind !== "wired") ?? markers.find((m) => m.rung === c.id) ?? null);

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
        <Ledger rows={boardLedger({ check, layout: layout.status === "ready" ? { status: "ready", routed: layout.summary.stats.fully_routed, drcErrors: layout.summary.drc.errors, unrouted: layout.summary.stats.unrouted_connections, kicad: layout.summary.generated_with.kicad, router: layout.summary.generated_with.router } : { status: layout.status } })} />
        <p className="text-[11.5px] leading-snug text-ink-3">{check.notice}</p>
      </div>
    );
  }
  const designView = (
    <div className="flex min-w-0 flex-col gap-4 p-4" aria-live="polite">
      {stale}
      {b.failure && <ApiErrorView failure={b.failure} />}
      <section aria-label="Your board" className="min-w-0 rounded-xl border border-line bg-panel p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="hw-label !text-[10.5px]">Your board</h3>
          <div role="tablist" aria-label="Board views" className="ml-auto inline-flex rounded-lg border border-line bg-bg p-0.5">
            {(
              [
                ["layout", "Layout", layout.status === "ready"],
                ["studio", "Studio", layout.status === "ready"],
                ["3d", "3D", layout.status === "ready"],
                ["schematic", "Schematic", !!layout.design],
                ["blocks", "Blocks", !!parsed.design],
              ] as const
            )
              .filter(([, , on]) => on)
              .map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={shown === k} onClick={() => setView(k)} data-testid={`bview-${k}`} className={`h-7 rounded-md px-2.5 text-[12px] ${shown === k ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}>
                  {label}
                </button>
              ))}
          </div>
        </div>
        {layout.status === "none" && parsed.design && (
          <div className="mb-3 rounded-xl border border-line bg-sunken p-3" data-testid="make-board">
            {layout.generation.status === "running" ? (
              <div role="status" aria-live="polite">
                <p className="text-[13.5px] font-medium text-ink">Making your routed board…</p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
                  {layout.generation.step || "Starting"} · <span className="num">{layout.generation.seconds}s</span>
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-ink-3">The parts are placed by rules, then routed and checked by KiCad in a Sandbox. This usually takes one to two minutes.</p>
                <button type="button" onClick={layout.cancel} className={`${btnGhost} mt-2 !h-8`}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <p className="text-[13.5px] font-medium text-ink">No routed board for this design yet</p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-2">The checks above ran on your netlist. You can also turn it into a real 2-layer board: placed, routed with copper tracks, checked by KiCad, with Gerbers to download. Free; takes one to two minutes.</p>
                <MakeBoardCard onMake={layout.generate} label={layout.generation.status === "failed" ? "Try again" : "Make a routed board"} error={layout.generation.status === "failed" ? layout.generation.message : undefined} />
              </>
            )}
          </div>
        )}
        {shown === "schematic" && layout.design ? (
          <SchematicView design={layout.design as never} />
        ) : shown === "3d" && layout.status === "ready" ? (
          <Board3DView geom={layout.geom} />
        ) : shown === "studio" && layout.status === "ready" ? (
          <div className="grid min-w-0 gap-3 @2xl:grid-cols-2" data-testid="studio">
            <PcbView geom={layout.geom} markers={markers} focus={focus} onFocusMarker={setFocus} focusAt={focusAt} />
            <Board3DView geom={layout.geom} />
          </div>
        ) : shown === "layout" && layout.status === "ready" ? (
          <>
            <PcbView geom={layout.geom} markers={markers} focus={focus} onFocusMarker={setFocus} focusAt={focusAt} />
            <p className="mt-2 text-[12.5px] leading-snug text-ink-2" data-testid="layout-status">
              {layout.summary.stats.fully_routed ? "Fully routed" : `${layout.summary.stats.unrouted_connections} connection(s) not routed`} · {layout.summary.stats.board_mm[0]} × {layout.summary.stats.board_mm[1]} mm, 2 layers · KiCad design-rule check: {layout.summary.drc.errors} errors, {layout.summary.drc.warnings} warnings (silkscreen).
            </p>
            <RequestNote request={layout.summary.request} />
            {markers.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5" aria-label="Findings on the board">
                {markers.map((m, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => setFocus(m)} className="flex w-full items-start gap-2 rounded-lg bg-sunken px-2.5 py-2 text-left text-[12.5px] leading-snug text-ink-2 hover:text-ink">
                      <span aria-hidden="true" className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.kind === "fail" ? "#ff4d4d" : m.kind === "wired" ? "#5fd38d" : "#ffb020" }} />
                      <span>
                        <span className="num text-ink-3">
                          {m.ref} pad {m.pad} ·{" "}
                        </span>
                        {m.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-2 text-[12px] text-ink-3">
              <summary className="cursor-pointer">What this is, and what it is not</summary>
              <p className="mt-1 leading-snug">
                {layout.summary.tool_note} Made with KiCad {layout.summary.generated_with.kicad} and {layout.summary.generated_with.router}; {layout.summary.generated_with.rules}. {layout.summary.notes.join(" ")}
              </p>
            </details>
          </>
        ) : layout.status === "loading" ? (
          <div role="status" className="grid h-[420px] place-items-center rounded-xl bg-sunken text-[13px] text-ink-3">
            Loading the board…
          </div>
        ) : (
          <>
            {parsed.design ? <BlockDiagram design={parsed.design} hot={hot} /> : <p className="py-6 text-center text-[13px] text-ink-3">{parsed.error}</p>}
            <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
              {layout.status === "failed" ? `The routed board could not be loaded (${layout.message}). ` : "No routed board has been generated for this exact design yet; boards for the built-in examples are ready. "}
              This block diagram is drawn from your design. It is not a schematic or a layout.
            </p>
          </>
        )}
      </section>
      <CheckCards cards={cards} onFix={onFix} busy={b.busy !== "idle"} onShow={layout.status === "ready" ? onShow : undefined} showable={showable} />
    </div>
  );
  const ready = layout.status === "ready";
  const dotOf = (s: Stage): string => {
    if (s === "design") return check ? (check.passed ? "var(--hw-ok)" : "var(--hw-bad)") : "var(--ink-3)";
    if (s === "parts") return layout.design ? "var(--hw-ok)" : "var(--ink-3)";
    if (s === "drc") return ready ? (layout.summary.drc.errors === 0 ? "var(--hw-ok)" : "var(--hw-bad)") : "var(--ink-3)";
    return ready && layout.summary.drc.errors === 0 && layout.summary.stats.fully_routed ? "var(--hw-ok)" : "var(--ink-3)";
  };
  const STAGES: Array<[Stage, string, string]> = [
    ["design", "Design", check ? `${check.rungs.filter((r) => r.status === "pass").length}/${check.rungs.length} checks` : "not checked"],
    ["parts", "Parts and BOM", layout.design ? `${layout.design.instances.length} parts` : "-"],
    ["drc", "DRC", ready ? `${layout.summary.drc.errors} errors` : "needs a board"],
    ["manufacture", "Manufacture", ready ? (layout.summary.stats.fully_routed ? "files ready" : "not routed") : "needs a board"],
  ];
  const strip = (
    <div role="tablist" aria-label="Board stages" className="scroll-quiet flex gap-1 overflow-x-auto border-b border-line px-4 pt-3" data-testid="stage-strip">
      {STAGES.map(([id, label, sub]) => (
        <button key={id} type="button" role="tab" aria-selected={stage === id} onClick={() => setStage(id)} data-testid={`stage-${id}`} className={`flex shrink-0 flex-col rounded-t-lg border border-b-0 px-3 py-1.5 text-left ${stage === id ? "border-line bg-panel" : "border-transparent text-ink-3 hover:text-ink"}`}>
          <span className="flex items-center gap-1.5 text-[12.5px] text-ink">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: dotOf(id) }} />
            {label}
          </span>
          <span className="num text-[10.5px] text-ink-3">{sub}</span>
        </button>
      ))}
    </div>
  );
  return (
    <>
      {strip}
      {stage === "design" ? (
        designView
      ) : stage === "parts" ? (
        <PartsPanel design={layout.design} onAsk={onAsk} />
      ) : ready ? (
        stage === "drc" ? (
          <DrcPanel
            summary={layout.summary}
            reportText={drcText}
            onShow={(x, y) => {
              setFocusAt({ x, y });
              setView("layout");
              setStage("design");
            }}
          />
        ) : (
          <ManufacturePanel summary={layout.summary} gerber={gerber} />
        )
      ) : (
        <div className="grid min-h-[200px] place-items-center p-6 text-center" role="status">
          <p className="max-w-sm text-[13px] leading-snug text-ink-3">This needs a routed board. Open the Design stage and choose Make a routed board (built-in examples already have one).</p>
        </div>
      )}
    </>
  );
}
