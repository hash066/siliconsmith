// A small ZIP writer ("stored", no compression): enough to hand a visitor one file with everything from their project.
// Standard local file headers, a central directory and CRC-32, so any unzip tool opens it.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the zip, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array;
}

const enc = new TextEncoder();
const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/** A safe entry name: no folders above the root, no empty parts. */
export function safeName(name: string): string {
  return name
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

export function makeZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() >> 1) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  const chunks: number[][] = [];
  const parts: Uint8Array[] = [];
  const central: number[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const e of entries) {
    let name = safeName(e.name) || "file";
    for (let i = 2; seen.has(name); i++) name = `${safeName(e.name)}-${i}`;
    seen.add(name);
    const nameBytes = enc.encode(name);
    const crc = crc32(e.data);
    const flags = 0x0800; // names are UTF-8
    const head = [...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(nameBytes.length), ...u16(0)];
    parts.push(Uint8Array.from(head), nameBytes, e.data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
    offset += head.length + nameBytes.length + e.data.length;
  }
  void chunks;
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(offset), ...u16(0)];
  const total = offset + central.length + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  out.set(central, at);
  out.set(end, at + central.length);
  return out;
}
