"use client";

import { useMemo } from "react";

export interface DesignJson {
  instances: Array<{ ref: string; part: string }>;
  nets: Array<{ name: string; pins: string[] }>;
}

export function isDesignJson(v: unknown): v is DesignJson {
  const d = v as DesignJson | null;
  return !!d && Array.isArray(d.instances) && Array.isArray(d.nets) && d.instances.every((i) => typeof i?.ref === "string" && typeof i?.part === "string") && d.nets.every((n) => typeof n?.name === "string" && Array.isArray(n.pins));
}

interface GNode {
  id: string;
  kind: "part" | "net";
  label: string;
  x: number;
  y: number;
}

const W = 640;
const H = 360;
const GROUND = /^(GND|AGND|VSS)$/i;

/** Deterministic force layout (no randomness), so the same design always draws the same. */
export function layoutDesign(d: DesignJson): { nodes: GNode[]; edges: Array<[string, string]>; ground: Set<string> } {
  const ground = new Set<string>();
  const nodes: GNode[] = d.instances.map((i, k) => ({ id: `p:${i.ref}`, kind: "part", label: i.ref, x: 0, y: 0 }));
  const edges: Array<[string, string]> = [];
  for (const n of d.nets) {
    const refs = [...new Set(n.pins.map((p) => p.split(".")[0]))].filter((r) => d.instances.some((i) => i.ref === r));
    if (GROUND.test(n.name)) {
      for (const r of refs) ground.add(r);
      continue;
    }
    if (refs.length < 2) continue;
    nodes.push({ id: `n:${n.name}`, kind: "net", label: n.name, x: 0, y: 0 });
    for (const r of refs) edges.push([`n:${n.name}`, `p:${r}`]);
  }
  nodes.forEach((n, k) => {
    const a = (k / nodes.length) * Math.PI * 2;
    n.x = W / 2 + Math.cos(a) * W * 0.32;
    n.y = H / 2 + Math.sin(a) * H * 0.32;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let it = 0; it < 320; it++) {
    const cool = 1 - it / 320;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const f = (2600 / d2) * cool;
        const dist = Math.sqrt(d2);
        dx /= dist;
        dy /= dist;
        a.x += dx * f;
        a.y += dy * f;
        b.x -= dx * f;
        b.y -= dy * f;
      }
    for (const [s, t] of edges) {
      const a = byId.get(s)!;
      const b = byId.get(t)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (dist - 70) * 0.04 * cool;
      a.x += (dx / dist) * f;
      a.y += (dy / dist) * f;
      b.x -= (dx / dist) * f;
      b.y -= (dy / dist) * f;
    }
    for (const n of nodes) {
      n.x += (W / 2 - n.x) * 0.01;
      n.y += (H / 2 - n.y) * 0.01;
    }
  }
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (W - 80) / Math.max(x1 - x0, 1);
  const sy = (H - 50) / Math.max(y1 - y0, 1);
  for (const n of nodes) {
    n.x = 40 + (n.x - x0) * sx;
    n.y = 25 + (n.y - y0) * sy;
  }
  return { nodes, edges, ground };
}

/**
 * Connection graph of a design.json: parts as boxes, nets as dots. It is not a laid-out schematic.
 * `highlight` is a set of part ids (e.g. "esp32") whose instances are drawn emphasised (the parts a failing check cited).
 */
export function SchematicGraph({ design, partOf, highlight }: { design: DesignJson; partOf?: (ref: string) => string; highlight: Set<string> }) {
  const g = useMemo(() => layoutDesign(design), [design]);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const part = (ref: string) => design.instances.find((i) => i.ref === ref)?.part ?? partOf?.(ref) ?? ref;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Connection graph: ${design.instances.length} parts, ${design.nets.length} nets. Not a laid-out schematic.`}>
      {g.edges.map(([s, t], k) => {
        const a = byId.get(s)!;
        const b = byId.get(t)!;
        return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-2)" strokeWidth="1" />;
      })}
      {g.nodes.map((n) =>
        n.kind === "net" ? (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r="3.5" fill="var(--ink-3)" />
            <text x={n.x + 6} y={n.y - 5} fontSize="9.5" fill="var(--ink-3)" fontFamily="var(--font-mono)">
              {n.label}
            </text>
          </g>
        ) : (
          <g key={n.id}>
            <rect
              x={n.x - 20}
              y={n.y - 11}
              width="40"
              height="22"
              rx="3"
              fill="var(--panel)"
              stroke={highlight.has(part(n.label)) ? "var(--amber)" : "var(--ink-2)"}
              strokeWidth={highlight.has(part(n.label)) ? 2 : 1}
            />
            <text x={n.x} y={n.y + 3.5} fontSize="10.5" textAnchor="middle" fill="var(--ink)" fontFamily="var(--font-mono)">
              {n.label}
            </text>
            {g.ground.has(n.label) && <path d={`M${n.x - 6} ${n.y + 15}h12M${n.x - 4} ${n.y + 18}h8M${n.x - 2} ${n.y + 21}h4`} stroke="var(--ink-3)" strokeWidth="1" fill="none" />}
          </g>
        ),
      )}
    </svg>
  );
}
