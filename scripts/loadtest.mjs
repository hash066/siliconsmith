// Dependency-free load test for the web app: `node scripts/loadtest.mjs <base-url> [concurrency] [seconds]`.
// Each virtual user loops over the pages and the replay files a visitor loads (landing, how, a run, a report, a replay)
// and records latency per request. Exits non-zero if the error rate is above 1% or p95 above 3 s.
const base = (process.argv[2] ?? "http://localhost:3200").replace(/\/$/, "");
const users = Number(process.argv[3] ?? 200);
const seconds = Number(process.argv[4] ?? 30);

const paths = [
  "/",
  "/how",
  "/try",
  "/runs/r_w1_contree3",
  "/runs/r_w1_contree3/report",
  "/replays/r_w1_contree3.ndjson",
  "/runs/r_w2_final3",
  "/replays/r_w2_final3.ndjson",
];

const lat = [];
let errors = 0;
let bytes = 0;
const end = Date.now() + seconds * 1000;

async function user(id) {
  let i = id % paths.length;
  while (Date.now() < end) {
    const p = paths[i++ % paths.length];
    const t0 = performance.now();
    try {
      const res = await fetch(base + p, { headers: { "accept-encoding": "gzip" } });
      const buf = await res.arrayBuffer();
      bytes += buf.byteLength;
      if (!res.ok) errors++;
    } catch {
      errors++;
    }
    lat.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 600)); // think time
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: users }, (_, i) => user(i)));
const secs = (Date.now() - t0) / 1000;
lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))];
const out = {
  base,
  users,
  seconds: Math.round(secs),
  requests: lat.length,
  rps: Math.round(lat.length / secs),
  errors,
  errorRate: +(errors / lat.length).toFixed(4),
  p50_ms: Math.round(q(0.5)),
  p95_ms: Math.round(q(0.95)),
  p99_ms: Math.round(q(0.99)),
  mb: +(bytes / 1e6).toFixed(1),
};
console.log(JSON.stringify(out, null, 2));
process.exit(out.errorRate > 0.01 || out.p95_ms > 3000 ? 1 : 0);
