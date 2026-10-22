// The evidence library: stored manifests written by scripts/build_library.py from real passing runs (repo root `evidence/`).
// The web build copies them to public/library/ (scripts/vendor-engine.mjs). This module only reads and validates them; it never
// runs anything. The reproduce command is shown, never claimed to have run.

export interface ManifestArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface LibraryManifest {
  id: string;
  title: string;
  rationale: string;
  instruction: { name: string; mnemonic: string; funct7?: number; encoding?: string; cpu_carries: string[] };
  kind: string;
  source: { run_id: string; node_id: string; workload: string; backend: string; created: string };
  metrics: { cycles: number | null; speedup: number | null; area_delta_pct: number | null; luts: number | null; ffs: number | null; fmax_mhz: number | null; wall_speedup: number | null; note?: string };
  ladder: Record<string, "pass" | "fail" | "skipped">;
  claims: string[];
  not_claimed: string[];
  tools: Record<string, string>;
  /** `siliconsmith verify-entry <id>`: re-runs lint, vectors and the formal proof from the stored artifacts, no model. */
  reproduce: string;
  artifacts: ManifestArtifact[];
}

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function isEntryId(v: unknown): v is string {
  return typeof v === "string" && ID.test(v);
}

/** Validates the fields the UI relies on. Returns null for a manifest that is not in the expected shape. */
export function parseManifest(raw: unknown): LibraryManifest | null {
  const m = raw as Record<string, any> | null;
  if (!m || typeof m !== "object" || m.schema !== 1) return null;
  if (!isEntryId(m.id) || !isStr(m.title) || !isStr(m.reproduce) || !m.instruction || !isStr(m.instruction.mnemonic) || !m.source || !isStr(m.source.run_id)) return null;
  if (!m.ladder || typeof m.ladder !== "object" || !m.metrics || typeof m.metrics !== "object") return null;
  if (!Array.isArray(m.artifacts) || !m.artifacts.every((a: any) => isStr(a?.path) && /^[0-9a-f]{64}$/.test(a?.sha256) && typeof a?.bytes === "number")) return null;
  const ladder: LibraryManifest["ladder"] = {};
  for (const [k, v] of Object.entries(m.ladder)) {
    if (v !== "pass" && v !== "fail" && v !== "skipped") return null;
    ladder[k] = v;
  }
  return {
    id: m.id,
    title: m.title,
    rationale: typeof m.rationale === "string" ? m.rationale : "",
    instruction: { name: String(m.instruction.name ?? m.instruction.mnemonic), mnemonic: m.instruction.mnemonic, funct7: m.instruction.funct7, encoding: m.instruction.encoding, cpu_carries: Array.isArray(m.instruction.cpu_carries) ? m.instruction.cpu_carries.map(String) : [] },
    kind: String(m.kind ?? "instruction"),
    source: { run_id: m.source.run_id, node_id: String(m.source.node_id ?? ""), workload: String(m.source.workload ?? ""), backend: String(m.source.backend ?? ""), created: String(m.source.created ?? "") },
    metrics: { cycles: numOrNull(m.metrics.cycles), speedup: numOrNull(m.metrics.speedup), area_delta_pct: numOrNull(m.metrics.area_delta_pct), luts: numOrNull(m.metrics.luts), ffs: numOrNull(m.metrics.ffs), fmax_mhz: numOrNull(m.metrics.fmax_mhz), wall_speedup: numOrNull(m.metrics.wall_speedup), note: typeof m.metrics.note === "string" ? m.metrics.note : undefined },
    ladder,
    claims: Array.isArray(m.claims) ? m.claims.map(String) : [],
    not_claimed: Array.isArray(m.not_claimed) ? m.not_claimed.map(String) : [],
    tools: m.tools && typeof m.tools === "object" ? Object.fromEntries(Object.entries(m.tools).map(([k, v]) => [k, String(v)])) : {},
    reproduce: m.reproduce,
    artifacts: m.artifacts.map((a: any) => ({ path: a.path, sha256: a.sha256, bytes: a.bytes })),
  };
}

/** The ids listed in index.json (which also carries a summary of each entry). */
export function parseIndexIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((e) => (e as { id?: unknown })?.id).filter(isEntryId) : [];
}

/** True when the command is exactly `siliconsmith verify-entry <id>` for this entry (a guard against showing a wrong command). */
export const reproduceMatches = (m: LibraryManifest) => m.reproduce.trim() === `siliconsmith verify-entry ${m.id}`;

export interface ManifestStore {
  ids(): Promise<string[]>;
  get(id: string): Promise<LibraryManifest | null>;
}

/** Server-side store over `public/library` (read per call; the directory is small). */
export function fsManifestStore(dir: string): ManifestStore {
  return {
    async ids() {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      try {
        return parseIndexIds(JSON.parse(await readFile(join(dir, "index.json"), "utf8")));
      } catch {
        return [];
      }
    },
    async get(id) {
      if (!isEntryId(id)) return null;
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      try {
        return parseManifest(JSON.parse(await readFile(join(dir, id, "manifest.json"), "utf8")));
      } catch {
        return null;
      }
    },
  };
}
