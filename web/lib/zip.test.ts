import { describe, expect, it } from "vitest";
import { crc32, makeZip, safeName } from "./zip";

const text = (s: string) => new TextEncoder().encode(s);

/** Reads the zip back the way an unzip tool does: end record, central directory, local headers, CRC check. */
function readZip(z: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let at = v.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    const nlen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(z.slice(at + 46, at + 46 + nlen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = z.slice(dataAt, dataAt + size);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data });
    at += 46 + nlen;
  }
  return out;
}

describe("zip", () => {
  it("crc32 matches the known check value", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it("round-trips files, including binary data and UTF-8 names", () => {
    const bin = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 256);
    const files = readZip(makeZip([{ name: "a.txt", data: text("hello") }, { name: "dir/b.bin", data: bin }, { name: "é.txt", data: text("x") }]));
    expect(files.map((f) => f.name)).toEqual(["a.txt", "dir/b.bin", "é.txt"]);
    expect(new TextDecoder().decode(files[0].data)).toBe("hello");
    expect([...files[1].data]).toEqual([...bin]);
  });
  it("an empty zip is still valid", () => {
    expect(readZip(makeZip([]))).toEqual([]);
  });
  it("never writes a path that climbs out of the folder, and renames duplicates", () => {
    expect(safeName("../../etc/passwd")).toBe("etc/passwd");
    expect(safeName("\\a\\..\\b.txt")).toBe("a/b.txt");
    const names = readZip(makeZip([{ name: "x.txt", data: text("1") }, { name: "x.txt", data: text("2") }])).map((f) => f.name);
    expect(names).toEqual(["x.txt", "x.txt-2"]);
  });
});
