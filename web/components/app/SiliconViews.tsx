"use client";

import { useMemo, useState } from "react";
import { hex32, layerNetlist, matches, type InstructionViews } from "@/lib/silicon-views";

const NW = 132;
const NH = 46;
const LG = 74;
const RG = 14;
const PAD = 12;

/** The instruction's circuit as Yosys reads it: boxes for multipliers, adders and so on, wires as wide as the signals they carry. */
export function HardwareView({ views }: { views: InstructionViews }) {
  const g = useMemo(() => layerNetlist(views), [views]);
  const [hot, setHot] = useState<string | null>(null);
  const rows = Math.max(...g.nodes.map((n) => n.row)) + 1;
  const width = PAD * 2 + g.layers * NW + (g.layers - 1) * LG;
  const height = PAD * 2 + rows * NH + (rows - 1) * RG;
  const at = (n: (typeof g.nodes)[number]) => ({ x: PAD + n.layer * (NW + LG), y: PAD + n.row * (NH + RG) });
  const by = new Map(g.nodes.map((n) => [n.id, n]));
  const maxGate = Math.max(1, ...Object.values(views.gates));
  return (
    <section aria-label="The hardware" className="min-w-0 rounded-xl border border-line bg-panel p-3" data-testid="hardware-view">
      <h3 className="hw-label mb-2 !text-[10.5px]">The hardware</h3>
      <div role="region" aria-label="Circuit diagram" tabIndex={0} className="scroll-quiet overflow-x-auto rounded-lg bg-sunken p-1">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-none" role="img" aria-label={`Circuit of ${views.name}: ${g.nodes.filter((n) => n.kind === "cell").map((n) => n.label.split("  ")[1]).join(", ")}.`}>
          {g.edges.map((e) => {
            const a = by.get(e.from)!;
            const b = by.get(e.to)!;
            const pa = at(a);
            const pb = at(b);
            const x1 = pa.x + NW;
            const y1 = pa.y + NH / 2;
            const x2 = pb.x;
            const y2 = pb.y + NH / 2;
            const on = hot === e.from || hot === e.to;
            return <path key={`${e.from}>${e.to}`} d={`M${x1} ${y1} C${x1 + LG * 0.55} ${y1}, ${x2 - LG * 0.55} ${y2}, ${x2} ${y2}`} fill="none" stroke={on ? "var(--hw-steel)" : "var(--line-2)"} strokeWidth={Math.min(5, 0.8 + e.width / 14)} opacity={on ? 0.95 : 0.7}><title>{`${e.width} signal bits`}</title></path>;
          })}
          {g.nodes.map((n) => {
            const p = at(n);
            const io = n.kind !== "cell";
            return (
              <g key={n.id} transform={`translate(${p.x} ${p.y})`} onMouseEnter={() => setHot(n.id)} onMouseLeave={() => setHot(null)} tabIndex={0} onFocus={() => setHot(n.id)} onBlur={() => setHot(null)}>
                <rect width={NW} height={NH} rx={io ? 23 : 8} fill={io ? "var(--raised)" : "var(--panel)"} stroke={hot === n.id ? "var(--hw-steel)" : io ? "var(--line-2)" : "var(--hw-steel)"} strokeWidth={hot === n.id ? 2 : 1.2} />
                <text x={NW / 2} y={19} textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--ink)">
                  {n.label}
                </text>
                <text x={NW / 2} y={34} textAnchor="middle" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-code), monospace">
                  {n.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px] [&>div]:bg-panel [&>div]:px-3 [&>div]:py-2">
        <div>
          <dt className="text-[11.5px] text-ink-3">Simple gates (after mapping)</dt>
          <dd className="num text-[18px] leading-tight text-ink">{views.gate_total.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-[11.5px] text-ink-3">Longest path</dt>
          <dd className="num text-[18px] leading-tight text-ink">{views.depth !== null ? `${views.depth} gates` : "n/a"}</dd>
        </div>
      </dl>
      {Object.keys(views.gates).length > 0 && (
        <ul className="mt-2 grid gap-1" aria-label="Gates by kind">
          {Object.entries(views.gates)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <li key={k} className="flex items-center gap-2 text-[11.5px] text-ink-2">
                <span className="num w-12 shrink-0 text-ink-3">{k}</span>
                <span className="h-2 rounded-full bg-[var(--hw-steel)]" style={{ width: `${Math.max(2, (n / maxGate) * 100)}%`, maxWidth: "calc(100% - 7rem)" }} aria-hidden="true" />
                <span className="num">{n}</span>
              </li>
            ))}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">From Yosys, run inside the Sandbox on the instruction&apos;s Verilog. The boxes are the operators as written; the gate counts are after mapping to AND, OR, XOR and similar. This is the new instruction only, not the whole processor.</p>
    </section>
  );
}

const CW = 104;
const RH = 34;

/** The instruction run on a few operand pairs, next to the C reference. One column per pair. */
export function WaveView({ views }: { views: InstructionViews }) {
  const rows = views.rows;
  const labels = ["rs1", "rs2", "rd (hardware)", "rd (C reference)"] as const;
  const left = 112;
  const width = left + rows.length * CW + 8;
  const height = 4 * RH + RH + 12;
  const ok = rows.every(matches);
  return (
    <section aria-label="Simulated waveform" className="min-w-0 rounded-xl border border-line bg-panel p-3" data-testid="wave-view">
      <h3 className="hw-label mb-2 !text-[10.5px]">What it does on real inputs</h3>
      <div role="region" aria-label="Waveform" tabIndex={0} className="scroll-quiet overflow-x-auto rounded-lg bg-sunken p-1">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-none" role="img" aria-label={`The instruction on ${rows.length} operand pairs. ${ok ? "The hardware and the C reference agree on every pair." : "The hardware and the C reference differ on some pair."}`}>
          {labels.map((name, s) => (
            <g key={name}>
              <text x={left - 10} y={s * RH + RH / 2 + 4} textAnchor="end" fontSize="11" fill="var(--ink-2)">
                {name}
              </text>
              {rows.map((r, i) => {
                const x = left + i * CW;
                const y = s * RH + 5;
                const bad = s === 2 && !matches(r);
                const colour = s === 2 ? (bad ? "var(--hw-bad)" : "var(--hw-ok)") : s === 3 ? "var(--ink-3)" : "var(--hw-steel)";
                const prev = i > 0 ? rows[i - 1][s] : null;
                const same = prev !== null && prev >>> 0 === r[s] >>> 0;
                return (
                  <g key={i}>
                    <path d={`M${x + 6} ${y} H${x + CW - 6} L${x + CW} ${y + (RH - 10) / 2} L${x + CW - 6} ${y + RH - 10} H${x + 6} L${x} ${y + (RH - 10) / 2} Z`} fill="none" stroke={colour} strokeWidth={same ? 0.8 : 1.4} opacity={0.9} />
                    <text x={x + CW / 2} y={y + (RH - 10) / 2 + 4} textAnchor="middle" fontSize="11" fontFamily="var(--font-code), monospace" fill="var(--ink)">
                      {hex32(r[s])}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
          <text x={left - 10} y={4 * RH + RH / 2 + 4} textAnchor="end" fontSize="11" fill="var(--ink-2)">
            agree
          </text>
          {rows.map((r, i) => (
            <text key={i} x={left + i * CW + CW / 2} y={4 * RH + RH / 2 + 5} textAnchor="middle" fontSize="15" fill={matches(r) ? "var(--hw-ok)" : "var(--hw-bad)"}>
              {matches(r) ? "✓" : "✗"}
            </text>
          ))}
        </svg>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">Each column is one pair of operands, simulated in Verilator. The C reference is the plain description the hardware must match. {ok ? "They agree on every pair shown; the formal proof covers every possible pair, not just these." : "They disagree on a pair shown, so this instruction would not have been accepted."}</p>
    </section>
  );
}

function CodeBlock({ title, code, mark, note }: { title: string; code: string; mark?: RegExp; note: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h4 className="text-[12.5px] font-medium text-ink">{title}</h4>
        <span className="num text-[11px] text-ink-3">{note}</span>
      </div>
      <pre tabIndex={0} aria-label={title} className="scroll-quiet num max-h-72 overflow-auto rounded-lg bg-sunken py-2 text-[11.5px] leading-relaxed text-ink">
        {lines.map((l, i) => (
          <div key={i} className={`flex px-2 ${mark?.test(l) ? "bg-[color-mix(in_srgb,var(--hw-steel)_22%,transparent)]" : ""}`}>
            <span className="mr-2 w-6 shrink-0 select-none text-right text-ink-3">{i + 1}</span>
            <span className="whitespace-pre">{l || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

/** The loop before and after: what the agent changed in the code, with the new instruction called out. */
export function BeforeAfter({ before, after, mnemonic }: { before: string; after: string; mnemonic: string }) {
  const call = /\bss_\w+\s*\(/;
  const count = (s: string) => s.replace(/\n$/, "").split("\n").length;
  return (
    <section aria-label="The loop before and after" className="min-w-0 rounded-xl border border-line bg-panel p-3" data-testid="before-after">
      <h3 className="hw-label mb-2 !text-[10.5px]">The loop, before and after</h3>
      <div className="flex min-w-0 flex-col gap-3 @2xl:flex-row">
        <CodeBlock title="Before" code={before} note={`${count(before)} lines`} />
        <CodeBlock title="After" code={after} mark={call} note={`${count(after)} lines, calls ${mnemonic}`} />
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">The highlighted line calls the new instruction. The rewritten kernel must give a bit-identical result: the whole program is run and its output compared.</p>
    </section>
  );
}

/** The proof, in plain words. Static text: it states the rules the engine applies. */
export function ProofExplainer() {
  const steps: Array<[string, string]> = [
    ["It has to build", "The hardware code is compiled and linted. Warnings are shown, errors stop everything."],
    ["It has to match on a million inputs", "The hardware and a plain C description of the instruction are fed a million operand pairs, including every awkward edge value. One difference fails it."],
    ["It has to be proved for every input", "The hardware and an independent description (written without seeing the hardware) are wired to the same inputs. A solver is asked: is there any input where the outputs differ? If the answer is no, that is a proof for all 2^64 pairs, not a sample. If the solver cannot decide, the result says unknown, never pass."],
    ["The whole program has to behave the same", "The rewritten program is run on the processor with the new instruction and its output is compared bit for bit with the original."],
    ["Then it is measured", "Cycles are counted on the simulated core and the chip area is measured by synthesis. Clock speed needs place and route, which a live run skips, so it is not claimed."],
  ];
  return (
    <section aria-label="How the proof works" className="rounded-xl border border-line bg-panel p-3" data-testid="proof-explainer">
      <h3 className="hw-label mb-2 !text-[10.5px]">How the proof works</h3>
      <ol className="flex flex-col gap-2">
        {steps.map(([h, t], i) => (
          <li key={h} className="flex gap-2.5">
            <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-2 text-[11px] text-ink-2">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-ink">{h}</span>
              <span className="block text-[12px] leading-snug text-ink-2">{t}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
