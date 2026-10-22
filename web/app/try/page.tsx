import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { TryForm } from "@/components/landing/TryForm";

export const metadata: Metadata = { title: "Try it" };

const PATHS = [
  {
    href: "/workstation?wb=board",
    kicker: "Board · free, instant",
    title: "Check a board",
    body: "Pick a real template or paste your own design. Rungs B1 to B5 run as deterministic code and report pass, fail or unknown, each with the part facts it used. Try the two templates with a fault in them.",
  },
  {
    href: "/workstation?wb=matter",
    kicker: "Matter · free, about a second",
    title: "Simulate a heat spreader",
    body: "Choose a fin pattern and a power and material budget. A validated solver and an independent second solver return the plate coloured by temperature, both baselines, and an honest verdict, small margins included.",
  },
  {
    href: "/workstation/library",
    kicker: "Library · evidence bundles",
    title: "Reproduce a library entry",
    body: "Open a proven instruction, see what its evidence claims and what it does not, the tool versions and artifact hashes, and the exact command that re-verifies it offline. The page shows the command; it does not run it.",
  },
  {
    href: "/workstation",
    kicker: "Silicon · recorded runs",
    title: "Watch a recorded run",
    body: "Replay a real agent search on Nebius Token Factory: candidates proposed, proved or pruned. Click the ev tag on any number to see the tool, run, node and command behind it.",
  },
];

export default function Try() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[900px] px-4 pb-8 pt-16 sm:px-6 lg:px-8">
        <h1 className="text-[clamp(36px,5.5vw,64px)] font-semibold leading-[1] tracking-[-0.04em] text-ink">Try it</h1>
        <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-ink-2">
          Four ways in, all on real engines, and none needs an account. Board and Matter run live on this site with no model call and no cost; the library shows stored evidence; the recorded runs replay real agent searches.
        </p>
        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PATHS.map((p) => (
            <li key={p.href} className="min-w-0">
              <Link href={p.href} className="flex h-full min-w-0 flex-col rounded-lg border border-line bg-panel p-5 transition-colors duration-150 hover:bg-raised">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">{p.kicker}</span>
                <span className="mt-2 text-[20px] font-semibold tracking-[-0.01em] text-ink">{p.title}</span>
                <span className="mt-2 text-[14px] leading-snug text-ink-2">{p.body}</span>
                <span className="mt-4 text-[13px] text-signal-ink">Open →</span>
              </Link>
            </li>
          ))}
        </ul>

        <section aria-labelledby="live" className="mt-16 border-t border-line pt-10">
          <h2 id="live" className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
            Start a live agent run
          </h2>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">
            This starts the full search with Nemotron on Nebius Token Factory and needs a connected engine, which this deployment may not have. Arbitrary C is not accepted: a new kernel needs a test harness, and the engine never runs code it has not been given one for.
          </p>
          <TryForm />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
