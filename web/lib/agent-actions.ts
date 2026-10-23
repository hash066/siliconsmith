// Contract between the Agent (components/agent, lib/agent*) and the App (components/app). Owned by the integrator.
// The agent streams `ui.action` events; the app registers a handler per action name and applies it to the visible workbench.
import type { WorkbenchId } from "./brand";

export type UiAction =
  | { name: "workbench.open"; args: { workbench: WorkbenchId } }
  | { name: "board.load_template"; args: { template_id: string } }
  | { name: "board.set_design"; args: { design: unknown } } // a full design object, validated by the Board schema
  | { name: "board.check"; args: Record<string, never> } // run the free deterministic check on the current design
  | { name: "matter.set_params"; args: { generator?: string; gen_params?: Record<string, number>; spreader?: Record<string, number> } }
  | { name: "matter.simulate"; args: Record<string, never> }
  | { name: "silicon.open_run"; args: { run_id: string; node_id?: string } }
  | { name: "silicon.run_live"; args: { workload: "w1" | "w2" } } // starts the LIVE single-candidate pipeline (spends credits; needs a click)
  | { name: "board.design"; args: { brief: string } } // bounded propose/check/repair loop (spends credits; needs a click)
  | { name: "preview.tab"; args: { tab: "preview" | "files" | "proof" } }
  | { name: "workflow.focus"; args: { step: "brief" | "propose" | "verify" | "evidence" | "export" } };

export type UiActionName = UiAction["name"];

/** Whether an action spends credits (needs a click and a cost estimate) or is free. */
export const ACTION_COST: Record<UiActionName, "free" | "credits"> = {
  "workbench.open": "free",
  "board.load_template": "free",
  "board.set_design": "free",
  "board.check": "free",
  "matter.set_params": "free",
  "matter.simulate": "free",
  "silicon.open_run": "free",
  "silicon.run_live": "credits",
  "board.design": "credits",
  "preview.tab": "free",
  "workflow.focus": "free",
};

/** The app reports what each action did, so the agent (and the user) see the real outcome, not a guess. */
export type UiActionResult = { ok: boolean; summary: string; evidence_ids?: string[] };
