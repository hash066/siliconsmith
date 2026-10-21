import Link from "next/link";
import { HeroInstrument } from "@/components/landing/HeroInstrument";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { int, pct, times, usd } from "@/lib/format";
import { summarize, type RunSummary } from "@/lib/results";

const STEPS = [
  {
    n: "01",
    title: "Profile",
    body: "It runs your C on a RISC-V core in simulation and counts where the cycles go, down to the disassembly of the hot loop.",
  },
  {
    n: "02",
    title: "Invent and build",
    body: "Nemotron Ultra proposes custom instructions. Nemotron Super writes the Verilog, a C reference, an intrinsic and the rewritten kernel. Each candidate CPU is checked in its own isolated workspace.",
  },
  {
    n: "03",
    title: "Prove and measure",
    body: "Lint, a million random vectors, a formal equivalence proof against an independent spec, a bit-identical run of the whole program, then area and Fmax. Only survivors become a pull request.",
  },
];

const RUNGS = [
  ["L1", "Builds", "Verilator lint and GCC"],
  ["L2", "Matches the C reference", "edge cases plus 1,000,000 random vectors"],
  ["L3", "Formally proven equivalent to spec", "Yosys SAT miter over all 2^64 inputs"],
  ["L4", "Bit-identical output", "the whole workload on the full SoC"],
  ["L5", "Area and Fmax", "Yosys synth_gowin and nextpnr place-and-route"],
  ["L6", "Verified on silicon (FPGA)", "not yet run: shown as skipped, never claimed"],
];

function Result({ r, label, note }: { r: RunSummary; label: string; note: string }) {
  return (
    <article className="flex flex-col rounded-xl border border-line bg-panel p-6">
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className="num mt-3 text-[clamp(44px,6vw,72px)] font-semibold leading-none tracking-[-0.04em] text-ink">
        {times(r.wallSpeedup ?? r.speedup)}
      </p>
      <p className="mt-2 text-[14px] text-ink-2">
        wall-clock · {times(r.speedup)} fewer cycles · {pct(r.areaPct, 1)} area
      </p>
      <dl className="num mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-[13px]">
        <dt className="text-ink-3">Cycles</dt>
        <dd className="text-right text-ink">
          {int(r.baselineCycles)} → {int(r.cycles)}
        </dd>
        <dt className="text-ink-3">Instructions</dt>
        <dd className="text-right text-ink">{r.mnemonics.join(" + ")}</dd>
        <dt className="text-ink-3">Fmax</dt>
        <dd className="text-right text-ink">
          {r.baseFmaxMhz?.toFixed(1)} → {r.fmaxMhz?.toFixed(1)} MHz
        </dd>
        <dt className="text-ink-3">Search</dt>
        <dd className="text-right text-ink">
          {r.nodes} CPUs · {usd(r.costUsd, 2)} · {Math.round(r.wallSeconds / 60)} min
        </dd>
      </dl>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{note}</p>
      <Link href={`/runs/${r.id}`} className="mt-5 inline-flex h-10 items-center self-start rounded-md border border-line-2 px-4 text-[14px] text-ink transition-colors duration-150 hover:bg-raised">
        Replay this run
      </Link>
    </article>
  );
}

export default function Home() {
  const w1 = summarize("r_w1_final");
  const w2 = summarize("r_w2_final3");
  const w1weak = summarize("r_w1_v3");
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="mx-auto max-w-[1280px] px-4 pb-16 pt-16 sm:px-6 sm:pt-24 lg:px-8">
          <p className="num text-[13px] text-signal-ink">Nebius × NVIDIA Global AI Hackathon · Coding &amp; Agentic Engineering</p>
          <h1 className="mt-5 max-w-[16ch] text-[clamp(40px,7.2vw,96px)] font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
            It changes the chip to fit the code.
          </h1>
          <p className="mt-6 max-w-[62ch] text-[clamp(17px,1.6vw,20px)] leading-relaxed text-ink-2">
            Point it at a hot C loop. A Nemotron agent invents a custom RISC-V instruction, writes the Verilog and the software that uses it,
            proves the hardware correct, and measures the speedup and what it costs in area. The output is a pull request that changes your hardware.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/runs/r_w1_final" className="inline-flex h-12 items-center rounded-md bg-signal px-6 text-[15px] font-medium text-on-signal transition-transform duration-150 active:scale-[0.97]">
              Watch a real run
            </Link>
            <Link href="/try" className="inline-flex h-12 items-center rounded-md border border-line-2 px-6 text-[15px] text-ink transition-colors duration-150 hover:bg-raised">
              Try it on your code
            </Link>
          </div>
          <div className="mt-14">
            <HeroInstrument />
          </div>
        </section>

        <section aria-labelledby="results" className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="results" className="max-w-[24ch] text-[clamp(28px,4vw,48px)] font-semibold leading-tight tracking-[-0.03em] text-ink">
            Two real kernels, searched end to end.
          </h2>
          <p className="mt-4 max-w-[64ch] text-[16px] leading-relaxed text-ink-2">
            Wall-clock speedup is cycles multiplied by the clock ratio from a Tang Nano 9K place-and-route (median of {w1.seeds} nextpnr seeds; the seed
            noise is about ±8%). Area is LUT-equivalents on PicoRV32 with a fast multiplier. Nothing here is estimated by the model.
          </p>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <Result
              r={w1}
              label="TinyMaix int8 fully-connected layer (W1)"
              note="The hand-built reference instruction reaches 3.77× cycles at +3.16% area. The agent invented the same idea itself, then shrank its hardware and rewrote the loop around it."
            />
            <Result
              r={w2}
              label="Monocypher ChaCha20 (W2)"
              note="Smaller win: ChaCha20 needs four different rotate amounts and every instruction has only two operands, so the area budget runs out after two fused XOR-rotates."
            />
          </div>
          <p className="mt-5 text-[13px] text-ink-3">
            Runs differ because the model does: of two W1 runs with Fmax measured on the final prompts, this one reached {times(w1.wallSpeedup)} and{" "}
            <Link href={`/runs/${w1weak.id}`} className="text-signal-ink hover:underline">
              the other
            </Link>{" "}
            {times(w1weak.wallSpeedup)}. The page shows the better run, not an average.
          </p>
        </section>

        <section aria-labelledby="how" className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="how" className="text-[clamp(28px,4vw,48px)] font-semibold leading-tight tracking-[-0.03em] text-ink">
            Three steps, every one checked.
          </h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl border border-line p-6">
                <span className="num text-[13px] text-signal-ink">{s.n}</span>
                <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.01em] text-ink">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="ladder" className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="ladder" className="max-w-[26ch] text-[clamp(28px,4vw,48px)] font-semibold leading-tight tracking-[-0.03em] text-ink">
            A label appears only after its check passes.
          </h2>
          <div className="mt-10 overflow-hidden rounded-xl border border-line">
            {RUNGS.map(([rung, label, how], i) => (
              <div key={rung} className={`grid grid-cols-[48px_1fr] gap-x-4 px-5 py-4 sm:grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)] ${i ? "border-t border-line" : ""}`}>
                <span className="num text-[13px] text-ink-3">{rung}</span>
                <span className="text-[15px] text-ink">{label}</span>
                <span className="col-start-2 text-[14px] text-ink-3 sm:col-start-auto">{how}</span>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="related" className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="related" className="max-w-[24ch] text-[clamp(28px,4vw,48px)] font-semibold leading-tight tracking-[-0.03em] text-ink">
            The architect&apos;s decision is the part we automate.
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <article className="rounded-xl border border-line p-6">
              <h3 className="text-[16px] font-semibold text-ink">Commercial flows</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                Andes ACE/COPILOT and Cadence Tensilica generate the processor and toolchain after a human architect has decided what the instruction is.
              </p>
            </article>
            <article className="rounded-xl border border-line p-6">
              <h3 className="text-[16px] font-semibold text-ink">Research agents</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                CHIA and LACE use LLMs to implement an instruction extension that is described to them. CIDRE automates instruction selection without an LLM.
              </p>
            </article>
            <article className="rounded-xl border border-signal-line bg-signal-dim p-6">
              <h3 className="text-[16px] font-semibold text-ink">SiliconSmith</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                Chooses the instruction from a profile, writes the hardware and the software, proves the hardware against an independent spec, accounts for area and
                clock, and searches many CPUs in parallel, each verified in isolation.
              </p>
            </article>
          </div>
          <p className="mt-5 max-w-[70ch] text-[13px] leading-relaxed text-ink-3">
            Limits, stated plainly: instructions get two source registers (PicoRV32&apos;s co-processor port), there is no compiler backend (software uses inline
            assembly), and results are simulation plus FPGA place-and-route, not silicon.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
