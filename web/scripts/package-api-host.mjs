// (Hardwright live Silicon: maxDuration is 300 s because POST /api/silicon/run streams a run of up to 280 s.)
// Packages the hosted Python functions as their own small Vercel project (framework "Other").
//
// Why: in a Next.js project, Vercel's Next builder owns the whole project and ignores root-level api/*.py, so the Board and
// Matter functions must live in a separate project. The main site proxies /api/board/* and /api/matter/* to it (next.config.ts),
// so the browser stays same-origin.
//
//   node scripts/vendor-engine.mjs && node scripts/package-api-host.mjs [outDir]
//   cd <outDir> && vercel link --yes --project siliconsmith-api && vercel deploy --prod --yes
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const out = resolve(process.argv[2] ?? join(web, "..", "..", "siliconsmith-api-host"));

if (!existsSync(join(web, "api", "_vendor", "siliconsmith"))) {
  console.error("api/_vendor is missing: run `node scripts/vendor-engine.mjs` first");
  process.exit(1);
}
// keep a previous .vercel link, replace everything else
for (const e of ["api", "_vendor", "workloads", "app.py", "requirements.txt", "vercel.json", ".vercelignore"]) rmSync(join(out, e), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(web, "api", "_vendor"), join(out, "_vendor"), { recursive: true });

// The live Silicon pipeline (siliconsmith/live) reuses the engine's Search, ladder and prompts. Copy exactly the modules it
// imports, straight from the engine source (vendor-engine.mjs only ships board + matter). Nothing here runs a toolchain: the
// host imports tools/ for its types, and every model-written Verilog or C file runs only inside the Token Factory Sandbox.
const engine = resolve(web, "..", "engine", "siliconsmith");
const keep = (p) => !p.split(/[\\/]/).some((seg) => seg === "__pycache__" || seg === "tests") && !/\.(md|pyc|sh)$/.test(p);
for (const f of ["config.py", "paths.py", "llm.py", "events.py", "search.py", "backends.py", "worker.py", "ladder.py", "hwgen.py", "bundle.py"])
  cpSync(join(engine, f), join(out, "_vendor", "siliconsmith", f));
for (const d of ["agent", "tools", "live"])
  cpSync(join(engine, d), join(out, "_vendor", "siliconsmith", d), { recursive: true, filter: keep });
// paths.py resolves workloads/ next to _vendor/ (ROOT = the folder above the one holding the package): only the two public ones
for (const w of ["w1_tinymaix_fc", "w2_monocypher_chacha20"])
  cpSync(join(web, "..", "workloads", w), join(out, "workloads", w), { recursive: true, filter: keep });

writeFileSync(join(out, "requirements.txt"), ["fastapi>=0.110", "pydantic>=2.6", "numpy>=1.26", "scipy>=1.11", "openai>=1.40", "contree-sdk==0.3.6", ""].join("\n"));

// One ASGI app (Vercel's Python runtime looks for an app entrypoint). The engine's own routers carry the contracts.
// The model-spending run routes are blocked here: this host serves only free, deterministic endpoints.
writeFileSync(join(out, "app.py"), `"""Hosted SiliconSmith workbench API: Board checks and Matter simulation (free, deterministic, no model) and the live
Silicon run (POST /api/silicon/run: spends Token Factory credits, needs NEBIUS_API_KEY in THIS project's environment)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_vendor"))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from siliconsmith.board.api import router as board_router  # noqa: E402
from siliconsmith.matter.api import make_router as make_matter_router  # noqa: E402
from siliconsmith.live.http import make_router as make_silicon_router  # noqa: E402
from siliconsmith.board.layout.http import make_router as make_layout_router  # noqa: E402

app = FastAPI(title="SiliconSmith workbenches (hosted)", docs_url=None, redoc_url=None, openapi_url=None)
BLOCKED = {"/api/board/run", "/api/matter/run"}


@app.middleware("http")
async def block_model_routes(request: Request, call_next):
    if request.url.path.rstrip("/") in BLOCKED:
        return JSONResponse({"ok": False, "error": {"code": "disabled", "message": "agent runs are not served by the hosted API", "errors": []}}, status_code=404)
    return await call_next(request)


app.include_router(board_router)
app.include_router(make_matter_router())
app.include_router(make_silicon_router())
app.include_router(make_layout_router())


@app.get("/api/health")
def health():
    return {"ok": True, "workbenches": ["board", "matter", "silicon"], "model_calls": "silicon live run only", "silicon_configured": bool(os.environ.get("NEBIUS_API_KEY"))}
`);
writeFileSync(join(out, "vercel.json"), JSON.stringify({ functions: { "app.py": { maxDuration: 300, memory: 1024 } } }, null, 2));
writeFileSync(join(out, ".vercelignore"), ["**/__pycache__", "**/*.pyc", ".env", ".env.*", ""].join("\n"));
console.log(`packaged to ${out}`);
