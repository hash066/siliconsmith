import "@/components/marketing/marketing.css";
import { Bench } from "@/components/marketing/bench";
import { Compare } from "@/components/marketing/Compare";
import { Cta, Footer } from "@/components/marketing/CtaFooter";
import { Demo } from "@/components/marketing/Demo";
import { Features } from "@/components/marketing/Features";
import { Hero } from "@/components/marketing/Hero";
import { How } from "@/components/marketing/How";
import { Nav, Rail } from "@/components/marketing/Nav";
import { Pipeline } from "@/components/marketing/Pipeline";
import { RealStrip } from "@/components/marketing/RealStrip";
import { Problem } from "@/components/marketing/Problem";
import { Runtime } from "@/components/marketing/runtime";
import { Solution } from "@/components/marketing/Solution";
import { Stack } from "@/components/marketing/Stack";
import { getFacts } from "@/lib/facts";

export default function Landing() {
  const f = getFacts();
  const entry = f.library.entries.find((e) => e.rtl) ?? null;
  const rtl = entry?.rtl ?? "";
  const rtlName = `${rtl.match(/module\s+(\w+)/)?.[1] ?? entry?.id ?? "rtl"}.v`;
  const boardSession = f.recorded.agent.find((a) => a.id === "board-fault")!;
  const best = f.silicon.best;
  // Client components get a copy without the long recorded texts and RTL, so the page payload stays small.
  const lite = { ...f, recorded: { ...f.recorded, agent: [], chat: { ...f.recorded.chat, answer: "" } }, library: { entries: f.library.entries.map((e) => ({ ...e, rtl: null })) } };

  return (
    <Runtime>
      <Nav />
      <Rail />
      <main id="main">
        <Hero
          rtlName={rtlName}
          rtl={rtl}
          ladder={{ passed: entry?.rungsPassed ?? 0, total: entry?.rungsTotal ?? 0, skipped: entry?.rungsSkipped ?? [] }}
          board={f.recorded.boardFault}
          matter={{ peakC: f.matter.bestPeakC, baselineC: f.matter.baselineC }}
          stats={[
            { value: best.wallSpeedup ?? best.speedup, decimals: 2, suffix: "×", label: `best Silicon speedup, run ${best.id}` },
            { value: f.silicon.rejected, decimals: 0, suffix: ` / ${f.silicon.candidates}`, label: "candidate CPUs rejected by the ladder" },
            { value: f.board.faultsDetected, decimals: 0, suffix: ` / ${f.board.faultsCatalogued}`, label: "catalogued board faults detected" },
          ]}
        />
        <Problem facts={f} />
        <Solution session={boardSession} chat={f.recorded.chat} fault={f.recorded.boardFault} />
        <Demo sessions={f.recorded.agent} />
        <Compare session={boardSession} chat={f.recorded.chat} fault={f.recorded.boardFault} />
        <RealStrip entryId={entry?.id ?? ""} />
        <Features facts={lite} />
        <Pipeline facts={lite} />
        <Bench />
        <How facts={f} />
        <Stack />
        <Cta />
      </main>
      <Footer />
    </Runtime>
  );
}
