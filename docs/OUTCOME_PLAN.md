# Outcome plan: make every workbench end in something real you can open

Written Oct 24 2026 (IST). Submit target Oct 29. This plan comes from reading the competitors' pages and from inspecting what our
workbenches actually produce today. Competitor facts below are from their Product Hunt pages (marketing copy, unverified).

## 1. What the competitors actually do (and where we are behind)

| | Input | Steps | Deliverable | Limits they state |
|---|---|---|---|---|
| **siliXon** (PCB) | plain-English device idea | agent asks questions, picks real purchasable parts, places, draws schematic, routes copper, board must pass checks | a **routed manufacturable PCB**, its schematic, KiCad-openable files; edit in 2D and 3D; order or export | early beta, 2 and 4 layers only, best for mostly digital, analogue limited |
| **Protoflow** | not stated | schematic design with component search and an AI assistant | schematic that **exports to KiCad and Altium** | none stated |
| Flux.ai Copilot | natural language | places parts and wires circuits in its own editor | schematic and layout in Flux | weak on pinouts and footprints (independent test: 168 DRC errors vs 0 for a human) |
| MDO agent / TopOptAgents (papers) | natural language | parametric CAD, FEA, optimisation | geometry and field results | research code |

**The gap, stated plainly:** their output is *the artifact itself*, drawn the way engineers expect (a board that looks like a board).
Ours is a block diagram plus a pass/fail list. `board/export.py` even says "Nothing here is a layout. The KiCad netlist carries no
footprints, so it cannot be turned into a board". A judge comparing screenshots will see a mock diagram next to a real PCB.

**What we have that they do not (keep this as the differentiator):** the checks are deterministic and cross-domain. We compare the
**firmware pin table against the board netlist and the part datasheet facts** (rungs B1 to B5), and in Silicon we **formally prove**
hardware. Plan: put that on top of a real board, so the check is visibly about a real layout.

## 2. Principles for the rest of the work

1. **Outcome = a file you can open in a real tool**, plus a picture that looks like that tool's output.
2. **Every claim comes from a verifier.** Board: KiCad DRC plus our B1 to B5. Silicon: the proof ladder. Matter: the independent solver.
3. **Say what is not done** (not manufactured, not ordered, approximate 3D, 2 layers).
4. One **Deliverables panel** at the end of every workbench: file list, what verified each, "Open in KiCad / GTKWave / slicer".
5. No new product areas. Depth over breadth. (Ideas like GhostDriver stay on the roadmap slide.)

## 3. Board workbench: from block diagram to a real PCB (largest gap, do first)

### 3.1 Target outcome
For a prompt like "battery environmental sensor: ESP32, BME280, USB-C charging, LDO" the user gets:
* a **routed 2-layer KiCad board** (`.kicad_pcb`) with real footprints, silkscreen, outline, copper pours; opens in KiCad;
* a **schematic view** drawn with real symbols and net labels (own renderer; KiCad `.kicad_sch` via SKiDL is a stretch);
* **DRC result from KiCad** plus **our firmware-versus-board checks drawn on the board** (the wrong pin is highlighted on the pad);
* downloads: Gerber + drill zip, BOM CSV, pick-and-place CSV, netlist, firmware pin header, SVG of each layer;
* an honest status line: "checked by KiCad DRC 7.x and rungs B1 to B5; not fabricated".

### 3.2 Pipeline (all open source, all runnable here)
1. **Part database upgrade** (`board/parts/*.json`): add `footprint` (KiCad library id) and a `pads` map from our logical pin names to pad
   numbers, for the 11 parts we have (ESP32-WROOM-32, BME280, LDO, USB-C receptacle, MCP73831, R, C, LED, button, connectors).
   This mapping is the main correctness risk (a wrong pad number is a wrong board), so each part gets a test comparing our pin list with the
   footprint's pad list.
2. **Board generator** (`board/layout.py`, run with KiCad's Python `pcbnew`): netlist plus footprints to a `.kicad_pcb`.
3. **Placement**: deterministic rules, not an LLM: connectors on the edge, antenna end of the ESP32 module on a board edge with keepout,
   decoupling caps within a distance of their supply pin, regulator near the connector, grid snap. The agent may *choose parameters*
   (board size, side of connector), but the placement is code, so it is reproducible and testable.
4. **Routing**: Freerouting (open source, headless) through `pcbnew`'s Specctra DSN export and SES import. Needs a JRE (not installed yet).
   If routing is incomplete, the board is shown with the unrouted airwires in red and the status says so. Never hide it.
5. **Checks**: `kicad-cli pcb drc` (JSON report) plus B1 to B5 mapped onto pads and tracks (for example B4 "firmware says GPIO14, board
   wires the button to GPIO12 pad 14 of the module" is drawn as a marker at that pad).
6. **Exports**: Gerbers and drill (`kicad-cli pcb export gerbers/drill/pos`), BOM CSV, SVG per layer (`kicad-cli pcb export svg`).
7. **Web viewer** (`web/components/app/BoardPreview.tsx`, replace the block diagram): parse the board export to JSON on the server and
   render pads, tracks, vias, zones, silkscreen and outline as SVG with layer toggles, hover for net highlight, click a check to zoom to
   the offending pad, a clear "3D (approximate)" tab (extruded courtyards, labelled approximate) as a stretch.
8. Keep the block diagram as a small overview tab, not the main image.

### 3.3 Acceptance tests (must pass before we show it)
* The `clean_sensor` template produces a board with **0 KiCad DRC errors** and 100% of nets routed, in under 90 s.
* The `fault_gpio12_vs_gpio14` template produces a board whose **B4 marker lands on the right pad**.
* Round trip: netlist re-extracted from the `.kicad_pcb` equals the input netlist (no lost or swapped connections).
* Pad-map test per part (our pins against the KiCad footprint pads).
* Gerber zip opens in a Gerber viewer (check by loading it with KiCad's `gerbview` or an open-source parser in a test).
* Visual check by screenshot at 1440 and 390 px: it must look like a PCB (green or dark soldermask, copper, silkscreen), not a diagram.

### 3.4 Risks and kill switches
| Risk | Mitigation | Kill switch |
|---|---|---|
| Autorouter cannot finish the ESP32 module | simple designs only; 2 layers with a ground pour; allow wider board | show the placed board with airwires and say "not routed" |
| Footprint or pad-map mistakes | per-part tests, DRC and round-trip test | drop any part we cannot test |
| KiCad install bigger or slower than expected | KiCad 7.0.11 is in the Ubuntu 24.04 repos; run on the existing sandbox image or the API host | precompute boards for the templates and serve them as evidence entries |
| Serverless host cannot run KiCad | KiCad only runs in WSL and Sandboxes, not on Vercel | cache generated boards in the evidence library and serve those; live generation only through the CLI and Sandboxes |
| Time | this is about 2.5 days of work | ship layout + DRC + SVG viewer only; skip the 3D tab and `.kicad_sch` |

## 4. Silicon workbench: show the hardware the agent made

Today the user sees a tree, a ladder and numbers. Target:
1. **Gate-level view** of the new instruction from the real Yosys netlist (`write_json`), drawn as a layered block diagram (adders,
   multipliers, muxes), with cell counts per type. Animated reveal. (1 day)
2. **Waveform viewer** of the instruction on real test vectors from the Verilator VCD (rs1, rs2, rd, valid), including the counterexample
   waveform when a proof fails. (0.5 day)
3. **Before/after code**: the original C loop beside the rewritten one, the new instruction's Verilog, and the cycle bar (860,730 to 213,022).
4. **Deliverables panel**: RTL, header, patched kernel, REPORT.md, VCD (opens in GTKWave), link to the real pull request.
5. A short **"how the proof works"** explainer in plain language, with the exact label rules.
Acceptance: for `r_w1_contree3` the gate view cell count equals the Yosys `stat` number in the report; the waveform matches the unit test.

## 5. Matter workbench: make it look physical, and be honest about the gain

Measured gain over an equal-material baseline is small (+0.11 to +0.48 K). Do not oversell it.
1. **3D viewer** (three.js) of the STL with the temperature field as a colour texture and a slider for heat load. (1 day)
2. **Side-by-side with the baseline plate**, with the numbers and "equal material" stated.
3. **Printability check** results listed (minimum feature size, overhang), and the downloadable STL.
Acceptance: displayed temperatures equal the solver output (test), and the independent FEM agrees within the documented tolerance.

## 6. Cross-workbench polish
* One consistent **Deliverables** panel and a **"Verified by"** ledger (which tool, version, pass or fail) per workbench.
* **Project export**: one zip per project (board files, RTL, STL, reports).
* **Demo storyline** for the video: Board (prompt, real board appears, firmware mismatch lights the wrong pad, agent fixes, KiCad DRC clean,
  ESP32 on the desk if the hardware demo happens), then Silicon (live run, proof fails then repairs, gate view, PR), then Matter (3D result).
  Keep each under 55 s.

 |

## 8. What we will not claim
Not fabricated or tested electrically; not an auto-order flow; 2 layers only; 3D is approximate if shown; the Board checker predicts
documented hazards and does not measure boards (see `docs/hardware-demo.md`); results of other products are marketing claims we have not verified.

## 9. What I need from you
* Go-ahead to install KiCad 7, a JRE and Freerouting inside the `siliconsmith` WSL distro (E:, about 2 GB).
* The ESP32 board photo and serial output if you buy the board (separate, optional).

