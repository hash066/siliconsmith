// The umbrella product name lives here only. SiliconSmith is the Silicon workbench's ENGINE name, not the product.
export const BRAND = {
  name: "Hardwright",
  tagline: "Agents that design hardware, and prove it.",
  sub: "Chips, boards and physical parts, checked by verifiers the model cannot argue with.",
  repo: "https://github.com/hash066/siliconsmith",
  prExample: "https://github.com/hash066/TinyMaix/pull/1",
} as const;

export type WorkbenchId = "silicon" | "board" | "matter";

export const WORKBENCHES: Record<WorkbenchId, { id: WorkbenchId; name: string; engine: string; blurb: string; accent: string }> = {
  silicon: { id: "silicon", name: "Silicon", engine: "SiliconSmith", blurb: "Invent a custom RISC-V instruction for a hot loop and prove it.", accent: "var(--hw-steel)" },
  board: { id: "board", name: "Board", engine: "BoardSmith", blurb: "Check a board design against its firmware and the part facts.", accent: "var(--hw-pcb)" },
  matter: { id: "matter", name: "Matter", engine: "MatterCompiler", blurb: "Simulate a heat spreader on a validated solver and compare baselines.", accent: "var(--hw-ember)" },
};

export const WORKBENCH_ORDER: WorkbenchId[] = ["matter", "silicon", "board"];
