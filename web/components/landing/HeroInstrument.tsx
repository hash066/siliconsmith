"use client";

import Link from "next/link";
import { useMemo } from "react";
import { clock, int, pct, times, usd } from "@/lib/format";
import { useMediaQuery, useRunSource, useSnapshot, useTicking } from "@/lib/hooks";
import { counts, wallOf } from "@/lib/run-state";
import type { RunController } from "@/lib/controller";
import { BranchTree } from "../run/BranchTree";
import { Ladder } from "../run/Ladder";
import { OutlineTree } from "../run/OutlineTree";

function Readout({ label, value, tone }: { label: string; value: string; tone?: "signal" }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className={`num mt-0.5 truncate text-[20px] leading-tight tracking-[-0.02em] ${tone ? "text-signal-ink" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function Body({ c }: { c: RunController }) {
  const snap = useSnapshot(c)!;
  const s = snap.state;
  const wide = useMediaQuery("(min-width: 900px)");
  const best = s.best ? s.nodes[s.best] : null;
  const wall = useTicking(best?.score ? wallOf(best.score) : null);
  const cost = useTicking(s.usage.total.costUsd);
  const active = useTicking(s.sandboxes.active, 250);
  const n = counts(s);
  const focus = useMemo(() => {
    for (let i = s.markers.length - 1; i >= 0; i--) {
      const m = s.markers[i];
      if (m.nodeId && (m.kind === "best" || (m.kind === "fail" && m.label.includes("counterexample")))) return m.nodeId;
    }
    return null;
  }, [s.markers]);
  const node = focus ? s.nodes[focus] : null;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="graticule relative h-[300px] overflow-hidden border-b border-line sm:h-[420px] lg:h-[460px] lg:border-b-0 lg:border-r">
        <div className="absolute inset-0 overflow-hidden p-3">
          {wide ? <BranchTree state={s} selected={focus} compact /> : <OutlineTree state={s} selected={focus} onSelect={() => {}} />}
        </div>
      </div>
      <div className="flex flex-col">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line p-4">
          <Readout label="Best wall-clock" value={wall === null ? "—" : times(wall)} tone="signal" />
          <Readout label="Area Δ" value={best?.score ? pct(best.score.area_delta_pct) : "—"} />
          <Readout label="Sandboxes active" value={int(active ?? 0)} />
          <Readout label="Nemotron spend" value={usd(cost ?? 0, 3)} />
        </div>
        <div className="flex-1 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="num truncate text-[13px] text-ink">{node ? `${node.id} · ${node.proposal?.mnemonic}` : "baseline · profiling"}</p>
            <p className="num shrink-0 text-[12px] text-ink-3">
              {n.candidates} CPUs · {clock(snap.t)}
            </p>
          </div>
          {node ? (
            <div className="mt-1">
              <Ladder node={node} dense />
            </div>
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-ink-3">Building the baseline core and profiling the workload…</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The landing hero: the demo run replaying at 16×, looping. A real interface fragment, not a picture of one. */
export function HeroInstrument() {
  const src = useRunSource("r_w1_final", { autoplay: true, speed: 16, loop: true });
  return (
    <figure data-ui className="overflow-hidden rounded-xl border border-line bg-panel shadow-[var(--shadow-float)]">
      <div className="flex h-11 items-center gap-3 border-b border-line px-4">
        <span className="h-2 w-2 shrink-0 rounded-full bg-signal anim-breathe" aria-hidden="true" />
        <span className="num truncate text-[12.5px] text-ink-2">runs/r_w1_final · TinyMaix int8 FC · 16× replay</span>
        <span className="ml-auto hidden h-6 items-center rounded-full bg-signal-dim px-2.5 text-[12px] font-medium text-signal-ink sm:inline-flex" title="Recorded from a real engine run; nothing here is simulated">
          Real run · replay
        </span>
        <Link href="/runs/r_w1_final" className="shrink-0 text-[12.5px] text-signal-ink hover:underline">
          Open the run
        </Link>
      </div>
      {src.status === "ready" ? <Body c={src.controller} /> : <div className="graticule h-[300px] sm:h-[460px]" role="status" aria-label="Loading the demo run" />}
      <figcaption className="sr-only">A recorded search over candidate CPUs for TinyMaix&apos;s int8 dot product, replayed at 16× speed. Real engine run.</figcaption>
    </figure>
  );
}
