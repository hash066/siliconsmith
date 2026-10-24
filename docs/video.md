# Video script: Hardwright (3 minutes or less, real runs only)

Voice-over by the owner. Shoot on https://siliconsmith.vercel.app at 1440 wide, dark theme. Never speed up the live runs; cut to the result instead. Every number on screen
must come from the screen (nothing typed in later). If the ESP32 hardware shot is not done, skip beat 2b: the rest stands alone.

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:15 | Title, then the start screen ("What do you want to make?") | "AI will tell you a hardware design is fine with total confidence, and it is often wrong. Hardwright is a workstation where an agent can only claim what a checker it cannot argue with has returned." |
| 0:15 to 1:05 **Board** | Click the board example. The agent drafts a board; the report card; **Layout** shows the routed board. Open the wrong-wiring example: the red ring on ESP32 pad 14, green on pad 13. Ask "fix it": the agent moves the pin, five checks go green. Flip to **Schematic** for two seconds. | "Describe a sensor board. The agent drafts it, five deterministic checks judge it, and it becomes a real routed KiCad board. Here the firmware says the wake button is on GPIO12, a boot pin, but the board wires GPIO14. The wrong pad is marked on the copper. The agent fixes it and the checks pass." |
| 1:05 to 1:20 (optional 2b) | The ESP32 on the desk boot-looping with the serial output, then booting after the wire moves to GPIO14 | "And on a real ESP32, the wiring the checker flagged does fail to boot, and works once fixed. The checker predicted a documented hazard; it did not measure the board." |
| 1:20 to 1:35 | Press Download, **Everything as one zip**; show the Gerbers and the KiCad file in the zip; show the "Verified by" ledger (KiCad 0 errors) | "Everything is a file you can open elsewhere: Gerbers, the KiCad board, the parts list. And a ledger of exactly which tool and version stands behind each claim." |
| 1:35 to 1:55 **Matter** | Start the heat-sink example; rotate the 3D part; click "Compare with plain fins" and read the verdict | "Matter is a heat sink on two independent solvers. It shows the part, a printable STL, and it compares with plain fins using the same material. Here it is slightly worse, and it says so." |
| 1:55 to 2:35 **Silicon** | Silicon, "Run it live". Let the stages tick (clock visible). Result: speedup, circuit view (4 multipliers, 3 adders), waveform, before/after loop | "Silicon is live. Nemotron Ultra proposes a custom RISC-V instruction, Super writes the hardware, and a Token Factory Sandbox proves it: a million test vectors and a formal proof for every possible input. 3.3 times fewer cycles for under 5 percent more area. This is the circuit it made and what it does on real inputs." |
| 2:35 to 2:50 | Terminal or editor: `claude mcp add hardwright -- hardwright mcp`, then ask the agent to check the faulty design; it reports the B4 failure | "The same checkers are an open-source package and MCP server, so any coding agent can use them offline, for free." |
| 2:50 to 3:00 | The /connect page and the URL; credits pill | "Nemotron on Token Factory, Sandboxes for every proof and every board. Try it now, no sign-up. Hardwright." |

Checklist before recording: demo credits visible ($0.50); a fresh browser profile; coach marks dismissed; run each live action once beforehand to confirm the services are up
(`/api/health` and `/api/silicon/status`); keep the recording under 3:00; add the repo URL on the closing card.
