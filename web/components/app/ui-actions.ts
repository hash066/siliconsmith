// The bridge between the Agent and the app. The Agent calls `dispatchUiAction(action)`; the app's handler (AppShell) applies it to the
// visible workbench and resolves with the REAL outcome. Agent output is untrusted, so `parseUiAction` validates shape before anything runs.
import type { UiAction, UiActionResult } from "@/lib/agent-actions";

export const UI_ACTION_EVENT = "hw:ui-action";
export interface UiActionDetail {
  action: UiAction;
  /** The app calls this exactly once with the pending result. */
  respond: (result: Promise<UiActionResult>) => void;
}

const WORKBENCHES = ["silicon", "board", "matter"];
const STEPS = ["brief", "propose", "verify", "evidence", "export"];
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNumRecord = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every((x) => typeof x === "number" && Number.isFinite(x));

/** Validate an untrusted `{name, args}`. Returns the typed action, or a reason it was refused. */
export function parseUiAction(raw: unknown): { ok: true; action: UiAction } | { ok: false; reason: string } {
  if (!isObj(raw) || typeof raw.name !== "string") return { ok: false, reason: "An action needs a name." };
  const args = isObj(raw.args) ? raw.args : {};
  switch (raw.name) {
    case "workbench.open":
      return typeof args.workbench === "string" && WORKBENCHES.includes(args.workbench) ? { ok: true, action: { name: raw.name, args: { workbench: args.workbench as "silicon" | "board" | "matter" } } } : { ok: false, reason: `workbench must be one of ${WORKBENCHES.join(", ")}.` };
    case "board.load_template":
      return typeof args.template_id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(args.template_id) ? { ok: true, action: { name: raw.name, args: { template_id: args.template_id } } } : { ok: false, reason: "template_id must be a short id (letters, digits, _ and -)." };
    case "board.set_design":
      return isObj(args.design) ? { ok: true, action: { name: raw.name, args: { design: args.design } } } : { ok: false, reason: "design must be a JSON object." };
    case "board.check":
      return { ok: true, action: { name: raw.name, args: {} } };
    case "matter.set_params": {
      const { generator, gen_params, spreader } = args;
      if (generator !== undefined && typeof generator !== "string") return { ok: false, reason: "generator must be a string." };
      if (gen_params !== undefined && !isNumRecord(gen_params)) return { ok: false, reason: "gen_params must map names to numbers." };
      if (spreader !== undefined && !isNumRecord(spreader)) return { ok: false, reason: "spreader must map names to numbers." };
      return { ok: true, action: { name: raw.name, args: { generator, gen_params, spreader } } };
    }
    case "matter.simulate":
      return { ok: true, action: { name: raw.name, args: {} } };
    case "silicon.open_run":
      return typeof args.run_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(args.run_id) && (args.node_id === undefined || (typeof args.node_id === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(args.node_id)))
        ? { ok: true, action: { name: raw.name, args: { run_id: args.run_id, node_id: args.node_id as string | undefined } } }
        : { ok: false, reason: "run_id (and node_id) must be short ids." };
    case "silicon.run_live":
      return args.workload === "w1" || args.workload === "w2" ? { ok: true, action: { name: raw.name, args: { workload: args.workload } } } : { ok: false, reason: "workload must be w1 or w2." };
    case "board.design":
      return typeof args.brief === "string" && args.brief.trim() && args.brief.length <= 1200 ? { ok: true, action: { name: raw.name, args: { brief: args.brief } } } : { ok: false, reason: "brief must be a short non-empty string." };
    case "preview.tab":
      return args.tab === "preview" || args.tab === "files" || args.tab === "proof" ? { ok: true, action: { name: raw.name, args: { tab: args.tab } } } : { ok: false, reason: "tab must be preview, files or proof." };
    case "workflow.focus":
      return typeof args.step === "string" && STEPS.includes(args.step) ? { ok: true, action: { name: raw.name, args: { step: args.step as "brief" } } } : { ok: false, reason: `step must be one of ${STEPS.join(", ")}.` };
    default:
      return { ok: false, reason: `Unknown action "${raw.name}".` };
  }
}

/** Called by the Agent. Resolves with what the app really did; if the app is not mounted it says so instead of pretending. */
export function dispatchUiAction(raw: unknown): Promise<UiActionResult> {
  const parsed = parseUiAction(raw);
  if (!parsed.ok) return Promise.resolve({ ok: false, summary: `Refused: ${parsed.reason}` });
  return new Promise<UiActionResult>((resolve) => {
    let answered = false;
    const detail: UiActionDetail = {
      action: parsed.action,
      respond: (p) => {
        answered = true;
        p.then(resolve, (e: unknown) => resolve({ ok: false, summary: `The action failed: ${e instanceof Error ? e.message : "unexpected error"}` }));
      },
    };
    window.dispatchEvent(new CustomEvent<UiActionDetail>(UI_ACTION_EVENT, { detail }));
    if (!answered) resolve({ ok: false, summary: "The app is not listening for actions right now." });
  });
}
