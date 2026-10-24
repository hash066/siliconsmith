// The part library the board checks rest on, as the hosted API lists it (GET /api/board/parts), plus the BOM of a design.

export interface LibPart {
  id: string;
  name: string;
  kind: string;
  package: string;
  description: string;
  pin_table_checked: boolean;
  sources?: string[];
  pins: Array<{ name: string; number: string; direction: string; capabilities?: string[] }>;
  facts: Array<{ id: string; text: string; value?: number | string | null; unit?: string | null; citation_checked: boolean }>;
}

export type Category = "all" | "ics" | "passives" | "power" | "connectors";
export const CATEGORIES: Array<[Category, string]> = [
  ["all", "All"],
  ["ics", "ICs"],
  ["passives", "Passives"],
  ["power", "Power"],
  ["connectors", "Connectors"],
];

const POWER_IDS = new Set(["ldo33", "mcp73831"]);

/** The parts a design can use: the library without its placeholders. */
export const usable = (parts: LibPart[]) => parts.filter((p) => p.kind !== "placeholder" && p.kind !== "standard");

export function categoryOf(p: LibPart): Exclude<Category, "all"> {
  if (POWER_IDS.has(p.id)) return "power";
  if (p.kind === "passive") return "passives";
  if (p.kind === "connector") return "connectors";
  return "ics";
}

export function filterParts(parts: LibPart[], category: Category, query: string): LibPart[] {
  const q = query.trim().toLowerCase();
  return usable(parts).filter((p) => (category === "all" || categoryOf(p) === category) && (!q || [p.id, p.name, p.kind, p.package, p.description].some((s) => (s ?? "").toLowerCase().includes(q))));
}

export interface BomRow {
  refs: string[];
  part: string;
  value: string;
  name: string;
  package: string;
}

export function bomOf(design: { instances: Array<{ ref: string; part: string; params?: Record<string, unknown> }> } | null, parts: LibPart[]): BomRow[] {
  if (!design) return [];
  const by = new Map(parts.map((p) => [p.id, p]));
  const groups = new Map<string, BomRow>();
  for (const i of design.instances) {
    const p = i.params ?? {};
    const value = i.part === "res" && typeof p.ohms === "number" ? (p.ohms >= 1000 ? `${p.ohms / 1000}k` : `${p.ohms}`) : "";
    const k = `${i.part}|${value}`;
    const g = groups.get(k) ?? { refs: [], part: i.part, value, name: by.get(i.part)?.name ?? i.part, package: by.get(i.part)?.package ?? "" };
    g.refs.push(i.ref);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({ ...g, refs: g.refs.sort((a, b) => a.localeCompare(b, "en", { numeric: true })) })).sort((a, b) => a.refs[0].localeCompare(b.refs[0], "en", { numeric: true }));
}

export function bomCsvText(rows: BomRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ["Refs,Qty,Part,Value,Package", ...rows.map((r) => [r.refs.join(" "), r.refs.length, r.name, r.value, r.package].map((x) => esc(String(x))).join(","))].join("\n") + "\n";
}
