// A simple block diagram of a real design: functional blocks (MCU, power, USB, sensor, passives) and the links between them, derived from the nets.
import type { DesignJson } from "../domain/SchematicGraph";
import { groupOf, GROUP_LABEL, type GroupId } from "./FunctionGraph";

export interface BlockNode {
  id: GroupId;
  label: string;
  parts: string[];
  x: number;
  y: number;
}
export interface BlockLink {
  a: GroupId;
  b: GroupId;
  kind: "signal" | "power";
  label: string;
}
export const BLOCK_W = 132;
export const BLOCK_H = 58;
export const BLOCK_VIEW = { w: 480, h: 210 };
const POS: Record<GroupId, [number, number]> = { usb: [14, 12], power: [14, 140], mcu: [174, 76], sensor: [334, 12], passive: [334, 140] };
const GROUND = /^(GND|AGND|DGND|VSS|PGND)$/i;
const RAIL = /^(\+?\d+V\d*|V(BAT|BUS|IN|OUT|CC|DD|DDIO|SYS|BATT)|VIN|VOUT|VCC|VDD)$/i;

export function blockDiagram(d: DesignJson & { mcu_ref?: string }): { nodes: BlockNode[]; links: BlockLink[] } {
  const groupOfRef = new Map<string, GroupId>();
  const parts = new Map<GroupId, string[]>();
  for (const i of d.instances) {
    const g = groupOf(i.part, i.ref, d.mcu_ref);
    groupOfRef.set(i.ref, g);
    parts.set(g, [...(parts.get(g) ?? []), i.part]);
  }
  const nodes: BlockNode[] = [...parts.entries()].map(([id, ps]) => ({ id, label: GROUP_LABEL[id], parts: [...new Set(ps)].sort(), x: POS[id][0], y: POS[id][1] }));
  const have = new Set(nodes.map((n) => n.id));
  const acc = new Map<string, { a: GroupId; b: GroupId; kind: "signal" | "power"; names: Set<string> }>();
  const add = (a: GroupId, b: GroupId, kind: "signal" | "power", name: string) => {
    if (a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${kind}:${x}:${y}`;
    const cur = acc.get(key) ?? { a: x, b: y, kind, names: new Set<string>() };
    cur.names.add(name);
    acc.set(key, cur);
  };
  for (const n of d.nets) {
    if (GROUND.test(n.name)) continue;
    const gs = [...new Set(n.pins.map((p) => groupOfRef.get(p.split(".")[0])).filter((g): g is GroupId => !!g))];
    if (gs.length < 2) continue;
    const members = new Set(n.pins.map((p) => p.split(".")[0])).size;
    if (RAIL.test(n.name) || members >= 5) {
      // a rail connects the power block to every other block on it
      const hub: GroupId = gs.includes("power") ? "power" : gs[0];
      for (const g of gs) add(hub, g, "power", n.name);
    } else {
      const hub: GroupId = gs.includes("mcu") ? "mcu" : gs[0];
      for (const g of gs) add(hub, g, "signal", n.name);
    }
  }
  const links: BlockLink[] = [...acc.values()].filter((l) => have.has(l.a) && have.has(l.b)).map((l) => ({ a: l.a, b: l.b, kind: l.kind, label: [...l.names].slice(0, 2).join(" · ") }));
  return { nodes, links };
}
