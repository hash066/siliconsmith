"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ENGINE_URL } from "@/lib/controller";

const PRESETS = [
  { id: "w1", title: "TinyMaix int8 fully-connected layer", source: "sipeed/TinyMaix · tm_dot_prod", replay: "r_w1_final" },
  { id: "w2", title: "Monocypher ChaCha20", source: "LoupVaillant/Monocypher · rotl32 in the rounds", replay: "r_w2_final3" },
];

type State = { kind: "idle" } | { kind: "starting" } | { kind: "error"; message: string };

export function TryForm() {
  const router = useRouter();
  const [workload, setWorkload] = useState("w1");
  const [areaBudget, setAreaBudget] = useState(5);
  const [state, setState] = useState<State>({ kind: "idle" });
  const preset = PRESETS.find((p) => p.id === workload)!;

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "starting" });
    try {
      const res = await fetch(`${ENGINE_URL}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workload, area_budget: areaBudget, k: 4, k_child: 3, beam: 2, depth: 2 }),
      });
      const body = (await res.json()) as { run_id?: string; detail?: string };
      if (!res.ok || !body.run_id) throw new Error(body.detail ?? `engine answered ${res.status}`);
      router.push(`/runs/${body.run_id}`);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "could not reach the engine" });
    }
  }

  return (
    <form onSubmit={start} className="mt-10">
      <fieldset>
        <legend className="text-[13px] text-ink-3">Kernel</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <label
              key={p.id}
              className={`cursor-pointer rounded-xl border p-5 transition-colors duration-150 ${workload === p.id ? "border-signal-line bg-signal-dim" : "border-line hover:bg-raised"}`}
            >
              <input type="radio" name="workload" value={p.id} checked={workload === p.id} onChange={() => setWorkload(p.id)} className="sr-only" />
              <span className="block text-[16px] font-semibold text-ink">{p.title}</span>
              <span className="num mt-1 block text-[12.5px] text-ink-3">{p.source}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-8">
        <label htmlFor="area" className="text-[13px] text-ink-3">
          Area budget: <span className="num text-ink">+{areaBudget}% LUT-equivalents</span>
        </label>
        <input
          id="area"
          type="range"
          min={1}
          max={10}
          step={1}
          value={areaBudget}
          onChange={(e) => setAreaBudget(Number(e.target.value))}
          className="mt-3 block w-full max-w-sm accent-[var(--signal)]"
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {ENGINE_URL ? (
          <button
            type="submit"
            disabled={state.kind === "starting"}
            className="inline-flex h-12 items-center rounded-md bg-signal px-6 text-[15px] font-medium text-on-signal transition-transform duration-150 active:scale-[0.97] disabled:opacity-60"
          >
            {state.kind === "starting" ? "Starting…" : "Start a live run"}
          </button>
        ) : (
          <button type="button" disabled className="inline-flex h-12 cursor-not-allowed items-center rounded-md border border-line-2 px-6 text-[15px] text-ink-3">
            Live runs are off in this build
          </button>
        )}
        <Link href={`/runs/${preset.replay}`} className="inline-flex h-12 items-center rounded-md border border-line-2 px-6 text-[15px] text-ink hover:bg-raised">
          Watch the recorded run instead
        </Link>
      </div>

      <p className="mt-4 max-w-[62ch] text-[13px] leading-relaxed text-ink-3" role="status">
        {state.kind === "error"
          ? state.message
          : ENGINE_URL
            ? "A run takes about 10 to 25 minutes and spends real Nemotron credits, so live runs are limited per visitor and per day. When the limit is hit, the recorded run is the way to see it."
            : "This deployment is not connected to an engine, so it cannot start runs. The recorded runs are real engine runs replayed from their event logs."}
      </p>
    </form>
  );
}
