// Copies the engine packages the hosted Python functions need into web/api/_vendor/ (gitignored).
// Runs as `prebuild`. The engine lives outside web/, so Vercel must be allowed to include files outside the root directory.
//   needed: siliconsmith/__init__.py, board/, matter/ (the shared modules siliconsmith.llm/config/events/paths are imported
//   lazily by the agent run routes only, and those routes are disabled in the hosted build, so they are not shipped).
import { cpSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const src = resolve(web, "..", "engine", "siliconsmith");
const dest = join(web, "api", "_vendor", "siliconsmith");

if (!existsSync(src)) {
  console.warn(`[vendor-engine] ${src} not found: the hosted Board/Matter functions will not work in this build.`);
  process.exit(0);
}
rmSync(join(web, "api", "_vendor"), { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(src, "__init__.py"), join(dest, "__init__.py"));

// Matched against the path relative to the engine package, with forward slashes.
const SKIP_DIRS = new Set(["__pycache__", "evidence", "tests", "test"]);
const SKIP_FILES = new Set(["evals.py", "heldout.py", "build_sandbox_image.py"]);
const SKIP_EXT = [".md", ".sh", ".pyc"];
const SKIP = { test: (rel) => rel.split("/").some((seg) => SKIP_DIRS.has(seg) || SKIP_FILES.has(seg)) || SKIP_EXT.some((e) => rel.endsWith(e)) };
for (const pkg of ["board", "matter"]) {
  cpSync(join(src, pkg), join(dest, pkg), { recursive: true, filter: (p) => !SKIP.test(resolve(p).slice(src.length).split(String.fromCharCode(92)).join("/")) });
}

const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
console.log(`[vendor-engine] copied board + matter to api/_vendor (${(size(join(web, "api", "_vendor")) / 1024).toFixed(0)} KB)`);

// The evidence library (repo-root evidence/: manifests and artifacts built from real passing runs) is served read-only
// as /library/* and read by the agent tools. Copied here so it ships with the app; never edited by the web build.
const evidence = resolve(web, "..", "evidence");
const libDest = join(web, "public", "library");
rmSync(libDest, { recursive: true, force: true });
if (existsSync(evidence)) {
  cpSync(evidence, libDest, { recursive: true });
  console.log(`[vendor-engine] copied evidence library to public/library (${(size(libDest) / 1024).toFixed(0)} KB)`);
} else {
  console.warn("[vendor-engine] evidence/ not found: the Library will show no stored entries in this build.");
}
