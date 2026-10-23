// Matter game: slider ranges (from engine/siliconsmith/matter/HOSTING.md), the request, the response and the plate colours.

export const MATTER_RANGES = {
  n_fins: { min: 2, max: 14, step: 1, label: "Fins" },
  fin_len: { min: 4, max: 24, step: 1, label: "Fin length (cells)" },
  budget_fraction: { min: 0.05, max: 0.9, step: 0.05, label: "Material budget (fraction of the plate)" },
} as const;

export interface MatterParams {
  n_fins: number;
  fin_len: number;
  budget_fraction: number;
}
export const MATTER_DEFAULT: MatterParams = { n_fins: 8, fin_len: 16, budget_fraction: 0.4 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export function clampParams(p: MatterParams): MatterParams {
  const r = MATTER_RANGES;
  return {
    n_fins: Math.round(clamp(p.n_fins, r.n_fins.min, r.n_fins.max)),
    fin_len: Math.round(clamp(p.fin_len, r.fin_len.min, r.fin_len.max)),
    budget_fraction: Math.round(clamp(p.budget_fraction, r.budget_fraction.min, r.budget_fraction.max) * 100) / 100,
  };
}

export function simulateBody(p: MatterParams) {
  const c = clampParams(p);
  return { generator: "rect_fins", gen_params: { n_fins: c.n_fins, fin_len: c.fin_len }, spreader: { budget_fraction: c.budget_fraction } };
}

/** The payload for `toHref({wb:'matter', params})`. */
export function matterDeepParams(p: MatterParams) {
  return simulateBody(p);
}

export interface MatterRung {
  id: string;
  status: string;
  label: string | null;
  check: string;
  detail: string;
}
export interface Baseline {
  peak_temp_c: number;
  delta_k: number | null;
  cells: number;
}
export interface Viewer {
  n: number;
  chip: [number, number, number, number];
  mask: string[];
  field: { T_inf: number; peak: number; T: (number | null)[][] };
}
export interface SimResponse {
  ok: boolean;
  ladder: MatterRung[];
  first_failure: string | null;
  metrics: { peak_temp_c?: number; material_cells?: number; material_fraction?: number };
  baselines: { equal_material: Baseline | null; full_budget: Baseline | null };
  verdict: null | {
    label: string;
    delta_equal_material_k: number | null;
    delta_full_budget_k: number | null;
    lower_bound_peak_c: number | null;
    beats_equal_material: boolean;
    beats_full_budget: boolean;
    note: string;
  };
  viewer?: Viewer | null;
  limits?: string[];
}

export type MatterGrade = "beats-both" | "beats-equal" | "no-beat" | "no-solve";

/** How the result reads against the two real baselines. `no-solve` means the ladder stopped before a temperature existed. */
export function gradeMatter(r: SimResponse): MatterGrade {
  if (r.metrics.peak_temp_c === undefined || !r.verdict) return "no-solve";
  if (r.verdict.beats_equal_material && r.verdict.beats_full_budget) return "beats-both";
  if (r.verdict.beats_equal_material) return "beats-equal";
  return "no-beat";
}

export interface Bar {
  key: string;
  label: string;
  peak: number;
}
/** Bars for the peak-temperature chart, lowest first, only from numbers the response carries. */
export function peakBars(r: SimResponse): Bar[] {
  const bars: Bar[] = [];
  if (r.metrics.peak_temp_c !== undefined) bars.push({ key: "you", label: "Your plate", peak: r.metrics.peak_temp_c });
  if (r.baselines.equal_material) bars.push({ key: "eq", label: "Equal-material fins", peak: r.baselines.equal_material.peak_temp_c });
  if (r.baselines.full_budget) bars.push({ key: "full", label: "Full-budget fins", peak: r.baselines.full_budget.peak_temp_c });
  return bars;
}

// ---------- plate colours ----------

type RGB = [number, number, number];
const STOPS: RGB[] = [
  [38, 52, 120], // cool
  [64, 112, 190],
  [86, 176, 164],
  [246, 206, 86],
  [240, 120, 52],
  [190, 36, 40], // hot
];

/** Temperature to colour on a cool-to-hot ramp; t is clamped between T_inf and peak. */
export function tempColor(T: number, tMin: number, tMax: number): RGB {
  const f = tMax > tMin ? clamp((T - tMin) / (tMax - tMin), 0, 1) : 0;
  const x = f * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const u = x - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * u)) as RGB;
}

/** RGBA pixels for the viewer: row 0 of the image is the top, model row j=0 is the bottom. Cells without material are transparent. */
export function plateRgba(v: Viewer): { data: Uint8ClampedArray; n: number } {
  const n = v.n;
  const data = new Uint8ClampedArray(n * n * 4);
  for (let j = 0; j < n; j++) {
    const row = v.field.T[j] ?? [];
    for (let i = 0; i < n; i++) {
      const T = row[i];
      if (T === null || T === undefined) continue;
      const [r, g, b] = tempColor(T, v.field.T_inf, v.field.peak);
      const o = ((n - 1 - j) * n + i) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return { data, n };
}
