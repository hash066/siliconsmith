# Model comparison on Nebius Token Factory (measured Oct 30 2026)

A small, reproducible head-to-head: our Nemotron choice against other model families served on the same Token Factory endpoint. Script: `engine/scripts/bench_models.py` (re-grade helper: `engine/scripts/regrade_models.py`). Raw output: `engine/runs/model_bench.json` (not committed).

## Method

- 8 models, same prompts, temperature 0.2, 3,000 token cap, one endpoint. Thinking is switched off for the Nemotron models (the product's chat-agent setting); the other models ran at their defaults.
- **Tool use with the real checker** (the product's core job): the model has a `board_check` tool backed by the real Hardwright checker. Two tasks, 5 trials each: the faulty board (firmware says GPIO12, netlist wires GPIO14) and the clean board. Graded by rule: tool called, B4 named with both pins, and no "safe to fab" over-claim; for the clean board, five of five pass and no invented failure.
- **Closed-book hardware facts**: 15 questions with checkable answers (ESP32 input-only and strapping pins, flash pins, ADC2 and Wi-Fi, GPIO12 at reset, USB-C CC resistors, MCP73831 charge current, BME280 addresses, an LED current and a thermal-resistance calculation, the RISC-V custom-0 opcode), 2 samples each, graded by rule.
- The questions and graders were fixed before the first run. After run 1 we audited the failures and fixed two grader bugs that penalised every model (an ESP32 model name such as "WROOM-32" was read as GPIO32, and the I2C check only accepted one word order). We then re-ran everything once with full answers saved. Run 1 and run 2 are both reported; nothing else was changed.

## Result (run 2, corrected graders)

| Model | Closed-book facts | Tool use: fault caught | Tool use: no over-claim | Tool use: clean board ok | Median s per call | Output tokens per call |
|---|---|---|---|---|---|---|
| DeepSeek-V4.1-Flash | 100% | 100% | 100% | 100% | 3.1 | 280 |
| Kimi-K2.6 | 100% | 100% | 100% | 80% | 4.2 | 653 |
| gpt-oss-120b | 93% | 100% | 100% | 100% | 0.9 | 203 |
| GLM-5.3-Flash | 87% | 100% | 100% | 100% | 3.1 | 358 |
| **Nemotron 3 Ultra** | 83% | 100% | 100% | 100% | **0.9** | **47** |
| **Nemotron 3 Super** (our chat agent and engineer) | 73% | 100% | 100% | 100% | 2.2 | 144 |
| Qwen3-235B-A22B-Instruct-2507 | 67% | 100% | 100% | 100% | 0.9 | 112 |
| **Nemotron 3 Nano** (triage) | 63% | 100% | 100% | 100% | 1.0 | 78 |

Run 1 (first graders) showed the same pattern for tool use and, for closed-book facts, 93% Kimi, 90% GLM, 87% gpt-oss and DeepSeek, 70% Super, 67% Ultra, 60% Qwen, 47% Nano.

## What this does and does not say

- **Tool use, the thing the product depends on, is a tie:** all eight models called the checker, caught the fault, and none claimed the board was ready for fab. Nemotron Super and Ultra were 100% on every tool-use trial.
- **From memory, Nemotron is not the most accurate.** On pin and part facts Ultra scored 83% and Super 73%, below DeepSeek-V4.1-Flash and Kimi-K2.6 (100%). We do not claim otherwise. That is the point of Hardwright: facts come from checkers and curated part data, not from model recall, and the agent may only cite what a checker returned. For example, in run 2 Super named ADC1 instead of ADC2 as the unit Wi-Fi blocks (both samples), called GPIO6 to 11 the input-only pins, and got the GPIO12 reset behaviour wrong once; with the checker tool the same model reports the strapping pin from the checker's evidence instead.
- **Nemotron's edge here is speed and token economy:** Ultra answered in a median 0.9 s using 47 output tokens per call, against 200 to 650 for the reasoning-heavy models. Prices for the non-Nemotron models were not in our price table, so we do not compare cost.
- **Limits:** one task family, 30 closed-book samples and 10 tool trials per model, one temperature, one run plus one corrected re-run. It is not a general ranking of the models.

## Why we still chose Nemotron

Tool-calling reliability on our task matched the best models; three sizes on one endpoint let us route by difficulty (Ultra to design and diagnose, Super to implement, Nano to triage); latency and tokens per call were low; and the whole product is built to be model-agnostic about facts, because the checkers decide what is true.
