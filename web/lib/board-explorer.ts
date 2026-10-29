// The parts of the reference sensor board as a short, clickable tour. The copy describes the reference design in plain words; the
// geometry shown beside it is the real routed board (public/boards/clean_sensor), so the refs here must exist in that file.

export interface Stop {
  id: string;
  /** short upper-case label on the board */
  label: string;
  refs: string[];
  title: string;
  text: string;
}

export const STOPS: Stop[] = [
  { id: "mcu", label: "MICROCONTROLLER", refs: ["U1", "R3"], title: "ESP32 module, the brain", text: "Runs the firmware and talks to the sensor over I²C. A pull-up resistor holds its enable pin high so it runs. Its GPIO12 is a boot-strapping pin: its level at reset picks the boot mode, which is why a button wired there is a classic mistake the checks catch." },
  { id: "usb", label: "USB PORT", refs: ["J1", "R5", "R6"], title: "USB-C power input", text: "A power-only USB-C receptacle. The two 5.1 kΩ resistors on its configuration pins tell a charger this is a device that wants power." },
  { id: "charger", label: "BATTERY CHARGER", refs: ["U5", "R7"], title: "Li-ion charger", text: "A single-cell charger (MCP73831 class) that takes power from the USB port and charges the battery. One resistor sets the charge current." },
  { id: "battery", label: "BATTERY", refs: ["J2"], title: "Battery connector", text: "Where the single Li-ion cell plugs in. The regulator takes its power from this battery rail." },
  { id: "ldo", label: "VOLTAGE REGULATOR", refs: ["U2"], title: "Voltage regulator", text: "Turns the battery voltage into the steady 3.3 V the module and sensor run on." },
  { id: "sensor", label: "SENSOR", refs: ["U3", "R1", "R2"], title: "Humidity, pressure and temperature", text: "A BME280-class sensor on the I²C bus. The two 4.7 kΩ resistors are the bus pull-ups; without them the bus floats." },
  { id: "button", label: "WAKE BUTTON", refs: ["SW1"], title: "Wake button", text: "Connects the module's wake pin (GPIO14) to ground when pressed, to wake it from sleep." },
  { id: "led", label: "STATUS LED", refs: ["D1", "R4"], title: "Status LED", text: "Driven by a module pin (GPIO4) through a 330 Ω resistor that limits its current." },
  { id: "bypass", label: "BYPASS CAPACITORS", refs: ["C101", "C102", "C103", "C104", "C105", "C106"], title: "Bypass capacitors", text: "Small capacitors the layout step added near the supply pins, so each chip has a tiny local store of charge. They were not in the netlist; the layout adds them and lists them in the parts list." },
];

/** Refs in a stop that exist in the board, so a stale list can never highlight nothing. */
export function presentRefs(stop: Stop, refs: Iterable<string>): string[] {
  const have = new Set(refs);
  return stop.refs.filter((r) => have.has(r));
}

/** Rotation for a gentle tilt that follows the pointer: x and y are 0..1 across the board. Zero when the visitor prefers reduced motion. */
export function tiltOf(x: number, y: number, reduce: boolean): { rx: number; ry: number } {
  if (reduce) return { rx: 0, ry: 0 };
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { rx: Math.round((0.5 - c(y)) * 14 * 10) / 10, ry: Math.round((c(x) - 0.5) * 18 * 10) / 10 };
}
