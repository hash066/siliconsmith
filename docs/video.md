# Demo video script (target 2:50, hard limit 3:00)

Rule: only real footage and real numbers. Every screen below is a real run (`r_w1_contree3`) or a real terminal session.
No simulated screens. Voice-over by the author. Capture the console at 1440x900 with the replay at 8x to 16x.

| Time | Shot | Voice-over |
|---|---|---|
| 0:00 | Terminal: `siliconsmith bench w1` shows 860,730 cycles for a TinyMaix layer. | "This neural-network layer takes 860,730 cycles on a small RISC-V chip. Coding agents would rewrite the code. This one changes the chip." |
| 0:12 | Terminal: `siliconsmith accelerate w1 --backend contree`, then the run URL. | "One command. A Nemotron agent starts a search over processor designs." |
| 0:22 | Console: profile, hot loop at 95.7%, Ultra's proposals fan out as nodes. | "Nemotron Ultra reads the profile and proposes custom instructions. Each one becomes a candidate CPU." |
| 0:38 | Console: sandboxes active counter, tree growing, stage strips filling. | "Each candidate is built and verified in its own Token Factory Sandbox, started from its parent's checkpoint. Up to eight at once in this run." |
| 1:05 | Console: a failure with a counterexample waveform (use a real failing proof from a new Sandboxes run if one appears; otherwise show a real unit-test failure and its repair), then Super's repair. | "Most ideas are wrong, and the ladder says so. Here the formal proof fails with a counterexample, Nemotron Super repairs it, and it passes." |
| 1:35 | Inspector: ladder rungs lit in order with the exact labels. | "Lint, a million vectors, a formal proof for every possible input, bit-identical output, then area and clock." |
| 1:55 | Console: polish nodes (dashed), best node 4.04x, Pareto. | "The agent then improves its own winner: less hardware, faster software. 4.04 times fewer cycles." |
| 2:15 | Report page: 3.76x wall-clock after Fmax, +4.83% area, honest limits. | "After the clock slows a little, that is 3.76 times faster for under five percent more area. Same idea as the hand-written vendor kernel, found on its own." |
| 2:30 | GitHub PR https://github.com/hash066/TinyMaix/pull/1 | "And it opens a pull request: Verilog, intrinsics, the patched kernel, and the proof report." |
| 2:42 | Cost panel: $0.44, Ultra / Super / Nano split. | "The whole design search cost forty-four cents of Nemotron." |
| 2:50 | Title card: "Change the chip, not just the code." + repo URL. | "SiliconSmith." |

Shot list notes
* The FPGA shot is cut: no board, and L6 reads "skipped". Do not imply it.
* Record the console from the replay of `r_w1_contree3`; say "recorded" if the voice-over mentions timing.
* Keep the 4.83% / 3.76x figures from `r_w1_contree3`, not the local run.
* Titles and captions can be built with Remotion; all screen content is capture.
