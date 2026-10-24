# Reference study and replication plan (Oct 24 2026)

Source material: `refernce/` (two screen recordings and two screenshots). Frames were extracted with ffmpeg; this document records what each product does and how
Hardwright will absorb it. **Rule from the owner: do not remove anything that exists; add depth.**

## 1. What the references are and do

### A. "iOrchestra Hardware Engineer" (screenshots 150812 and 150829)
A hardware-engineer agent with a **split workspace**.
* Left pane **Mechanical**: a 3D board (green substrate, SMD parts as boxes) on a dark grid floor, a **view cube** (top right), orbit controls, a small magnifier inset.
  Header chips: `MECHANICAL`, `PCB 3D`; actions: Clear, Import, Export, Advanced, Manufacture.
* Right pane **Electronics**: a tab strip of the design pipeline, **BRIEF, PARTS, BOM, ECO, PCB, DRC, SIM, OVERRIDE, EXPORT** (the current stage is highlighted) and a
  green **Proceed to export** button; a text field to override a component; the **PCB layout** (yellow board outline, purple pads, orange top and blue bottom tracks,
  silkscreen refs) beside the **schematic** ("Schematic: 11 components"); a **layer legend** with per-layer toggles; zoom `100%` with +/- controls.
* **Manufacturing**: after the design, a **PCBWay instant quote**: the Gerber zip is uploaded and the quote form is pre-filled from it ("Detected 2 layers board of 45 x 41 mm",
  quantity 5, FR-4, thickness 1.6, copper weight, surface finish, mask colour, silkscreen), with price and build time on the right and **Save to Cart**.

### B. "Protoflow" (video 151132, 55 s)
An EDA-style editor with an **AI Copilot**.
* Top **menu bar** (File, Edit, View, Place, Tools, Help), icon toolbar, **Place Component**.
* Left **Components** panel: search box with a "magic" (AI) button, category chips **All / Passives / ICs / Power**, cards (Resistor R, Capacitor C, Inductor I, Op-Amp O) with hotkeys.
* **Document tabs**: `Project kicad_sch`, `3D Viewer`, `AI Component Lab`, and an opened **datasheet PDF** (the ESP32 datasheet) in its own tab; `+` for new tabs.
* **AI Copilot** panel: a card **"Make PCB Board?"**: "I will open the PCB board for the schematic and design it. Tell me what you want, or just pick a style and go",
  a free-text box ("40x30mm, USB-C on the left edge, GND pour on the bottom, keep the antenna corner clear"), **Layout style: Default / Smallest / Reduce EMI**,
  **Make PCB Board** and **Not Now**. Below: chat input, `Agent` mode, `More`, model chip, scope chips ("This schematic only", "All annotations", "Auto"), token meter.
* **Online Component Search**: a modal listing real distributor parts for "esp32" (image, part number, manufacturer, description, price, stock, datasheet link) with a detail
  pane and **Place**. **AI Component Lab**: make a component from a datasheet. **Status bar**: snap, zoom, grid (1.27 mm).

### C. "ChipStack" (video 150419, 2:19)
A chip-verification **agent suite**.
* A terminal chat plus a left **agent list** (Design Understanding, Formal Verification Agent, SystemVerilog Testbench Agent, Functional Coverage Agent, UVM Verification Agent),
  each with **Launch Agent** and a re-run button, and a **Files** artifact tree.
* A **Formal Test Plan**: tabs **Scenarios / Code / TCL / Run Results**; "Show Summary"; each **scenario** has **Description / Code / Results** tabs, a lock and delete;
  toolbar: **Generate code, Run tests, Autocorrect count (stepper), View run results, Export, Regenerate full test plan**, plus "for selected" variants.
* **Results table**: name, **PASSED**, Logs, Debug Info, Fsdb Waves, **VCD Waves**; a **waveform viewer** with **Scopes**, **Variables** (filter), transport controls (zoom, step,
  play), a time axis and bus signals showing hex values.

## 2. What Hardwright already has (keep)
Prompt-first start; projects and sidebar; chat agent with actions; Preview/Workflow/Files/Proof; routed PCB viewer (layers, net highlight, markers); schematic; blocks;
Gerbers/KiCad/BOM downloads; Sandbox routing for any design; Silicon hardware netlist view, operand-pair waveform table, before/after, proof explainer; Matter 3D and baseline compare;
Verified-by ledger; zip export; MCP/CLI/package.

## 3. Mapping: reference feature -> Hardwright addition (all additive)

| # | From | Hardwright addition | Real data behind it |
|---|---|---|---|
| 1 | A | **3D board view** (new "3D" tab beside Layout): extruded substrate, copper, parts as boxes by footprint, orbit, view cube, grid floor; **Studio** split (3D + Layout side by side on wide screens) | `board.json` geometry (pads, courtyards, outline) |
| 2 | A | **Pipeline strip** in the Board preview: Brief, Parts, BOM, Checks, Layout, DRC, Export with the current stage lit | project state |
| 3 | A | **DRC panel**: KiCad findings listed (errors, warnings by type) with click-to-zoom to the location; **layer legend** with toggles | `drc.txt` and the layout summary |
| 4 | A | **Manufacture panel**: fab-ready spec sheet detected from the Gerber (layers, size, thickness, copper, min track/space, drill, finish) with checks, links to fab houses' quote pages; **no invented prices** | `summary.json`, `board.json` |
| 5 | B | **Parts panel**: search + categories (All/Passives/ICs/Power/Connectors) over the real part library, part cards with pins, facts and `citation_checked`, **datasheet link**, "Add to design" (sends the request to the agent); **BOM table** with search | `/api/board/parts`, design |
| 6 | B | **"Make PCB board?" card** with **Layout style (Default / Smallest / Reduce EMI)** and **constraints text** (size, connector edge); the card echoes what it understood and what it ignored | engine placer options (style, size) |
| 7 | B | **Status bar** (zoom, grid, units, layer, net under cursor) on the PCB view | PcbView state |
| 8 | C | **Agents panel** (Silicon): Architect (Ultra), Engineer (Super), Triage (Nano), Prover (Sandbox) cards with model, calls, tokens, cost, status; launch/relaunch | `run.usage.byRole`, stages |
| 9 | C | **Test plan with scenarios** (Silicon): each operand-pair scenario has Description / Code / Results tabs; **Run tests**, add your own pair, **Export**; PASSED/FAILED per scenario | `views/instruction.json` rows; Sandbox viz for new pairs |
| 10 | C | **Waveform viewer**: Scopes and Variables list (rs1, rs2, rd hardware, rd reference, each multiplier/adder output), transport (zoom, step, play), time axis, bus values; **VCD download** | Verilator `--trace` VCD from the Sandbox |

## 4. Build order and status

Status is tracked in `docs/HANDOFF_LATEST.md` section 11. Order: (1) 3D board and Studio, (4) Manufacture, (5) Parts and BOM, (3) DRC panel, (2) pipeline strip, (6) Make-PCB style and constraints
(engine change: placer `style`, `width`, `height`), (8) Agents panel, (9) scenarios, (10) VCD waveform viewer (worker change: `--trace`).
Each item: tests with real data, deploy, strict browser check (axe, CLS), commit, push.

## 5. Honesty rules for the new surfaces
* No prices or lead times are shown unless a real quote exists; the Manufacture panel links to fab quote pages and says so.
* "Reduce EMI" and "Smallest" change documented placer settings and say exactly which; unparsed constraint text is shown as ignored, never silently dropped.
* The 3D view is approximate (courtyard boxes at typical heights) and is labelled so.
* Part "datasheet" links are the sources already recorded in the library; a fact without a checked citation keeps its warning.
