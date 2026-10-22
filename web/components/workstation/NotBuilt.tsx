export type Workbench = "silicon" | "board" | "matter";

const COPY: Record<Exclude<Workbench, "silicon">, { name: string; scope: string; limits: string }> = {
  board: {
    name: "Board",
    scope: "Netlist-level co-design check: schematic, parts and the firmware pin map are designed together, then checked against each other.",
    limits: "Not PCB layout, routing or fabrication.",
  },
  matter: {
    name: "Matter",
    scope: "A 2D steady-state heat-spreader model: the agent writes geometry code, a validated solver scores it, and printable geometry comes out.",
    limits: "Not airflow CFD, and not validated on a printed part.",
  },
};

/** Honest empty state for a workbench whose engine does not exist yet. It shows no design, no checks and no numbers. */
export function NotBuilt({ workbench }: { workbench: Exclude<Workbench, "silicon"> }) {
  const c = COPY[workbench];
  return (
    <section className="graticule grid min-h-[360px] place-items-center rounded-lg border border-line px-4 py-10" aria-label={`${c.name} workbench`}>
      <div className="max-w-[460px] min-w-0">
        <span className="inline-flex h-6 items-center rounded-full border border-line-2 bg-panel px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2">Roadmap</span>
        <h2 className="mt-3 text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{c.name} workbench: not built yet</h2>
        <p className="mt-2 text-[14px] leading-snug text-ink-2">{c.scope}</p>
        <p className="mt-1 text-[14px] leading-snug text-ink-3">{c.limits}</p>
        <p className="mt-4 border-t border-line pt-3 text-[13px] leading-snug text-ink-3">
          Nothing is shown here on purpose. A workbench appears in the workstation only after its engine has produced a real, fully verified run. Until then there is no design, no checks and no numbers to look at.
        </p>
      </div>
    </section>
  );
}
