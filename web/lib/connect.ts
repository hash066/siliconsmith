// What the /connect page tells a person to type. One place, so the page and its test cannot drift apart.
// The commands must match `hardwright mcp --setup` (engine/hardwright/mcp.py).
import { BRAND } from "./brand";

export const INSTALL_GIT = `pip install "hardwright[matter] @ git+${BRAND.repo}#subdirectory=engine"`;
export const INSTALL_CLONE = `git clone ${BRAND.repo}.git
cd siliconsmith
pip install -e "engine[matter]"`;

export interface Client {
  id: string;
  name: string;
  where: string;
  code: string;
  note?: string;
}

export const CLIENTS: Client[] = [
  { id: "claude-code", name: "Claude Code", where: "Run once in your project", code: "claude mcp add hardwright -- hardwright mcp" },
  { id: "codex", name: "Codex", where: "Run once", code: "codex mcp add hardwright -- hardwright mcp" },
  { id: "cursor", name: "Cursor", where: "Save as .cursor/mcp.json", code: `{\n  "mcpServers": {\n    "hardwright": { "command": "hardwright", "args": ["mcp"] }\n  }\n}` },
  { id: "vscode", name: "VS Code", where: "Save as .vscode/mcp.json", code: `{\n  "servers": {\n    "hardwright": { "type": "stdio", "command": "hardwright", "args": ["mcp"] }\n  }\n}` },
  { id: "claude-desktop", name: "Claude Desktop", where: "Add to claude_desktop_config.json", code: `{\n  "mcpServers": {\n    "hardwright": { "command": "hardwright", "args": ["mcp"] }\n  }\n}` },
];

export const TOOLS: Array<{ name: string; does: string }> = [
  { name: "board_check", does: "Runs the five board checks on a design: well formed, electrical rules, bus rules, firmware pins vs netlist and boot-strapping hazards, battery estimate." },
  { name: "board_fix_pin", does: "Moves one firmware pin (for example the wake button) to another GPIO and re-checks." },
  { name: "board_templates", does: "Lists the built-in example designs: one clean, two with a known wiring fault." },
  { name: "board_get_template", does: "Returns an example design as JSON, ready to edit." },
  { name: "board_parts", does: "Lists the parts and facts the checks rest on, and which facts are checked against a source." },
  { name: "matter_simulate", does: "Solves a 2D heat spreader, cross-checks it with a second solver, compares it with plain fins and can write the printable STL." },
];

export const PROMPTS = [
  "Check the board in design.json with hardwright and tell me which check fails.",
  "My wake button is on GPIO12 with a pull-up. Use hardwright to check it, fix the pin, and re-check.",
  "Design a heat sink for a 5 W chip on a 40 mm plate with hardwright and write the STL to heat-sink.stl.",
];

export const CLI_EXAMPLES = `hardwright board check --template fault_gpio12_vs_gpio14
hardwright board fix-pin --template fault_gpio12_vs_gpio14 wake_btn GPIO14
hardwright board check design.json --json
hardwright matter simulate --power 5 --param n_fins=8 --stl heat-sink.stl`;

export const PY_EXAMPLE = `import hardwright as hw

report = hw.board_check(template="fault_gpio12_vs_gpio14")
print(report["passed"])                       # False
print([c["id"] for c in report["checks"] if c["status"] == "fail"])   # ['B4']

part = hw.matter_simulate(power_w=5, stl_path="heat-sink.stl")
print(part["peak_c"], part["verdict"])`;

export const CURL_BOARD = `hardwright board template fault_gpio12_vs_gpio14 > design.json
curl -s https://siliconsmith.vercel.app/api/board/check \\
  -H 'content-type: application/json' \\
  -d "{\\"design\\": $(cat design.json)}"`;

export const CURL_MATTER = `curl -s https://siliconsmith.vercel.app/api/matter/simulate \\
  -H 'content-type: application/json' \\
  -d '{"generator": "rect_fins", "spreader": {"Q": 5}}'`;
