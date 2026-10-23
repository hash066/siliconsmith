// The workflow bar: Brief, Propose, Verify, Evidence, Export. Status is derived from the real state of the workbench, never assumed.

export type StepId = "brief" | "propose" | "verify" | "evidence" | "export";
export type StepState = "todo" | "active" | "done" | "warn" | "blocked";
export interface StepStatus {
  id: StepId;
  label: string;
  state: StepState;
  /** One short, factual phrase shown under the label. */
  note: string;
}

export const STEP_LABELS: Record<StepId, string> = { brief: "Brief", propose: "Propose", verify: "Verify", evidence: "Evidence", export: "Export" };
export const STEP_ORDER: StepId[] = ["brief", "propose", "verify", "evidence", "export"];

const mk = (id: StepId, state: StepState, note: string): StepStatus => ({ id, label: STEP_LABELS[id], state, note });

export interface BoardFlow {
  hasDesign: boolean;
  busy: boolean;
  checked: boolean;
  stale: boolean;
  passN: number;
  total: number;
  failure: boolean;
  evidenceOpen: boolean;
}
export function boardSteps(f: BoardFlow): StepStatus[] {
  const verified = f.checked && !f.stale;
  const verify: StepStatus = f.busy
    ? mk("verify", "active", "checking")
    : f.failure
      ? mk("verify", "warn", "service error")
      : f.checked
        ? mk("verify", verified ? (f.passN === f.total ? "done" : "warn") : "active", `${f.passN}/${f.total} rungs pass${f.stale ? ", edited since" : ""}`)
        : mk("verify", f.hasDesign ? "active" : "todo", "not checked yet");
  return [
    mk("brief", f.hasDesign ? "done" : "active", f.hasDesign ? "design loaded" : "pick a template"),
    mk("propose", f.hasDesign ? "done" : "todo", f.hasDesign ? "edit or ask the agent" : "needs a design"),
    verify,
    mk("evidence", f.evidenceOpen ? "done" : f.checked ? "active" : "todo", f.evidenceOpen ? "open" : f.checked ? "tap an ev chip" : "after a check"),
    mk("export", f.checked ? "active" : "blocked", f.checked ? "copy pin header" : "after a check"),
  ];
}

export interface MatterFlow {
  valid: boolean;
  busy: boolean;
  simulated: boolean;
  stale: boolean;
  passN: number;
  total: number;
  failure: boolean;
  evidenceOpen: boolean;
  hasStl: boolean;
}
export function matterSteps(f: MatterFlow): StepStatus[] {
  const ran = f.simulated && !f.stale;
  const verify: StepStatus = f.busy
    ? mk("verify", "active", "solving")
    : f.failure
      ? mk("verify", "warn", "service error")
      : f.simulated
        ? mk("verify", ran ? (f.passN === f.total ? "done" : "warn") : "active", `${f.passN}/${f.total} rungs pass${f.stale ? ", edited since" : ""}`)
        : mk("verify", f.valid ? "active" : "blocked", "not simulated yet");
  return [
    mk("brief", f.valid ? "done" : "warn", f.valid ? "parameters in range" : "fix the parameters"),
    mk("propose", "done", "tune or ask the agent"),
    verify,
    mk("evidence", f.evidenceOpen ? "done" : f.simulated ? "active" : "todo", f.evidenceOpen ? "open" : f.simulated ? "tap an ev chip" : "after a run"),
    mk("export", f.hasStl ? "active" : f.simulated ? "todo" : "blocked", f.hasStl ? "STL ready" : f.simulated ? "tick STL, run again" : "after a run"),
  ];
}

export interface SiliconFlow {
  loaded: boolean;
  status: string;
  verified: number;
  evidenceOpen: boolean;
}
export function siliconSteps(f: SiliconFlow): StepStatus[] {
  const done = f.status === "completed";
  return [
    mk("brief", f.loaded ? "done" : "active", f.loaded ? "workload read" : "pick a recorded run"),
    mk("propose", done ? "done" : f.loaded ? "active" : "todo", done ? "candidates proposed" : "replaying"),
    mk("verify", f.status === "failed" ? "warn" : done ? "done" : f.loaded ? "active" : "todo", done ? `${f.verified} verified` : f.status === "failed" ? "run failed" : "ladder running"),
    mk("evidence", f.evidenceOpen ? "done" : done ? "active" : "todo", f.evidenceOpen ? "open" : done ? "tap a number" : "after the run"),
    mk("export", done ? "active" : "blocked", done ? "report page" : "after the run"),
  ];
}
