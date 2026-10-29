import type { IconName } from "./icons";

/** One entry per landing section: the id, the rail icon, its colour and label. Order is page order. */
export const SECTIONS: { id: string; label: string; icon: IconName; color: string }[] = [
  { id: "top", label: "Start", icon: "zap", color: "var(--hw-ember)" },
  { id: "problem", label: "The problem", icon: "alert", color: "var(--hw-bad)" },
  { id: "workbenches", label: "The workstation", icon: "bulb", color: "var(--hw-warn)" },
  { id: "demo", label: "See it in action", icon: "chat", color: "var(--hw-steel)" },
  { id: "proof", label: "See the difference", icon: "scale", color: "var(--hw-pcb)" },
  { id: "features", label: "Capabilities", icon: "grid", color: "var(--hw-steel)" },
  { id: "pipeline", label: "The pipeline", icon: "flow", color: "var(--hw-pcb)" },
  { id: "bench", label: "The Bench", icon: "game", color: "var(--hw-ember)" },
  { id: "how", label: "How it works", icon: "steps", color: "var(--hw-ok)" },
  { id: "stack", label: "Architecture", icon: "layers", color: "var(--hw-steel)" },
  { id: "cta", label: "Open it", icon: "arrow", color: "var(--hw-ember)" },
];
