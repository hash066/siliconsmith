// Number formatting for the instrument: fixed decimals per metric, separators, signs on changes.

export const int = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US"));

export const times = (n: number | null | undefined, digits = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}×`);

export const pct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;

export const mhz = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}`);

export function usd(n: number, digits?: number): string {
  const d = digits ?? (n < 0.01 ? 4 : n < 1 ? 3 : 2);
  return `$${n.toFixed(d)}`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Run time as m:ss (or h:mm:ss). */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}
export const sha8 = (s: string) => s.slice(0, 12);
