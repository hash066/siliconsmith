// Downloads derived from the real design JSON: a bill of materials and a KiCad-format netlist. Netlist level only: no footprints, no layout.
import type { DesignJson } from "../domain/SchematicGraph";

export interface BomRow {
  part: string;
  qty: number;
  refs: string[];
}

export function bomOf(d: DesignJson): BomRow[] {
  const m = new Map<string, string[]>();
  for (const i of d.instances) m.set(i.part, [...(m.get(i.part) ?? []), i.ref]);
  return [...m.entries()]
    .map(([part, refs]) => ({ part, qty: refs.length, refs: refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }))
    .sort((a, b) => a.part.localeCompare(b.part));
}

export const bomCsv = (d: DesignJson): string => ["part,quantity,references", ...bomOf(d).map((r) => `${r.part},${r.qty},"${r.refs.join(" ")}"`)].join("\n") + "\n";

const q = (s: string) => `"${s.replace(/"|\\/g, "_")}"`;

/** KiCad netlist (s-expression). Pin names come from the design as written; there are no footprints, so this is for reading and diffing, not for layout. */
export function kicadNetlist(d: DesignJson, title = "Hardwright design"): string {
  const comps = d.instances.map((i) => `    (comp (ref ${q(i.ref)}) (value ${q(i.part)}) (libsource (lib "hardwright") (part ${q(i.part)})))`).join("\n");
  const nets = d.nets
    .map((n, k) => {
      const nodes = [...new Set(n.pins)]
        .map((p) => {
          const [ref, ...rest] = p.split(".");
          return `      (node (ref ${q(ref)}) (pin ${q(rest.join(".") || "?")}))`;
        })
        .join("\n");
      return `    (net (code "${k + 1}") (name ${q(n.name)})\n${nodes})`;
    })
    .join("\n");
  return `(export (version "E")\n  (design (source ${q(title)}) (tool "Hardwright netlist export"))\n  (components\n${comps})\n  (nets\n${nets}))\n`;
}
