"""`siliconsmith pr`: turn a bundle into a branch (and, only when asked, a pull request) on a TinyMaix checkout.

What the PR contains:
  hw/siliconsmith/rtl/*.v, hw/siliconsmith/include/ss_intrinsics.h, hw/siliconsmith/REPORT.md
  src/arch_rv32ss.h   TinyMaix's arch_cpu.h with tm_dot_prod replaced by the verified rewrite
  include/tm_port.h   new TM_ARCH_RV32SS option
  src/tm_layers*.c    #elif that selects arch_rv32ss.h

Nothing is pushed and no PR is opened unless --push / --open are given.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

PR_FOOTER = "\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n"
ARCH = "RV32SS"


class PrError(RuntimeError):
    pass


def _git(repo: Path, *args: str, check: bool = True) -> str:
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8")
    if check and r.returncode:
        raise PrError(f"git {' '.join(args)}: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


def extract_function(src: str, name: str) -> str:
    """The full text of `TM_INLINE void <name>(...) { ... }` (brace matched) from a C file."""
    m = re.search(rf"TM_INLINE\s+void\s+{re.escape(name)}\s*\(", src)
    if not m:
        raise PrError(f"function {name} not found")
    i = src.index("{", m.start())
    depth = 0
    for j in range(i, len(src)):
        depth += (src[j] == "{") - (src[j] == "}")
        if depth == 0:
            return src[m.start():j + 1]
    raise PrError(f"unbalanced braces in {name}")


def build_arch_header(arch_cpu: str, patched: str, fn: str, ins: list[str]) -> str:
    """arch_cpu.h with `fn` swapped for the bundle's verified version."""
    new, old = extract_function(patched, fn), extract_function(arch_cpu, fn)
    body = arch_cpu.replace(old, new, 1)
    banner = (f"/* arch_rv32ss.h: TinyMaix on a RISC-V core with SiliconSmith custom instructions "
              f"({', '.join(ins)}).\n * Generated from arch_cpu.h: only {fn}() differs. Requires "
              f"hw/siliconsmith/include on the include path and the RTL in hw/siliconsmith/rtl.\n"
              f" * The rewrite reads int8 buffers as 32-bit words: sptr and kptr must be 4-byte aligned. */\n"
              f'#include "ss_intrinsics.h"\n')
    return banner + body


def _insert_elif(text: str, anchor_arch: str = "RV32P") -> str:
    key = f"#elif TM_ARCH==TM_ARCH_{anchor_arch}\n"
    block = f'#elif TM_ARCH==TM_ARCH_{ARCH}\n    #include "arch_rv32ss.h"\n'
    if f"TM_ARCH_{ARCH}" in text:
        return text
    if key not in text:
        raise PrError("tm_layers: arch selection chain not found")
    return text.replace(key, block + key, 1)


def prepare(bundle: Path, repo: Path, fn: str, branch: str | None = None) -> dict:
    bundle, repo = Path(bundle), Path(repo)
    if _git(repo, "status", "--porcelain"):
        raise PrError("the TinyMaix checkout has uncommitted changes")
    report = (bundle / "REPORT.md").read_text(encoding="utf-8")
    patched = (bundle / "src" / "tm_dot.h").read_text(encoding="utf-8")
    ins = re.findall(r"^\| `([^`]+)` \|", report, re.M)
    branch = branch or f"siliconsmith/{fn}"
    _git(repo, "checkout", "-q", "-B", branch)

    hw = repo / "hw" / "siliconsmith"
    shutil.rmtree(hw, ignore_errors=True)
    (hw / "rtl").mkdir(parents=True)
    (hw / "include").mkdir()
    for f in (bundle / "rtl").glob("*.v"):
        shutil.copy(f, hw / "rtl" / f.name)
    shutil.copy(bundle / "include" / "ss_intrinsics.h", hw / "include" / "ss_intrinsics.h")
    shutil.copy(bundle / "REPORT.md", hw / "REPORT.md")

    arch_cpu = (repo / "src" / "arch_cpu.h").read_text(encoding="utf-8")
    (repo / "src" / "arch_rv32ss.h").write_text(build_arch_header(arch_cpu, patched, fn, ins), encoding="utf-8", newline="\n")

    port = repo / "include" / "tm_port.h"
    t = port.read_text(encoding="utf-8")
    if f"TM_ARCH_{ARCH}" not in t:
        t = t.replace("#define TM_ARCH_X86_SSE2    (7) //x86 sse2\n",
                      f"#define TM_ARCH_X86_SSE2    (7) //x86 sse2\n#define TM_ARCH_{ARCH}      (8) //RISC-V + SiliconSmith custom instructions (hw/siliconsmith)\n", 1)
    port.write_text(t, encoding="utf-8", newline="\n")
    for name in ("tm_layers.c", "tm_layers_O1.c"):
        p = repo / "src" / name
        p.write_text(_insert_elif(p.read_text(encoding="utf-8")), encoding="utf-8", newline="\n")

    speedup = re.search(r"\*\*([\d.]+)x faster\*\*", report)
    wall = re.search(r"\*\*Wall-clock: ([\d.]+)x\*\*", report)
    title = f"Add SiliconSmith custom instruction{'s' if len(ins) > 1 else ''} for {fn} ({', '.join(ins)})"
    body = (f"SiliconSmith invented, implemented and verified {len(ins)} custom RISC-V instruction(s) for "
            f"`{fn}`: {', '.join(f'`{i}`' for i in ins)}.\n"
            + (f"\n**{speedup.group(1)}x fewer cycles**" if speedup else "")
            + (f", **{wall.group(1)}x wall-clock** after Fmax" if wall else "")
            + ".\n\n## What changes\n"
              "- `hw/siliconsmith/`: the custom-instruction RTL (PicoRV32 PCPI slot), the `ss_intrinsics.h` header and the full report.\n"
              f"- `src/arch_rv32ss.h` + `TM_ARCH_{ARCH}`: `arch_cpu.h` with only `{fn}` replaced. Off-target builds fall back to the C reference.\n"
              "- Caveat: the rewrite reads int8 buffers as 32-bit words, so they must be 4-byte aligned.\n\n---\n\n"
            + report)
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=SiliconSmith", "-c", "user.email=siliconsmith@users.noreply.github.com",
         "commit", "-q", "-m", title)
    return {"branch": branch, "title": title, "body": body + PR_FOOTER, "repo": str(repo)}


def push_and_open(info: dict, remote: str = "origin", base: str = "main", upstream: str | None = None) -> str:
    """Outward-facing: pushes the branch and opens a PR. Only reached with --push --open."""
    repo = Path(info["repo"])
    _git(repo, "push", "-u", remote, info["branch"])
    cmd = ["gh", "pr", "create", "--title", info["title"], "--body", info["body"], "--base", base]
    if upstream:
        cmd += ["--repo", upstream, "--head", f"{_git(repo, 'remote', 'get-url', remote).split('/')[-2]}:{info['branch']}"]
    r = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise PrError(f"gh pr create: {r.stderr.strip()[:300]}")
    return r.stdout.strip()
