/** The readouts of the board's status bar. Pure so they can be tested without a browser. */

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Zoom as a percentage of the fit-to-window view (100% = the whole board). */
export function zoomPercent(full: View, view: View): number {
  return Math.round((full.w / view.w) * 100);
}

/** Board coordinates (mm) under a pointer, from its position inside the drawing's on-screen box. */
export function pointerToBoard(view: View, box: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  return { x: view.x + ((clientX - box.left) / box.width) * view.w, y: view.y + ((clientY - box.top) / box.height) * view.h };
}

/** True when the point lies on the board itself rather than in the margin around it. */
export function onBoard(p: { x: number; y: number }, board: { width: number; height: number }): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= board.width && p.y <= board.height;
}

export function formatMm(p: { x: number; y: number } | null): string {
  return p ? `X ${p.x.toFixed(2)}  Y ${p.y.toFixed(2)} mm` : "X –  Y – mm";
}
