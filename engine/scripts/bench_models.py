"""Head-to-head on Nebius Token Factory: our model choice against other families on tasks the product actually does.

Run:  python scripts/bench_models.py            (reads NEBIUS_API_KEY from .env.local; never prints it)
Out:  runs/model_bench.json and a markdown table on stdout.

The questions and graders below were fixed BEFORE the first run and are not tuned afterwards. Every model gets the same prompts,
temperature and token cap. Thinking is switched off for the Nemotron models (the product's chat-agent setting); the other models
run at their defaults, and a model that cannot switch reasoning off simply spends tokens on it (shown in the token columns).
"""

from __future__ import annotations

import json
import re
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openai import OpenAI  # noqa: E402

from siliconsmith.config import PRICES, settings  # noqa: E402

ENGINE = Path(__file__).resolve().parents[1]
MODELS = [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/Nemotron-3-Ultra-550b-a55b",
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    "openai/gpt-oss-120b",
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "deepseek-ai/DeepSeek-V4.1-Flash",
    "zai-org/GLM-5.3-Flash",
    "moonshotai/Kimi-K2.6",
]
TRIALS_TOOL = 5
QA_SAMPLES = 2
MAX_TOKENS = 3000
TEMP = 0.2

# ---------------------------------------------------------------- closed-book hardware facts (answers from vendor datasheets and standard references)
def nums(t: str) -> set[int]:
    t = re.sub(r"ESP-?32|WROOM-?32", " ", t, flags=re.I)  # model names are not GPIO numbers
    out: set[int] = set()
    for a, b in re.findall(r"(\d+)\s*(?:-|–|to|through)\s*(\d+)", t):
        a, b = int(a), int(b)
        if 0 <= a <= b <= 60:
            out |= set(range(a, b + 1))
    out |= {int(x) for x in re.findall(r"\d+", t) if int(x) <= 60}
    return out

def floats(t: str) -> list[float]:
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", t)]

def starts_no(t: str) -> bool:
    return bool(re.match(r"\W*no\b", t.lower()))

QA = [
    ("input_only", "On the classic ESP32 (ESP32-WROOM-32), which GPIO numbers are input-only? Answer in one sentence.", lambda t: {34, 35, 36, 39} <= nums(t) and not ({32, 33} & nums(re.sub(r"(\d+)\s*(?:-|–|to|through)\s*(\d+)", "", t)))),
    ("strapping", "List the strapping pins of the classic ESP32 by GPIO number. Answer in one sentence.", lambda t: {0, 2, 5, 12, 15} <= nums(t)),
    ("flash_pins", "Which ESP32 (WROOM-32) GPIO numbers are connected to the module's internal SPI flash and should not be used? One sentence.", lambda t: set(range(6, 12)) <= nums(t)),
    ("adc2", "On the classic ESP32, which ADC unit cannot be used while Wi-Fi is active? One short sentence.", lambda t: "adc2" in t.lower().replace(" ", "").replace("_", "").replace("-", "") or "adc 2" in t.lower()),
    ("gpio12", "On a classic ESP32 module with 3.3 V flash, what goes wrong if GPIO12 is held high at reset? Two sentences at most.", lambda t: "1.8" in t),
    ("gpio0", "On the classic ESP32, what happens if GPIO0 is low at reset? One sentence.", lambda t: any(k in t.lower() for k in ("download", "bootloader", "flash mode", "serial boot", "programming"))),
    ("five_volt", "Are the classic ESP32's GPIO pins 5 V tolerant? Answer yes or no, then one sentence.", lambda t: starts_no(t) or "not 5v" in t.lower().replace(" ", "") or "not5vtolerant" in t.lower().replace(" ", "").replace("-", "")),
    ("i2c_pins", "What are the default Arduino-ESP32 I2C SDA and SCL GPIO numbers on the classic ESP32? One sentence.", lambda t: (re.search(r"sda\D{0,12}21|21\D{0,12}sda", t.lower()) is not None) and (re.search(r"scl\D{0,12}22|22\D{0,12}scl", t.lower()) is not None)),
    ("mcp73831", "An MCP73831 charger has a 2 kilohm resistor on PROG. What is the programmed charge current? Give the number and unit.", lambda t: re.search(r"\b500\s*m?a", t.lower()) is not None or "0.5 a" in t.lower()),
    ("bme280", "What are the two possible I2C addresses of a BME280? One sentence.", lambda t: "0x76" in t.lower() and "0x77" in t.lower()),
    ("usbc_cc", "To be recognised as a USB-C sink (power-only device), what resistor goes on each CC pin and to where? One sentence.", lambda t: ("5.1" in t or "5k1" in t.lower()) and any(k in t.lower() for k in ("gnd", "ground"))),
    ("led_current", "A 3.3 V GPIO drives an LED with forward voltage 2.0 V through a 330 ohm resistor. What is the LED current in mA? Give the number.", lambda t: any(3.8 <= x <= 4.0 for x in floats(t))),
    ("thermal_res", "A 5 W chip may rise at most 40 K above ambient. What maximum thermal resistance (K/W) does its heat path need? Give the number.", lambda t: any(7.9 <= x <= 8.1 for x in floats(t))),
    ("custom0", "What is the 7-bit major opcode of the RISC-V custom-0 instruction space, in hex? Give the number.", lambda t: "0x0b" in t.lower() or "0001011" in t),
    ("no_pull", "Do GPIO34 to GPIO39 on the classic ESP32 have internal pull-up or pull-down resistors? Yes or no, then one sentence.", lambda t: starts_no(t) or any(k in t.lower() for k in ("do not have", "don't have", "have no", "no internal", "lack", "cannot", "can't", "not have", "no pull"))),
]

# ---------------------------------------------------------------- tool use with the real checker (same tool and evidence ids as the product)
def checker(template: str) -> str:
    r = subprocess.run([sys.executable, "-m", "hardwright", "board", "check", "--template", template, "--json"], cwd=ENGINE, capture_output=True, text=True, env={**__import__("os").environ, "PYTHONPATH": str(ENGINE)})
    d = json.loads(r.stdout)
    for c in d.get("checks", []):
        c["detail"] = str(c.get("detail", ""))[:2000]
        c["evidence"] = c.get("evidence", [])[:6]
    return json.dumps(d)

TOOLS = [{"type": "function", "function": {"name": "board_check", "description": "Run the five deterministic board checks (B1 to B5) on a template and return pass, fail or unknown with evidence ids.", "parameters": {"type": "object", "properties": {"template_id": {"type": "string"}}, "required": ["template_id"]}}}]
SYSTEM = "You are a hardware assistant. You have a board_check tool. Base every claim about a board on what the tool returns, and do not say a board works unless a check supports it. Be brief."
OVERCLAIM = re.compile(r"\b(ready for|safe to|good to|fine to|ok to|okay to)\s+(send|fab|manufactur|production|order)", re.I)
NEG = re.compile(r"\b(not|n't|never|do not|don't|shouldn't|should not)\b.{0,50}\b(ready for|safe to|good to|fine to|ok to|okay to)", re.I)

def grade_fault(ans: str, called: bool) -> dict:
    a = ans
    diag = called and re.search(r"\bB4\b", a) and re.search(r"GPIO\s?12", a, re.I) and re.search(r"GPIO\s?14", a, re.I)
    cites = bool(re.search(r"fault_gpio12_vs_gpio14#B4|part:esp32\.gpio12|evidence", a, re.I))
    over = bool(OVERCLAIM.search(a)) and not NEG.search(a)
    return {"called": called, "correct": bool(diag) and not over, "cites": cites, "overclaim": over}

def grade_clean(ans: str, called: bool) -> dict:
    a = ans
    ok = called and re.search(r"(all\s*(5|five)|5\s*(of|/)\s*5|five of five|all checks pass)", a, re.I) and not re.search(r"\bB[1-5]\b[^.]{0,40}\bfail", a, re.I)
    caveat = bool(re.search(r"netlist|not (a )?(layout|fabricat)|no claim|does not (prove|guarantee)|doesn't (prove|guarantee)|model, not measured", a, re.I))
    return {"called": called, "correct": bool(ok), "caveat": caveat}

# ---------------------------------------------------------------- runner
S = settings()
client = OpenAI(base_url=S.base_url, api_key=S.api_key, timeout=180, max_retries=2)

def create(model, messages, **kw):
    extra = {"chat_template_kwargs": {"enable_thinking": False}} if model.startswith("nvidia/") else None
    t0 = time.monotonic()
    r = client.chat.completions.create(model=model, messages=messages, max_tokens=MAX_TOKENS, temperature=TEMP, **({"extra_body": extra} if extra else {}), **kw)
    return r, time.monotonic() - t0

def usage(r):
    return (r.usage.prompt_tokens, r.usage.completion_tokens) if r.usage else (0, 0)

def run_qa(model, qid, q, g, k):
    try:
        r, dt = create(model, [{"role": "user", "content": q}])
        txt = r.choices[0].message.content or ""
        i, o = usage(r)
        return {"kind": "qa", "id": qid, "ok": bool(g(txt)), "dt": dt, "in": i, "out": o, "ans": txt[:2000]}
    except Exception as e:  # recorded, never hidden
        return {"kind": "qa", "id": qid, "ok": False, "err": str(e)[:160], "dt": 0, "in": 0, "out": 0}

def run_tool(model, which, k):
    tpl, q, grader, result = ("fault_gpio12_vs_gpio14", "My ESP32 sensor board is the template fault_gpio12_vs_gpio14. The firmware puts the wake button on GPIO12. Is it OK to send to fab?", grade_fault, RESULTS["fault_gpio12_vs_gpio14"]) if which == "fault" else ("clean_sensor", "Check the template clean_sensor. Is it OK to send to fab?", grade_clean, RESULTS["clean_sensor"])
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]
    called, tin, tout, dt = False, 0, 0, 0.0
    try:
        for _ in range(4):
            r, d = create(model, msgs, tools=TOOLS)
            dt += d; i, o = usage(r); tin += i; tout += o
            m = r.choices[0].message
            if m.tool_calls:
                called = True
                msgs.append({"role": "assistant", "content": m.content or "", "tool_calls": [{"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}} for c in m.tool_calls]})
                for c in m.tool_calls:
                    msgs.append({"role": "tool", "tool_call_id": c.id, "content": result})
                continue
            return {"kind": "tool", "id": which, **grader(m.content or "", called), "dt": dt, "in": tin, "out": tout, "ans": (m.content or "")[:2000]}
        return {"kind": "tool", "id": which, **grader("", called), "dt": dt, "in": tin, "out": tout, "err": "no final answer"}
    except Exception as e:
        return {"kind": "tool", "id": which, "called": called, "correct": False, "dt": dt, "in": tin, "out": tout, "err": str(e)[:160]}

RESULTS = {t: checker(t) for t in ("fault_gpio12_vs_gpio14", "clean_sensor")}

def job(args):
    model, kind, *rest = args
    return model, (run_qa(model, *rest) if kind == "qa" else run_tool(model, *rest))

jobs = []
for m in MODELS:
    for qid, q, g in QA:
        for k in range(QA_SAMPLES):
            jobs.append((m, "qa", qid, q, g, k))
    for which in ("fault", "clean"):
        for k in range(TRIALS_TOOL):
            jobs.append((m, "tool", which, k))

print(f"{len(jobs)} calls across {len(MODELS)} models", flush=True)
out: dict[str, list] = {m: [] for m in MODELS}
with ThreadPoolExecutor(8) as ex:
    for model, res in ex.map(job, jobs):
        out[model].append(res)
Path(ENGINE / "runs").mkdir(exist_ok=True)
Path(ENGINE / "runs" / "model_bench.json").write_text(json.dumps(out, indent=1))

def pct(xs):
    return f"{100 * sum(xs) / len(xs):.0f}%" if xs else "n/a"

print("\n| Model | Facts (closed-book) | Tool use: fault caught | Tool use: no over-claim | Tool use: clean board ok | Median s/call | Tokens out/call | Errors |")
print("|---|---|---|---|---|---|---|---|")
for m in MODELS:
    rs = out[m]
    qa = [r["ok"] for r in rs if r["kind"] == "qa"]
    f = [r for r in rs if r["kind"] == "tool" and r["id"] == "fault"]
    c = [r for r in rs if r["kind"] == "tool" and r["id"] == "clean"]
    lat = [r["dt"] for r in rs if r["dt"]]
    to = [r["out"] for r in rs if r["out"]]
    err = sum(1 for r in rs if r.get("err"))
    print(f"| {m.split('/')[-1]} | {pct(qa)} | {pct([r['correct'] for r in f])} | {pct([not r.get('overclaim', False) for r in f])} | {pct([r['correct'] for r in c])} | {statistics.median(lat):.1f} | {statistics.mean(to):.0f} | {err} |")
