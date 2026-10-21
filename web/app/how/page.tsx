import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

export const metadata: Metadata = { title: "How it works" };

const ROLES = [
  ["Nemotron 3 Ultra", "Architect", "Reads the profile and the hot disassembly, proposes distinct custom instructions with the cycle arithmetic, and diagnoses stubborn failures."],
  ["Nemotron 3 Super", "Implementer", "Writes the Verilog unit, a C reference, the intrinsic and the rewritten kernel; repairs from compiler logs, failing vectors and formal counterexamples; writes the independent spec; polishes area and software."],
  ["Nemotron 3 Nano", "Triage", "Summarises build and verification failures for the dashboard. Cheap and fast."],
];

const FLOW = [
  ["Baseline", "PicoRV32 (RV32IM, fast multiplier) runs the workload in Verilator. A PC histogram and disassembly show where the cycles go."],
  ["Propose", "Ultra proposes k instructions. Each takes two source registers and returns one value: that is the slot the core offers."],
  ["Develop", "Each candidate becomes a node. Super implements it; the ladder runs cheap checks first. A failure goes back to Super with the exact error, up to two repairs."],
  ["Score", "Survivors are measured in cycles and LUT-equivalents. Candidates that do not beat their parent by 1% or exceed the area budget are pruned, with the reason kept."],
  ["Polish", "The best nodes are improved by the agent itself: first the same function in less hardware (re-proven), then faster software on the same hardware (bit-identical)."],
  ["Time", "The final nodes go through place-and-route for a Tang Nano 9K, three seeds each, and wall-clock speedup is cycles times the Fmax ratio."],
];

const LADDER = [
  ["Builds", "L1", "Verilator -Wall lint and the GCC build, plus a check that the rewritten kernel only calls the generated ss_* intrinsics."],
  ["Matches C reference (1,000,000 vectors)", "L2", "The RTL against the C reference on edge cases and random vectors, and the rewritten kernel against the original on 5,000 random calls."],
  ["Formally proven equivalent to spec", "L3", "A Yosys SAT miter between the RTL and an independently written spec, for all 2^64 inputs. The spec is itself validated against the C reference first."],
  ["Bit-identical output", "L4", "The whole workload on the full SoC prints the same hash as the baseline."],
  ["Area · Fmax", "L5", "Yosys synth_gowin area, and nextpnr-himbaechel Fmax for a Tang Nano 9K, median of three seeds."],
  ["Verified on silicon (FPGA)", "L6", "Shown only when a bitstream actually ran on a board. Not yet: it reads as skipped."],
];

export default function How() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1000px] px-4 pb-8 pt-16 sm:px-6 lg:px-8">
        <h1 className="text-[clamp(36px,5.5vw,64px)] font-semibold leading-[1] tracking-[-0.04em] text-ink">How it works</h1>
        <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-ink-2">
          SiliconSmith is a search over processor designs. Every node in the tree is a CPU: the parent&apos;s instructions plus one new one, and the software
          rewritten to use it. The agent is NVIDIA Nemotron, called through Nebius Token Factory. Nothing else generates designs.
        </p>

        <h2 className="mt-16 text-[26px] font-semibold tracking-[-0.02em] text-ink">The search</h2>
        <ol className="mt-6 divide-y divide-line rounded-xl border border-line">
          {FLOW.map(([t, b], i) => (
            <li key={t} className="grid gap-x-6 gap-y-1 px-5 py-4 sm:grid-cols-[140px_1fr]">
              <span className="num text-[14px] text-ink">
                <span className="text-signal-ink">{String(i + 1).padStart(2, "0")}</span> {t}
              </span>
              <span className="text-[15px] leading-relaxed text-ink-2">{b}</span>
            </li>
          ))}
        </ol>

        <h2 className="mt-16 text-[26px] font-semibold tracking-[-0.02em] text-ink">Three Nemotron models, three jobs</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {ROLES.map(([m, r, b]) => (
            <article key={m} className="rounded-xl border border-line p-5">
              <p className="num text-[12.5px] text-signal-ink">{r}</p>
              <h3 className="mt-1 text-[17px] font-semibold text-ink">{m}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{b}</p>
            </article>
          ))}
        </div>
        <p className="mt-4 text-[14px] leading-relaxed text-ink-3">
          Every call is an <code className="num">llm.call</code> event with its model, role, tokens, cost and latency, so the cost panel in the run console is the real
          Token Factory bill for that run.
        </p>

        <h2 className="mt-16 text-[26px] font-semibold tracking-[-0.02em] text-ink">Honest labels</h2>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">
          A rung is lit only after its check has passed. The words on screen are the words the check earns, no more.
        </p>
        <div className="mt-6 overflow-hidden rounded-xl border border-line">
          {LADDER.map(([label, rung, what], i) => (
            <div key={rung} className={`grid gap-x-5 gap-y-1 px-5 py-4 sm:grid-cols-[44px_260px_1fr] ${i ? "border-t border-line" : ""}`}>
              <span className="num text-[13px] text-ink-3">{rung}</span>
              <span className="text-[15px] text-ink">{label}</span>
              <span className="text-[14px] leading-relaxed text-ink-2">{what}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-[66ch] text-[14px] leading-relaxed text-ink-3">
          A software-only polish step leaves the hardware untouched, so its formal proof is inherited from its parent; the console says so instead of re-claiming it.
        </p>

        <h2 className="mt-16 text-[26px] font-semibold tracking-[-0.02em] text-ink">Where it runs, and what is not claimed</h2>
        <ul className="mt-4 max-w-[70ch] list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink-2">
          <li>
            The headline W1 run was verified in Token Factory Sandboxes: each candidate runs from its parent&apos;s checkpoint image, and its result image is the checkpoint
            its children branch from. The other runs on this site used the local backend (isolated working directories on one machine); each run page says which. Fmax
            place-and-route runs on the orchestrating machine in both cases.
          </li>
          <li>Instructions are R-type with two source registers and no accumulate, because PicoRV32&apos;s co-processor port provides no third operand.</li>
          <li>
            Software calls instructions through inline assembly (<code className="num">.insn</code>); there is no compiler backend.
          </li>
          <li>Fmax is a place-and-route estimate with about ±8% seed noise. Nothing has run on a physical board yet.</li>
        </ul>

        <div className="mt-14 flex flex-wrap gap-3">
          <Link href="/runs/r_w1_contree3" className="inline-flex h-11 items-center rounded-md bg-signal px-5 text-[15px] font-medium text-on-signal">
            Watch the W1 run
          </Link>
          <Link href="/runs/r_w1_contree3/report" className="inline-flex h-11 items-center rounded-md border border-line-2 px-5 text-[15px] text-ink hover:bg-raised">
            Read its report
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
