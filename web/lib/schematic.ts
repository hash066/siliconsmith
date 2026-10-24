// A schematic drawn from the design's netlist: one symbol per part, every connected pin labelled with its net ("net labels", as in
// KiCad, instead of long wires). Pure layout: nothing here knows about the screen. Pins shown are the ones the netlist connects,
// plus any pin the firmware table expects that the board does not use (marked, because that is the mismatch worth seeing).

export interface DesignIn {
  instances: Array<{ ref: string; part: string; params?: Record<string, unknown> }>;
  nets: Array<{ name: string; pins: string[] }>;
  mcu_ref?: string;
  mcu_assignments?: Array<{ function: string; pin: string }>;
  firmware_pins?: Array<{ function: string; pin: string }>;
}

export type Side = "left" | "right" | "top" | "bottom";
export type SymbolKind = "ic" | "resistor" | "capacitor" | "led" | "button" | "connector";

export interface SPin {
  name: string;
  side: Side;
  x: number;
  y: number;
  net: string;
  /** "fail": the firmware expects this function elsewhere; "wired": where it is actually wired; "fw": a pin only the firmware uses. */
  mark?: { kind: "fail" | "wired" | "fw"; text: string };
}
export interface SSymbol {
  ref: string;
  part: string;
  kind: SymbolKind;
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pins: SPin[];
}
export interface SSection {
  title: string;
  y: number;
  symbols: SSymbol[];
}
export interface Schematic {
  width: number;
  height: number;
  sections: SSection[];
}

const POWER_TOP = /^(VIN|VDD|VDDIO|VCC|VBUS|3V3|VBAT|BAT_P|V\+|VOUT|VREF)$/i;
const GND_BOTTOM = /^(GND\d*|VSS|AGND|BAT_N|K)$/i;
const GROUND_NETS = /^(GND|AGND|VSS)$/i;

const kindOf = (part: string): SymbolKind => (part === "res" ? "resistor" : part === "cap" ? "capacitor" : part === "led" ? "led" : part === "btn" ? "button" : part === "usbc" || part === "batt" ? "connector" : "ic");

const sectionOf = (part: string): string =>
  part === "usbc" || part === "batt" || part === "mcp73831" || part === "ldo33" ? "Power" : part === "esp32" ? "Controller" : part === "bme280" ? "Sensors" : "Passives and controls";

const SECTION_ORDER = ["Power", "Controller", "Sensors", "Passives and controls"];
const PIN_PITCH = 20;
const LABEL_MARGIN = 92;
const STUB = 16;

const valueOf = (i: DesignIn["instances"][number]): string => {
  const p = i.params ?? {};
  if (i.part === "res" && typeof p.ohms === "number") return p.ohms >= 1000 ? `${p.ohms / 1000}k` : `${p.ohms}`;
  if (i.part === "cap" && typeof p.farads === "number") return `${p.farads}`;
  return "";
};

const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** Which net each "REF.PIN" is on. */
function netOf(design: DesignIn): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of design.nets) for (const p of n.pins) m.set(p, n.name);
  return m;
}

function symbolFor(design: DesignIn, inst: DesignIn["instances"][number], nets: Map<string, string>): SSymbol {
  const kind = kindOf(inst.part);
  const mine = [...new Set(design.nets.flatMap((n) => n.pins).filter((p) => p.startsWith(inst.ref + ".")).map((p) => p.slice(inst.ref.length + 1)))].sort(natural);
  const isMcu = design.mcu_ref === inst.ref;
  const pins: SPin[] = [];
  const marks = new Map<string, NonNullable<SPin["mark"]>>();
  const extra: string[] = [];
  if (isMcu) {
    const wired = new Map((design.mcu_assignments ?? []).map((a) => [a.function, a.pin]));
    for (const fw of design.firmware_pins ?? []) {
      const nl = wired.get(fw.function);
      if (nl && nl !== fw.pin) {
        marks.set(fw.pin, { kind: "fail", text: `firmware expects ${fw.function} here` });
        marks.set(nl, { kind: "wired", text: `${fw.function} is wired here` });
        if (!mine.includes(fw.pin)) extra.push(fw.pin);
      }
    }
  }
  const all = [...mine, ...extra];

  if (kind === "resistor" || kind === "capacitor" || kind === "led" || kind === "button") {
    // two-terminal: first pin left, second right (a LED goes anode left, cathode right)
    const ordered = kind === "led" ? [...all].sort((a, b) => (a === "A" ? -1 : b === "A" ? 1 : natural(a, b))) : all;
    const w = 64;
    ordered.slice(0, 2).forEach((name, i) => pins.push({ name, side: i === 0 ? "left" : "right", x: i === 0 ? -STUB : w + STUB, y: 14, net: nets.get(`${inst.ref}.${name}`) ?? "" }));
    return { ref: inst.ref, part: inst.part, kind, value: valueOf(inst), x: 0, y: 0, w, h: 28, pins };
  }

  const top = all.filter((p) => POWER_TOP.test(p));
  const bottom = all.filter((p) => GND_BOTTOM.test(p) && !POWER_TOP.test(p));
  const rest = all.filter((p) => !top.includes(p) && !bottom.includes(p));
  const left: string[] = [];
  const right: string[] = [];
  rest.forEach((p, i) => (i % 2 === 0 ? left : right).push(p));
  const rows = Math.max(left.length, right.length, 1);
  const w = Math.max(isMcu ? 176 : 132, 24 * Math.max(top.length, bottom.length) + 40);
  const h = rows * PIN_PITCH + 36;
  const place = (names: string[], side: Side) =>
    names.forEach((name, i) => {
      const net = nets.get(`${inst.ref}.${name}`) ?? "";
      const mark = marks.get(name);
      if (side === "left") pins.push({ name, side, x: -STUB, y: 30 + i * PIN_PITCH, net, mark });
      else if (side === "right") pins.push({ name, side, x: w + STUB, y: 30 + i * PIN_PITCH, net, mark });
      else {
        const x = ((i + 1) * w) / (names.length + 1);
        pins.push({ name, side, x, y: side === "top" ? -STUB : h + STUB, net, mark });
      }
    });
  place(left, "left");
  place(right, "right");
  place(top, "top");
  place(bottom, "bottom");
  return { ref: inst.ref, part: inst.part, kind, value: valueOf(inst), x: 0, y: 0, w, h, pins };
}

export function schematicOf(design: DesignIn, maxWidth = 1080): Schematic {
  const nets = netOf(design);
  const groups = new Map<string, SSymbol[]>();
  for (const inst of design.instances) {
    const s = symbolFor(design, inst, nets);
    const sec = sectionOf(inst.part);
    groups.set(sec, [...(groups.get(sec) ?? []), s]);
  }
  const sections: SSection[] = [];
  let y = 8;
  let width = 0;
  for (const title of SECTION_ORDER) {
    const syms = (groups.get(title) ?? []).sort((a, b) => natural(a.ref, b.ref));
    if (!syms.length) continue;
    y += 22; // section heading
    let x = 8;
    let rowTop = y;
    let rowH = 0;
    for (const s of syms) {
      const extraLeft = s.pins.some((p) => p.mark && p.side === "left") ? 80 : 0; // a note on a left-hand pin needs room to its left
      const boxW = s.w + 2 * LABEL_MARGIN + extraLeft;
      if (x + boxW > maxWidth && x > 8) {
        x = 8;
        rowTop += rowH + 26;
        rowH = 0;
      }
      s.x = x + LABEL_MARGIN + extraLeft;
      s.y = rowTop + 24; // room for top pins and the ref text
      rowH = Math.max(rowH, s.h + 48);
      x += boxW;
      width = Math.max(width, x);
    }
    sections.push({ title, y: y - 14, symbols: syms });
    y = rowTop + rowH + 12;
  }
  return { width: Math.max(width, 320), height: y + 8, sections };
}

export const isGround = (net: string) => GROUND_NETS.test(net);
