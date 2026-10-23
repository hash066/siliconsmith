// The first-visit tour: steps and the card placement math (pure, so it is testable without a DOM).

export const TOUR_KEY = "hw-app-tour-seen-v1";

export interface TourStep {
  id: "welcome" | "sidebar" | "canvas" | "agent" | "credits";
  title: string;
  body: string;
  /** `data-tour` value of the element to spotlight; null = no spotlight. */
  target: string | null;
  /** Narrow screens show one pane at a time: which pane must be visible for this step. */
  pane?: "inputs" | "canvas" | "agent";
}

export const TOUR_STEPS: TourStep[] = [
  { id: "welcome", title: "Welcome to Hardwright", body: "Agents design hardware here. Verifiers the model cannot argue with decide what is true.", target: null },
  { id: "sidebar", title: "Three workbenches", body: "Matter: heat spreaders. Silicon: custom RISC-V instructions. Board: boards checked against firmware.", target: "sidebar" },
  { id: "canvas", title: "Canvas and workflow", body: "Every workbench follows Brief, Propose, Verify, Evidence, Export. Each step shows real status. Click one to jump to it.", target: "workflow", pane: "canvas" },
  { id: "agent", title: "The Agent", body: "Ask it to run things: set parameters, check a design, open a run. It acts in the app and shows what it did.", target: "agent", pane: "agent" },
  { id: "credits", title: "Credits and evidence", body: "Agent turns spend demo credits; the free checks never do. Evidence chips open the facts behind a number.", target: "credits" },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the tour card goes: right of the target, else left, below, above, else centred. Always inside the viewport. */
export function placeCard(target: Rect | null, card: { w: number; h: number }, vw: number, vh: number, gap = 14, margin = 12): { x: number; y: number } {
  const clampX = (x: number) => Math.min(Math.max(margin, x), Math.max(margin, vw - card.w - margin));
  const clampY = (y: number) => Math.min(Math.max(margin, y), Math.max(margin, vh - card.h - margin));
  if (!target || target.w <= 0 || target.h <= 0) return { x: clampX((vw - card.w) / 2), y: clampY((vh - card.h) / 2) };
  const cy = target.y + target.h / 2 - card.h / 2;
  const cx = target.x + target.w / 2 - card.w / 2;
  if (target.x + target.w + gap + card.w + margin <= vw) return { x: target.x + target.w + gap, y: clampY(cy) };
  if (target.x - gap - card.w - margin >= 0) return { x: target.x - gap - card.w, y: clampY(cy) };
  if (target.y + target.h + gap + card.h + margin <= vh) return { x: clampX(cx), y: target.y + target.h + gap };
  if (target.y - gap - card.h - margin >= 0) return { x: clampX(cx), y: target.y - gap - card.h };
  return { x: clampX((vw - card.w) / 2), y: clampY(vh - card.h - margin) };
}

/** A polygon with a rectangular hole (even-odd), used as clip-path so the blur and dim cover everything except the spotlight. */
export function holePath(r: Rect, vw: number, vh: number, pad = 6): string {
  const x0 = Math.max(0, r.x - pad);
  const y0 = Math.max(0, r.y - pad);
  const x1 = Math.min(vw, r.x + r.w + pad);
  const y1 = Math.min(vh, r.y + r.h + pad);
  return `polygon(evenodd, 0 0, ${vw}px 0, ${vw}px ${vh}px, 0 ${vh}px, 0 0, ${x0}px ${y0}px, ${x0}px ${y1}px, ${x1}px ${y1}px, ${x1}px ${y0}px, ${x0}px ${y0}px)`;
}
