// Client for the hosted Board and Matter functions (web/api/board.py, web/api/matter.py). Free, deterministic, no key.
// Every failure is classified so the panels can show a specific state: field errors (400/422), rate limit (429), too large (413),
// disabled (404 "disabled"), server (5xx) and network. Response shapes follow engine/siliconsmith/{board,matter}/HOSTING.md.

export type RungStatus = "pass" | "fail" | "unknown";

export interface BoardRung {
  rung: string;
  status: RungStatus;
  /** The ladder's claim. Non-null only when status is "pass". */
  label: string | null;
  detail: string;
  evidence: string[];
  findings: string[];
}
export interface BoardFact {
  id: string;
  part: string;
  origin: string;
  text: string;
  source: string | null;
  section: string | null;
  citation_checked: boolean;
  url: string | null;
}
export interface BoardCheck {
  ok: true;
  passed: boolean;
  ladder: Array<{ id: string; label: string; tool: string }>;
  rungs: BoardRung[];
  labels: string[];
  evidence: Record<string, BoardFact>;
  header: string;
  notice: string;
}
export interface BoardTemplateSummary {
  id: string;
  title: string;
  description: string;
  expect: Record<string, string>;
}
export interface BoardTemplate extends BoardTemplateSummary {
  design: unknown;
  header: string;
}
export interface BoardExplain {
  ok: true;
  all_passed: boolean;
  failing: Array<{
    rung: string;
    status: RungStatus;
    claim_if_passed: string;
    meaning: string;
    rule: string;
    problems: Array<{ check: string; detail: string; hint: string }>;
    evidence: BoardFact[] | Record<string, BoardFact>;
  }>;
}

export interface MatterRung {
  id: string;
  status: RungStatus | "skipped";
  label: string | null;
  check: string;
  detail: string;
}
export interface MatterViewer {
  format: "matter-candidate/1";
  n: number;
  dx_mm: number;
  thickness_mm: number;
  chip: [number, number, number, number];
  mask: string[];
  field: { n: number; units: string; T_inf: number; peak: number; T: Array<Array<number | null>> };
}
export interface MatterBaseline {
  peak_temp_c: number;
  delta_k: number;
  cells: number;
  params: Record<string, number>;
}
export interface MatterSimulation {
  ok: true;
  generator: string;
  gen_params: Record<string, number>;
  spreader: Record<string, number>;
  ladder: MatterRung[];
  first_failure: string | null;
  metrics: { peak_temp_c: number; peak_rise_k: number; material_cells: number; material_fraction: number; heat_balance_rel: number };
  baselines: { equal_material: MatterBaseline; full_budget: MatterBaseline };
  verdict: {
    label: string;
    delta_equal_material_k: number;
    delta_full_budget_k: number;
    lower_bound_peak_c: number;
    gap_closed_vs_full_budget: number | null;
    beats_equal_material: boolean;
    beats_full_budget: boolean;
    note: string;
  } | null;
  viewer: MatterViewer;
  limits: string[];
  source: string;
  timings_ms: number;
  stl?: { base64: string; bytes: number; sha256: string; units: string };
}

export type ApiFailure =
  | { ok: false; kind: "field"; status: number; message: string; fields: Array<{ path: string; message: string }> }
  | { ok: false; kind: "rate"; status: 429; message: string; retryAfterS: number | null }
  | { ok: false; kind: "too_large"; status: 413; message: string }
  | { ok: false; kind: "disabled"; status: number; message: string }
  | { ok: false; kind: "server"; status: number; message: string }
  | { ok: false; kind: "network"; status: 0; message: string };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/** The documented ranges (matter/HOSTING.md). The server validates again; a 422 names the offending field. */
export const MATTER_GENERATORS = {
  rect_fins: {
    label: "Rectangular fins",
    params: [
      { key: "spine", label: "Spine width", min: 6, max: 12, step: 1, def: 8, unit: "cells" },
      { key: "n_fins", label: "Fins", min: 2, max: 14, step: 1, def: 8, unit: "" },
      { key: "fin_w", label: "Fin width", min: 2, max: 4, step: 1, def: 3, unit: "cells" },
      { key: "fin_len", label: "Fin length", min: 4, max: 24, step: 1, def: 16, unit: "cells" },
    ],
  },
  radial_spokes: {
    label: "Radial spokes",
    params: [
      { key: "n_spokes", label: "Spokes", min: 4, max: 16, step: 1, def: 8, unit: "" },
      { key: "spoke_w", label: "Spoke width", min: 2, max: 4, step: 1, def: 3, unit: "cells" },
      { key: "ring_r", label: "Hub radius", min: 4, max: 9, step: 1, def: 6, unit: "cells" },
      { key: "length", label: "Spoke length", min: 10, max: 29, step: 1, def: 20, unit: "cells" },
    ],
  },
} as const;
export type MatterGenerator = keyof typeof MATTER_GENERATORS;

export const MATTER_SPREADER = [
  { key: "Q", label: "Chip power", min: 0.1, max: 100, step: 0.1, def: 2, unit: "W" },
  { key: "budget_fraction", label: "Material limit", min: 0.05, max: 0.9, step: 0.05, def: 0.4, unit: "" },
  { key: "h", label: "Convection h", min: 2, max: 500, step: 1, def: 15, unit: "W/m²K" },
  { key: "k", label: "Conductivity k", min: 5, max: 500, step: 5, def: 200, unit: "W/mK" },
] as const;

type Raw = { ok?: boolean; error?: { code?: string; message?: string; field?: string; errors?: Array<{ path?: string; message?: string }> } } | null;

/** Turns any HTTP outcome into a typed result. `fetchImpl` is injectable for tests. */
export async function callApi<T>(path: string, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(path, { cache: "no-store", ...init });
  } catch {
    return { ok: false, kind: "network", status: 0, message: "The check service could not be reached." };
  }
  const text = await res.text();
  let json: Raw = null;
  try {
    json = JSON.parse(text) as Raw;
  } catch {
    // a non-JSON body (a platform error page) is handled below
  }
  if (res.ok && json && json.ok !== false) return { ok: true, data: json as unknown as T };
  const err = json?.error;
  const message = err?.message ?? `The service answered ${res.status}.`;
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    return { ok: false, kind: "rate", status: 429, message, retryAfterS: Number.isFinite(ra) && ra > 0 ? ra : null };
  }
  if (res.status === 413) return { ok: false, kind: "too_large", status: 413, message };
  if (err?.code === "disabled") return { ok: false, kind: "disabled", status: res.status, message };
  if (res.status === 400 || res.status === 422) {
    const fields = err?.errors?.length ? err.errors.map((e) => ({ path: e.path ?? "", message: e.message ?? "" })) : err?.field ? [{ path: err.field, message: err.message ?? "" }] : [];
    return { ok: false, kind: "field", status: res.status, message, fields };
  }
  if (res.status === 404 && !err) return { ok: false, kind: "server", status: 404, message: "The check service is not available on this deployment." };
  return { ok: false, kind: "server", status: res.status, message };
}

export const boardApi = {
  templates: () => callApi<{ templates: BoardTemplateSummary[] }>("/api/board/templates"),
  template: (id: string) => callApi<BoardTemplate & { ok: true }>(`/api/board/templates/${encodeURIComponent(id)}`),
  check: (design: string, header?: string) =>
    callApi<BoardCheck>("/api/board/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(header ? { design, header } : { design }) }),
  explain: (design: string, header?: string) =>
    callApi<BoardExplain>("/api/board/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(header ? { design, header } : { design }) }),
};

export interface SimulateInput {
  generator: MatterGenerator;
  gen_params: Record<string, number>;
  spreader: Record<string, number>;
  include_stl?: boolean;
}
export const matterApi = {
  simulate: (input: SimulateInput) => callApi<MatterSimulation>("/api/matter/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
};

/** Default controls from the documented ranges. */
export function defaultSimulateInput(generator: MatterGenerator = "rect_fins"): SimulateInput {
  return {
    generator,
    gen_params: Object.fromEntries(MATTER_GENERATORS[generator].params.map((p) => [p.key, p.def])),
    spreader: Object.fromEntries(MATTER_SPREADER.map((p) => [p.key, p.def])),
  };
}

/** The spreader fields to send: only values that differ from the server defaults need no special handling, so send all numbers set. */
export function validateLocally(input: SimulateInput): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  for (const p of MATTER_GENERATORS[input.generator].params) {
    const v = input.gen_params[p.key];
    if (!Number.isFinite(v) || v < p.min || v > p.max) out.push({ path: `gen_params.${p.key}`, message: `must be between ${p.min} and ${p.max}` });
  }
  for (const p of MATTER_SPREADER) {
    const v = input.spreader[p.key];
    if (!Number.isFinite(v) || v < p.min || v > p.max) out.push({ path: `spreader.${p.key}`, message: `must be between ${p.min} and ${p.max}` });
  }
  return out;
}
