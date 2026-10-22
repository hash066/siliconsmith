# Hosted Board and Matter functions

Python functions served by Vercel next to the Next.js app (`web/` is the project root). They are **free and deterministic**: no model, no key, no Sandboxes.

| URL | Function | What it serves |
|---|---|---|
| `GET /api/board/templates`, `/api/board/templates/{id}`, `/api/board/schema`, `/api/board/parts`, `/api/board/faults` | `api/board.py` | the 3 real templates, the design JSON schema, the parts library, the fault catalogue |
| `POST /api/board/check`, `POST /api/board/explain` | `api/board.py` | rungs B1 to B5 on a design (and the C pin header); a plain-language reading of a failure |
| `POST /api/matter/simulate` | `api/matter.py` | a built-in generator through the validated solver and ladder M1 to M5, with the `matter-candidate/1` viewer artifact |

Not served (answer `404` with code `disabled`): `POST /api/board/run` unless the server env `BOARD_RUN_ENABLED=1` is set (it also needs `openai` and `NEBIUS_API_KEY`, neither shipped), and `POST /api/matter/run`, which needs Sandboxes and is never served here.

## How the engine gets into the bundle

The engine package lives outside `web/`. `npm run build` runs `scripts/vendor-engine.mjs` first (`prebuild`), which copies `../engine/siliconsmith/{__init__.py,board,matter}` (without tests, evals and evidence) into `api/_vendor/` (gitignored), and the evidence library into `public/library/` (gitignored). **The Vercel project must have "Include source files outside of the Root Directory in the Build Step" enabled** (the default) or the engine is missing and these functions fail.

`vercel.json` sets `maxDuration`, `includeFiles` for the vendored package, an `excludeFiles` for test directories, and rewrites `/api/board/*` and `/api/matter/*` to the two functions as `?route=...`; `api/_gateway.py` accepts either the original path or `route`, because how the Vercel runtime shows the path after a rewrite was not verified here.

`requirements.txt`: `pydantic`, `numpy`, `scipy`.

## Run and test locally (no Vercel login)

```bash
npm run prebuild                              # vendors the engine
python scripts/serve_api_local.py 8765        # the very `handler` classes Vercel runs, on a plain HTTP server
LOCAL_PYTHON_API=http://127.0.0.1:8765 npm run build && LOCAL_PYTHON_API=http://127.0.0.1:8765 npx next start
npm run e2e:hosted                            # starts its own server and checks 21 behaviours, including 429 and the agent tools
```

`LOCAL_PYTHON_API` only adds Next rewrites to that server for local runs; on Vercel the functions answer directly.

## Limits and honesty

Rate limits (`BOARD_CHECKS_PER_MIN` 120, Matter simulate 30 per minute) are in process memory per instance: a courtesy guard, not a global guarantee. Responses carry the engine's own notices (netlist-level only, author-curated facts, 2D steady-state model, not validated on a printed part).

## Bundle size (measured, not deployed)

Linux x86-64 wheels for Python 3.12, installed with `pip install --target ... --platform manylinux2014_x86_64 --only-binary=:all: -r requirements.txt`: **216.2 MB unzipped**, **175.4 MB** without `tests/` and `__pycache__` directories, plus **0.4 MB** of vendored engine. Under the 250 MB unzipped limit, but both functions share one `requirements.txt`, so each carries numpy and scipy. Cold start and Vercel's own packaging overhead were not measured.
