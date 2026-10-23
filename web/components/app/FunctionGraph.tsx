"use client";

import { useMemo } from "react";
import type { DesignJson } from "../domain/SchematicGraph";

// A connection graph grouped by function (MCU, power, USB, sensor, passives and IO) with a deterministic layout.
// It is still a connection graph, not a laid-out schematic: boxes are parts, lines are signal nets, power rails are listed, not drawn.

export type GroupId = "power" | "mcu" | "sensor" | "usb" | "passive";
export const GROUP_LABEL: Record<GroupId, string> = { power: "Power", mcu: "MCU", sensor: "Sensor", usb: "USB", passive: "Passives and IO" };

const RULES: Array<[GroupId, RegExp]> = [
  ["mcu", /^(esp|stm|nrf|rp2|atmega|attiny|samd|mcu|pic|ch32|gd32|k210|cc13|cc26)/i],
  ["usb", /^(usb|conn|jack|header|plug|rj|sd|qwiic|stemma)/i],
  ["power", /^(ldo|reg|buck|boost|pmic|charger|batt|cell|mcp73|bq2|tps|ap21|ams11|ld1117|xc6|ncp|max17)/i],
  ["sensor", /^(bme|bmp|sht|mpu|lis|bmi|icm|sensor|imu|adc|ads|tmp|aht|veml|vl53|scd|ccs|mag|hall)/i],
];

/** Group by the part's name; a design's `mcu_ref` instance is always the MCU; connectors by ref prefix J/P. Everything else is passive or IO. */
export function groupOf(part: string, ref: string, mcuRef?: string): GroupId {
  if (mcuRef && ref === mcuRef) return "mcu";
  for (const [g, re] of RULES) if (re.test(part)) return g;
  if (/^J\d/i.test(ref)) return "usb";
  return "passive";
}

const GROUND = /^(GND|AGND|DGND|VSS|PGND)$/i;
const RAIL = /^(\+?\d+V\d*|V(BAT|BUS|IN|OUT|CC|DD|DDIO|SYS|BATT)|VIN|VOUT|VCC|VDD)$/i;

interface PlacedPart {
  ref: string;
  part: string;
  group: GroupId;
  x: number;
  y: number;
}
export interface GroupedLayout {
  W: number;
  H: number;
  boxes: Array<{ id: GroupId; x: number; y: number; w: number; h: number }>;
  parts: PlacedPart[];
  edges: Array<{ net: string; a: string; b: string }>;
  rails: string[];
  ground: Set<string>;
}

const PW = 44;
const PH = 22;
const GAP = 8;
const PAD = 12;
const HEAD = 18;

/** Pure and deterministic: the same design always lays out the same. */
export function layoutGrouped(d: DesignJson & { mcu_ref?: string }): GroupedLayout {
  const groups = new Map<GroupId, Array<{ ref: string; part: string }>>();
  for (const i of d.instances) {
    const g = groupOf(i.part, i.ref, d.mcu_ref);
    groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  for (const list of groups.values()) list.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  // Two rows: power, MCU, sensor on top; USB and passives below.
  const rows: GroupId[][] = [["power", "mcu", "sensor"], ["usb", "passive"]];
  const W = 480;
  const boxes: GroupedLayout["boxes"] = [];
  const parts: PlacedPart[] = [];
  let y = 8;
  for (const row of rows) {
    const present = row.filter((g) => groups.has(g));
    if (!present.length) continue;
    // width share by part count, at least one column
    const weights = present.map((g) => Math.max(1, groups.get(g)!.length));
    const total = weights.reduce((a, b) => a + b, 0);
    const avail = W - 16 - GAP * (present.length - 1);
    let x = 8;
    let rowH = 0;
    present.forEach((g, k) => {
      const w = Math.max(PW + PAD * 2, Math.floor((avail * weights[k]) / total));
      const list = groups.get(g)!;
      const cols = Math.min(4, Math.max(1, Math.floor((w - PAD * 2 + GAP) / (PW + GAP))));
      const h = HEAD + PAD + Math.ceil(list.length / cols) * (PH + GAP + 6) - GAP + 4;
      list.forEach((p, i) => parts.push({ ref: p.ref, part: p.part, group: g, x: x + PAD + (i % cols) * (PW + GAP) + PW / 2, y: y + HEAD + PAD / 2 + Math.floor(i / cols) * (PH + GAP + 6) + PH / 2 }));
      boxes.push({ id: g, x, y, w, h });
      rowH = Math.max(rowH, h);
      x += w + GAP;
    });
    y += rowH + GAP + 14;
  }
  const refs = new Set(d.instances.map((i) => i.ref));
  const byRef = new Map(parts.map((p) => [p.ref, p]));
  const ground = new Set<string>();
  const edges: GroupedLayout["edges"] = [];
  const rails: string[] = [];
  for (const n of d.nets) {
    const members = [...new Set(n.pins.map((p) => p.split(".")[0]))].filter((r) => refs.has(r));
    if (GROUND.test(n.name)) {
      for (const r of members) ground.add(r);
      continue;
    }
    if (members.length < 2) continue;
    if (RAIL.test(n.name) || members.length >= 5) {
      rails.push(n.name);
      continue;
    }
    // star to the anchor: the MCU if it is on the net, otherwise the first part
    const anchor = members.find((r) => byRef.get(r)?.group === "mcu") ?? members[0];
    for (const r of members) if (r !== anchor) edges.push({ net: n.name, a: anchor, b: r });
  }
  return { W, H: Math.max(y, 60), boxes, parts, edges, rails, ground };
}

export function FunctionGraph({ design, highlight }: { design: DesignJson & { mcu_ref?: string }; highlight: Set<string> }) {
  const g = useMemo(() => layoutGrouped(design), [design]);
  const byRef = new Map(g.parts.map((p) => [p.ref, p]));
  return (
    <div>
      <svg viewBox={`0 0 ${g.W} ${g.H}`} className="block h-auto w-full" role="img" aria-label={`Connection graph grouped by function: ${design.instances.length} parts in ${g.boxes.length} groups, ${g.edges.length} signal links. Not a laid-out schematic.`}>
        {g.boxes.map((b) => (
          <g key={b.id}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="8" fill="var(--sunken)" stroke="var(--line)" />
            <text x={b.x + 10} y={b.y + 13} fontSize="9.5" fill="var(--ink-3)" fontFamily="var(--font-code)" letterSpacing="0.06em">
              {GROUP_LABEL[b.id].toUpperCase()}
            </text>
          </g>
        ))}
        {g.edges.map((e, k) => {
          const a = byRef.get(e.a)!;
          const b = byRef.get(e.b)!;
          return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-2)" strokeWidth="1" opacity="0.8" />;
        })}
        {g.edges.map((e, k) => {
          const a = byRef.get(e.a)!;
          const b = byRef.get(e.b)!;
          return (
            <text key={`l${k}`} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 2} fontSize="8.5" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--font-code)" stroke="var(--panel)" strokeWidth="3" paintOrder="stroke">
              {e.net}
            </text>
          );
        })}
        {g.parts.map((p) => {
          const hot = highlight.has(p.part);
          return (
            <g key={p.ref}>
              <rect x={p.x - 22} y={p.y - 11} width="44" height="22" rx="4" fill="var(--panel)" stroke={hot ? "var(--amber)" : "var(--ink-2)"} strokeWidth={hot ? 2 : 1} />
              <text x={p.x} y={p.y + 3.5} fontSize="10.5" textAnchor="middle" fill="var(--ink)" fontFamily="var(--font-code)">
                {p.ref}
              </text>
              <text x={p.x} y={p.y + 21} fontSize="7.5" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--font-code)">
                {p.part.length > 9 ? `${p.part.slice(0, 8)}…` : p.part}
              </text>
              {g.ground.has(p.ref) && <path d={`M${p.x + 24} ${p.y - 2}h7M${p.x + 25.5} ${p.y + 1}h4M${p.x + 27} ${p.y + 4}h1`} stroke="var(--ink-3)" strokeWidth="1" fill="none" />}
            </g>
          );
        })}
      </svg>
      {g.rails.length > 0 && (
        <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
          Power rails, not drawn as lines: <span className="num text-ink-2">{g.rails.join(" · ")}</span>. A ground symbol marks parts tied to ground.
        </p>
      )}
    </div>
  );
}
