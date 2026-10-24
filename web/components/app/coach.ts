// Three short coach marks on the workspace (replaces the 5-step modal tour). Pure helpers: steps and card placement.

export const COACH_KEY = "hw-app-coach-v2";

export interface CoachStep {
  id: "chat" | "tabs" | "advanced";
  title: string;
  body: string;
  /** `data-coach` value of the element it points at. */
  target: string;
  /** On a narrow screen only one pane shows: which one this step needs. */
  pane: "chat" | "preview";
}

export const COACH_STEPS: CoachStep[] = [
  { id: "chat", title: "Talk to the agent", body: "Say what you want, or what to change. It works on the preview for you.", target: "chat", pane: "chat" },
  { id: "tabs", title: "Preview, Files, Proof", body: "See the result, download the files, and open every check behind it.", target: "tabs", pane: "preview" },
  { id: "advanced", title: "Advanced", body: "Exact numbers, the design file, limits and the model live here.", target: "advanced", pane: "preview" },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Card position: below the target if it fits, else above, else beside it; always inside the viewport. */
export function placeCard(target: Rect | null, card: { w: number; h: number }, vw: number, vh: number, gap = 12, margin = 12): { x: number; y: number } {
  const clampX = (x: number) => Math.min(Math.max(margin, x), Math.max(margin, vw - card.w - margin));
  const clampY = (y: number) => Math.min(Math.max(margin, y), Math.max(margin, vh - card.h - margin));
  if (!target || target.w <= 0 || target.h <= 0) return { x: clampX((vw - card.w) / 2), y: clampY(vh - card.h - 24) };
  const cx = target.x + target.w / 2 - card.w / 2;
  const cy = target.y + target.h / 2 - card.h / 2;
  if (target.y + target.h + gap + card.h + margin <= vh) return { x: clampX(cx), y: target.y + target.h + gap };
  if (target.y - gap - card.h - margin >= 0) return { x: clampX(cx), y: target.y - gap - card.h };
  if (target.x + target.w + gap + card.w + margin <= vw) return { x: target.x + target.w + gap, y: clampY(cy) };
  if (target.x - gap - card.w - margin >= 0) return { x: target.x - gap - card.w, y: clampY(cy) };
  return { x: clampX((vw - card.w) / 2), y: clampY(vh - card.h - margin) };
}

/** A polygon with a rectangular hole (even-odd): the dim covers everything except the thing being pointed at. */
export function holePath(r: Rect, vw: number, vh: number, pad = 6): string {
  const x0 = Math.max(0, r.x - pad);
  const y0 = Math.max(0, r.y - pad);
  const x1 = Math.min(vw, r.x + r.w + pad);
  const y1 = Math.min(vh, r.y + r.h + pad);
  return `polygon(evenodd, 0 0, ${vw}px 0, ${vw}px ${vh}px, 0 ${vh}px, 0 0, ${x0}px ${y0}px, ${x0}px ${y1}px, ${x1}px ${y1}px, ${x1}px ${y0}px, ${x0}px ${y0}px)`;
}
