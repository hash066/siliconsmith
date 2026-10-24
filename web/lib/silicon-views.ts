// The views of a verified instruction, from the files a live run returns (views/instruction.json is made inside the Sandbox by
// Yosys and Verilator). Everything here reads that data; nothing is drawn that the tools did not report.

export type Bit = number | string;
export interface ViewCell {
  name: string;
  type: string;
  params: Record<string, number | string>;
  dirs: Record<string, "input" | "output">;
  conn: Record<string, Bit[]>;
}
export interface InstructionViews {
  name: string;
  ports: Record<string, { dir: "input" | "output"; bits: Bit[] }>;
  cells: ViewCell[];
  word_stat: string;
  gates: Record<string, number>;
  gate_total: number;
  depth: number | null;
  /** [rs1, rs2, rd from the hardware, rd from the C reference] */
  rows: number[][];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseViews(text: string | undefined): InstructionViews | null {
  if (!text) return null;
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(j) || !isObj(j.ports) || !Array.isArray(j.cells) || !Array.isArray(j.rows)) return null;
  const cells = (j.cells as unknown[]).filter((c): c is ViewCell => isObj(c) && typeof c.type === "string" && isObj(c.conn));
  const rows = (j.rows as unknown[]).filter((r): r is number[] => Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === "number"));
  return {
    name: String(j.name ?? ""),
    ports: j.ports as InstructionViews["ports"],
    cells,
    word_stat: typeof j.word_stat === "string" ? j.word_stat : "",
    gates: isObj(j.gates) ? (j.gates as Record<string, number>) : {},
    gate_total: typeof j.gate_total === "number" ? j.gate_total : 0,
    depth: typeof j.depth === "number" ? j.depth : null,
    rows,
  };
}

export const CELL_WORDS: Record<string, [string, string]> = {
  $mul: ["×", "multiply"],
  $add: ["+", "add"],
  $sub: ["−", "subtract"],
  $neg: ["−x", "negate"],
  $and: ["&", "and"],
  $or: ["|", "or"],
  $xor: ["^", "xor"],
  $not: ["~", "invert"],
  $shl: ["<<", "shift left"],
  $shr: [">>", "shift right"],
  $sshr: [">>>", "shift right (signed)"],
  $mux: ["?:", "choose"],
  $pmux: ["?:", "choose"],
  $eq: ["==", "equal"],
  $ne: ["!=", "not equal"],
  $lt: ["<", "less than"],
  $le: ["<=", "at most"],
  $gt: [">", "greater than"],
  $ge: [">=", "at least"],
  $pos: ["=", "wire"],
  $reduce_and: ["&…", "all bits set"],
  $reduce_or: ["|…", "any bit set"],
  $reduce_xor: ["^…", "parity"],
  $logic_not: ["!", "not"],
  $macc_v2: ["×+", "multiply and add"],
};

export interface LNode {
  id: string;
  kind: "in" | "out" | "cell";
  label: string;
  sub: string;
  layer: number;
  row: number;
}
export interface LEdge {
  from: string;
  to: string;
  width: number;
}

const isNet = (b: Bit): b is number => typeof b === "number";

/** Yosys writes numeric parameters as binary text ("00000000000000000000000000001000" is 8). */
export const paramNum = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && /^[01]+$/.test(v) ? parseInt(v, 2) : undefined);

/** Source text without its leading block comment (licence and notes), so a view opens on the code. */
export const stripLeadingComment = (code: string): string => code.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");

/** Cells as boxes in columns by depth (inputs on the left, the result on the right), joined by the nets they share. */
export function layerNetlist(v: InstructionViews): { nodes: LNode[]; edges: LEdge[]; layers: number } {
  const driver = new Map<number, string>();
  const nodes: LNode[] = [];
  for (const [name, p] of Object.entries(v.ports)) {
    if (p.dir !== "input") continue;
    nodes.push({ id: `in:${name}`, kind: "in", label: name, sub: `${p.bits.length} bits in`, layer: 0, row: 0 });
    for (const b of p.bits) if (isNet(b)) driver.set(b, `in:${name}`);
  }
  for (const c of v.cells)
    for (const [port, bits] of Object.entries(c.conn)) if (c.dirs[port] === "output") for (const b of bits) if (isNet(b)) driver.set(b, c.name);
  const consumers = new Map<string, Set<number>>();
  const edgeBits = new Map<string, number>();
  const link = (from: string, to: string, bit: number) => {
    const k = `${from}>${to}`;
    edgeBits.set(k, (edgeBits.get(k) ?? 0) + 1);
    if (!consumers.has(to)) consumers.set(to, new Set());
    consumers.get(to)!.add(bit);
  };
  for (const c of v.cells)
    for (const [port, bits] of Object.entries(c.conn)) {
      if (c.dirs[port] !== "input") continue;
      const seen = new Set<string>();
      for (const b of bits) {
        const d = isNet(b) ? driver.get(b) : undefined;
        if (d && d !== c.name && !seen.has(`${d}`)) seen.add(d);
        if (d && d !== c.name) link(d, c.name, b as number);
      }
    }
  for (const [name, p] of Object.entries(v.ports)) {
    if (p.dir !== "output") continue;
    for (const b of p.bits) {
      const d = isNet(b) ? driver.get(b) : undefined;
      if (d) link(d, `out:${name}`, b as number);
    }
  }
  const layerOf = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const preds = new Map<string, string[]>();
  for (const k of edgeBits.keys()) {
    const [f, t] = k.split(">");
    preds.set(t, [...(preds.get(t) ?? []), f]);
  }
  const depth = (id: string, stack: Set<string> = new Set()): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0; // a loop cannot occur in combinational logic; do not recurse forever if the data says otherwise
    stack.add(id);
    const d = 1 + Math.max(0, ...(preds.get(id) ?? []).map((p) => depth(p, stack)));
    stack.delete(id);
    layerOf.set(id, d);
    return d;
  };
  for (const c of v.cells) {
    const [sym, word] = CELL_WORDS[c.type] ?? [c.type.replace(/^\$/, ""), c.type.replace(/^\$/, "")];
    const p = c.params;
    const w = [paramNum(p.A_WIDTH), paramNum(p.B_WIDTH)].filter((x) => x !== undefined);
    const yw = paramNum(p.Y_WIDTH);
    nodes.push({ id: c.name, kind: "cell", label: `${sym}  ${word}`, sub: yw !== undefined ? `${w.length ? w.join(" and ") + " bits → " : ""}${yw} bits` : "", layer: depth(c.name), row: 0 });
  }
  const outLayer = 1 + Math.max(0, ...nodes.filter((n) => n.kind === "cell").map((n) => n.layer));
  for (const [name, p] of Object.entries(v.ports)) if (p.dir === "output") nodes.push({ id: `out:${name}`, kind: "out", label: name, sub: `${p.bits.length} bits out`, layer: outLayer, row: 0 });
  const perLayer = new Map<number, number>();
  for (const n of nodes) {
    n.row = perLayer.get(n.layer) ?? 0;
    perLayer.set(n.layer, n.row + 1);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [...edgeBits.entries()].map(([k, width]) => {
    const [from, to] = k.split(">");
    return { from, to, width };
  }).filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes, edges, layers: outLayer + 1 };
}

export const hex32 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
export const matches = (row: number[]) => row[2] >>> 0 === row[3] >>> 0;
