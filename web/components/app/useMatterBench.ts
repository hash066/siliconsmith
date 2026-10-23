"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { UiActionResult } from "@/lib/agent-actions";
import { defaultSimulateInput, MATTER_GENERATORS, MATTER_SPREADER, matterApi, validateLocally, type ApiFailure, type MatterBaseline, type MatterGenerator, type MatterSimulation, type SimulateInput } from "@/lib/hosted";

export type MatterParams = { generator?: string; gen_params?: Record<string, number>; spreader?: Record<string, number> };

/** Merge requested parameters into the current input. Unknown generator or keys are refused with a reason; the caller validates ranges. */
export function mergeMatterParams(cur: SimulateInput, p: MatterParams): { ok: true; input: SimulateInput } | { ok: false; reason: string } {
  let generator = cur.generator;
  let gen_params = cur.gen_params;
  if (p.generator !== undefined) {
    if (!(p.generator in MATTER_GENERATORS)) return { ok: false, reason: `Unknown generator "${p.generator}". Known: ${Object.keys(MATTER_GENERATORS).join(", ")}.` };
    if (p.generator !== cur.generator) {
      generator = p.generator as MatterGenerator;
      gen_params = defaultSimulateInput(generator).gen_params;
    }
  }
  const genKeys = MATTER_GENERATORS[generator].params.map((x) => x.key as string);
  const spKeys = MATTER_SPREADER.map((x) => x.key as string);
  const badGen = Object.keys(p.gen_params ?? {}).filter((k) => !genKeys.includes(k));
  const badSp = Object.keys(p.spreader ?? {}).filter((k) => !spKeys.includes(k));
  if (badGen.length) return { ok: false, reason: `Unknown ${generator} parameter(s): ${badGen.join(", ")}. Known: ${genKeys.join(", ")}.` };
  if (badSp.length) return { ok: false, reason: `Unknown problem parameter(s): ${badSp.join(", ")}. Known: ${spKeys.join(", ")}.` };
  const input: SimulateInput = { ...cur, generator, gen_params: { ...gen_params, ...(p.gen_params ?? {}) }, spreader: { ...cur.spreader, ...(p.spreader ?? {}) } };
  return { ok: true, input };
}

const f1 = (n: number, d = 1) => n.toFixed(d);
const same = (a: SimulateInput, b: SimulateInput) => JSON.stringify([a.generator, a.gen_params, a.spreader, !!a.include_stl]) === JSON.stringify([b.generator, b.gen_params, b.spreader, !!b.include_stl]);

/** What a solved simulation carries. A geometry rejected before the solve (M2) comes back with empty metrics, no field and no baselines. */
export interface Solved {
  peak: number;
  rise: number | null;
  fraction: number | null;
  balance: number | null;
  fieldPeak: number;
  equal: MatterBaseline;
  full: MatterBaseline;
}
export function solvedOf(sim: MatterSimulation): Solved | null {
  const m = sim.metrics;
  const field = sim.viewer.field;
  const { equal_material: equal, full_budget: full } = sim.baselines;
  if (typeof m.peak_temp_c !== "number" || !field || !equal || !full) return null;
  return { peak: m.peak_temp_c, rise: m.peak_rise_k ?? null, fraction: m.material_fraction ?? null, balance: m.heat_balance_rel ?? null, fieldPeak: field.peak, equal, full };
}
export const wasSolved = (sim: MatterSimulation): boolean => solvedOf(sim) !== null;

export function summarizeSim(sim: MatterSimulation): string {
  const solved = solvedOf(sim);
  const pass = sim.ladder.filter((r) => r.status === "pass").length;
  if (!solved) return `Nothing was solved: ${sim.first_failure ?? "a rung"} rejected the geometry (${pass} of ${sim.ladder.length} rungs pass).`;
  const v = sim.verdict;
  const base = v ? ` ${v.label}; ${f1(Math.abs(v.delta_equal_material_k), 2)} K ${v.delta_equal_material_k >= 0 ? "cooler" : "hotter"} than the equal-material baseline.` : ` No verdict (${sim.first_failure ?? "a rung"} did not pass).`;
  return `Peak ${f1(solved.peak)} °C, ${pass} of ${sim.ladder.length} rungs pass.${base}`;
}

export function useMatterBench() {
  const [input, setInputState] = useState<SimulateInput>(() => ({ ...defaultSimulateInput("rect_fins"), include_stl: true }));
  const inputRef = useRef(input);
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState<{ data: MatterSimulation; input: SimulateInput } | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [local, setLocal] = useState<Array<{ path: string; message: string }>>([]);

  const setInput = useCallback((f: (i: SimulateInput) => SimulateInput) => {
    const next = f(inputRef.current);
    inputRef.current = next;
    setInputState(next);
    setLocal([]);
  }, []);

  const simulate = useCallback(async (): Promise<UiActionResult> => {
    const cur = inputRef.current;
    const errs = validateLocally(cur);
    setLocal(errs);
    if (errs.length) return { ok: false, summary: `Not simulated: ${errs.map((e) => `${e.path} ${e.message}`).join("; ")}.` };
    setBusy(true);
    setFailure(null);
    const r = await matterApi.simulate(cur);
    setBusy(false);
    if (!r.ok) {
      setFailure(r);
      return { ok: false, summary: `Simulation failed: ${r.message}` };
    }
    setSim({ data: r.data, input: cur });
    return { ok: true, summary: summarizeSim(r.data), evidence_ids: r.data.ladder.map((l) => l.id) };
  }, []);

  const setParams = useCallback(
    (p: MatterParams): UiActionResult => {
      const m = mergeMatterParams(inputRef.current, p);
      if (!m.ok) return { ok: false, summary: m.reason };
      const errs = validateLocally(m.input);
      if (errs.length) return { ok: false, summary: `Not applied: ${errs.map((e) => `${e.path} ${e.message}`).join("; ")}.` };
      setInput(() => m.input);
      setFailure(null);
      return { ok: true, summary: `Set ${m.input.generator} with ${Object.entries(m.input.gen_params).map(([k, v]) => `${k}=${v}`).join(", ")}; problem ${Object.entries(m.input.spreader).map(([k, v]) => `${k}=${v}`).join(", ")}. Not simulated yet.` };
    },
    [setInput],
  );

  const stale = !!sim && !same(sim.input, input);
  const errors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of local) m[e.path] = e.message;
    if (failure?.kind === "field") for (const e of failure.fields) m[e.path] = e.message;
    return m;
  }, [local, failure]);
  const valid = useMemo(() => validateLocally(input).length === 0, [input]);

  return { input, setInput, busy, sim: sim?.data ?? null, stale, failure, errors, valid, simulate, setParams };
}

export type MatterBench = ReturnType<typeof useMatterBench>;
