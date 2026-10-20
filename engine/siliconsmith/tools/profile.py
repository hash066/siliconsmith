"""Profile: instruction-fetch histogram → hot functions, hot source lines, hot disassembly."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

from .build import RV_PREFIX, run


@dataclass
class Hotspot:
    function: str
    file: str
    line_start: int
    line_end: int
    pct: float
    fetches: int


def read_histogram(path: Path) -> dict[int, int]:
    hist: dict[int, int] = {}
    for ln in path.read_text().splitlines():
        a, c = ln.split()
        hist[int(a, 16)] = int(c)
    return hist


def symbolize(elf: Path, addrs: list[int]) -> dict[int, tuple[str, str, int]]:
    """addr → (innermost function, file, line), resolving inlined frames."""
    if not addrs:
        return {}
    r = run([f"{RV_PREFIX}addr2line", "-f", "-i", "-a", "-e", elf, *[hex(a) for a in addrs]])
    out: dict[int, tuple[str, str, int]] = {}
    cur: int | None = None
    lines = r.stdout.splitlines()
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("0x"):
            cur = int(ln, 16)
            i += 1
            continue
        if cur is not None and cur not in out and i + 1 < len(lines):
            func, loc = ln.strip(), lines[i + 1].strip()
            file, _, line = loc.rpartition(":")
            line = line.split(" ")[0]
            out[cur] = (func, Path(file).name if file else "??", int(line) if line.isdigit() else 0)
            i += 2
            continue
        i += 1
    return out


def analyze(elf: Path, hist_path: Path, top: int = 5) -> dict:
    hist = read_histogram(hist_path)
    total = sum(hist.values()) or 1
    sym = symbolize(elf, sorted(hist))
    by_func: Counter[str] = Counter()
    by_line: dict[tuple[str, str], Counter[int]] = defaultdict(Counter)
    for a, c in hist.items():
        func, file, line = sym.get(a, ("??", "??", 0))
        by_func[func] += c
        by_line[(func, file)][line] += c
    hotspots = []
    for func, c in by_func.most_common(top):
        files = [(k, v) for k, v in by_line.items() if k[0] == func]
        (_, file), lines = max(files, key=lambda kv: sum(kv[1].values()))
        real = [ln for ln in lines if ln > 0]
        hotspots.append(Hotspot(func, file, min(real or [0]), max(real or [0]),
                                round(100.0 * c / total, 2), c))
    return {"total_fetches": total, "hotspots": [asdict(h) for h in hotspots]}


def disassemble_hot(elf: Path, hist_path: Path, max_lines: int = 160) -> str:
    """Disassembly of the hottest address range with fetch counts, for the agent's prompt."""
    hist = read_histogram(hist_path)
    if not hist:
        return ""
    total = sum(hist.values())
    hot = sorted(a for a, c in hist.items() if c >= 0.002 * total)
    lo, hi = min(hot), max(hot) + 4
    r = run([f"{RV_PREFIX}objdump", "-d", "--no-show-raw-insn", "-M", "no-aliases",
             f"--start-address={lo:#x}", f"--stop-address={hi:#x}", elf])
    out = []
    for ln in r.stdout.splitlines():
        s = ln.strip()
        if ":" in s and s.split(":")[0].strip().isalnum():
            try:
                a = int(s.split(":")[0], 16)
                out.append(f"{hist.get(a, 0):>8}  {s}")
                continue
            except ValueError:
                pass
        if s.endswith(">:"):
            out.append(s)
    return "\n".join(out[:max_lines])
