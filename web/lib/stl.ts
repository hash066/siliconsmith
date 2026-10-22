// Minimal STL reader for the Matter viewer. Binary and ASCII. Returns triangles as flat arrays; no normals are trusted
// (they are recomputed from the vertices, so a bad file cannot make the renderer lie about the shape).

export interface Mesh {
  /** 9 numbers per triangle: x1 y1 z1 x2 y2 z2 x3 y3 z3 */
  tris: Float32Array;
  count: number;
  min: [number, number, number];
  max: [number, number, number];
}

export const MAX_TRIANGLES = 200_000;

function bounds(tris: Float32Array): Pick<Mesh, "min" | "max"> {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  return { min, max };
}

export function parseStl(buf: ArrayBuffer): Mesh {
  const view = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      if (n === 0 || n > MAX_TRIANGLES) throw new Error(`STL has ${n} triangles`);
      const tris = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const o = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) tris[t * 9 + k] = view.getFloat32(o + k * 4, true);
      }
      if (tris.some((v) => !Number.isFinite(v))) throw new Error("STL has non-finite coordinates");
      return { tris, count: n, ...bounds(tris) };
    }
  }
  const text = new TextDecoder().decode(buf);
  if (!/^\s*solid/.test(text)) throw new Error("not an STL file");
  const nums: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
    if (nums.length > MAX_TRIANGLES * 9) throw new Error("STL too large");
  }
  if (nums.length === 0 || nums.length % 9 !== 0 || nums.some((v) => !Number.isFinite(v))) throw new Error("ASCII STL is malformed");
  const tris = Float32Array.from(nums);
  return { tris, count: tris.length / 9, ...bounds(tris) };
}
