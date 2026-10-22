import Link from "next/link";
import { ThemeToggle, Wordmark } from "./Brand";

const NAV = [
  { href: "/workstation", label: "Workstation" },
  { href: "/how", label: "How it works" },
  { href: "/runs/r_w1_contree3/report", label: "Report" },
  { href: "/try", label: "Try your code" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-[14px] text-ink-2 transition-colors duration-150 hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link href="/workstation" className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-[14px] font-medium text-bg transition-transform duration-150 active:scale-[0.97]">
            <span className="sm:hidden">Workstation</span>
            <span className="hidden sm:inline">Open the workstation</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-line">
      <div className="mx-auto max-w-[1280px] px-4 pb-10 pt-14 sm:px-6 lg:px-8">
        <p className="text-[clamp(56px,13vw,200px)] font-semibold leading-[0.85] tracking-[-0.05em] text-ink">SiliconSmith</p>
        <div className="mt-10 grid gap-8 text-[14px] sm:grid-cols-3">
          <div>
            <p className="text-ink">Change the chip, not just the code.</p>
            <p className="mt-2 leading-relaxed text-ink-3">
              Built for the Nebius × NVIDIA Global AI Hackathon. The agent runs on NVIDIA Nemotron through Nebius Token Factory. Each candidate CPU is verified in its own isolated workspace.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2">
            <Link href="/workstation" className="text-ink-2 hover:text-ink">
              Workstation
            </Link>
            <Link href="/runs/r_w1_contree3" className="text-ink-2 hover:text-ink">
              W1 run: TinyMaix
            </Link>
            <Link href="/runs/r_w2_final3" className="text-ink-2 hover:text-ink">
              W2 run: ChaCha20
            </Link>
            <Link href="/how" className="text-ink-2 hover:text-ink">
              How it works
            </Link>
            <Link href="/try" className="text-ink-2 hover:text-ink">
              Try your code
            </Link>
          </nav>
          <p className="leading-relaxed text-ink-3">
            Apache-2.0. Workload: TinyMaix by Sipeed (Apache-2.0). Core: PicoRV32 by Claire Wolf (ISC). Every run shown here is a real engine run, replayed from its event log.
          </p>
        </div>
      </div>
    </footer>
  );
}
