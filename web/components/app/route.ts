// Which workbench a first prompt is about. Plain keyword routing, shown to the user ("Picked Board from your wording") and changeable.
import type { WorkbenchId } from "@/lib/brand";

export type Chip = "auto" | WorkbenchId;

const RULES: Array<[WorkbenchId, RegExp]> = [
  ["silicon", /\b(risc|riscv|instruction|verilog|rtl|kernel|loop|cycles?|faster|speed ?up|tinymaix|chacha|cpu|opcode|custom op)/i],
  ["board", /\b(board|pcb|esp32|esp-?32|stm32|schematic|netlist|firmware|gpio|pin|i2c|spi|usb-?c|bme280|sensor|battery|ldo|bom|kicad)/i],
  ["matter", /\b(heat|heatsink|heat ?sink|spreader|thermal|temperature|fins?|cool|cooling|watt|\d+ ?w\b|stl|3d.?print|plate)/i],
];

/** Score each workbench by how many of its keywords appear; the highest wins, ties go to the order above. Null when nothing matches. */
export function routePrompt(text: string): WorkbenchId | null {
  let best: WorkbenchId | null = null;
  let bestN = 0;
  for (const [wb, re] of RULES) {
    const n = (text.match(new RegExp(re.source, "gi")) ?? []).length;
    if (n > bestN) {
      best = wb;
      bestN = n;
    }
  }
  return best;
}

export function resolveWorkbench(text: string, chip: Chip): { wb: WorkbenchId; picked: "chip" | "wording" | "default" } {
  if (chip !== "auto") return { wb: chip, picked: "chip" };
  const r = routePrompt(text);
  return r ? { wb: r, picked: "wording" } : { wb: "board", picked: "default" };
}

export interface Example {
  id: string;
  wb: WorkbenchId;
  title: string;
  prompt: string;
  /** What opens in the preview before the agent answers (all free and real). */
  preset?: { matter?: { spreader?: Record<string, number> } };
}

/** Three real, working prompts: one per workbench. */
export const EXAMPLES: Example[] = [
  { id: "matter", wb: "matter", title: "Heat sink", prompt: "A heat sink for a 5 W chip, 40 mm square, under 70 C.", preset: { matter: { spreader: { Q: 5 } } } },
  { id: "board", wb: "board", title: "Sensor board", prompt: "A battery ESP32 sensor board with a BME280 and USB-C charging; check it against its firmware." },
  { id: "silicon", wb: "silicon", title: "Faster loop", prompt: "Make this loop faster with a custom RISC-V instruction." },
];
