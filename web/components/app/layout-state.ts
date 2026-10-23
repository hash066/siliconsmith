// Pane sizes for the three-pane app layout: pure clamping and (de)serialising, so the persisted value can never break the layout.

export interface PaneLayout {
  left: number;
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export const LAYOUT_KEY = "hw-app-layout-v1";
export const LIMITS = { leftMin: 232, leftMax: 520, rightMin: 300, rightMax: 640, centreMin: 380, collapsed: 44, handle: 8 } as const;
export const DEFAULT_LAYOUT: PaneLayout = { left: 300, right: 380, leftCollapsed: false, rightCollapsed: false };

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function parseLayout(raw: string | null): PaneLayout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const j = JSON.parse(raw) as Partial<PaneLayout>;
    return {
      left: num(j.left, DEFAULT_LAYOUT.left),
      right: num(j.right, DEFAULT_LAYOUT.right),
      leftCollapsed: j.leftCollapsed === true,
      rightCollapsed: j.rightCollapsed === true,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Fit the layout to the container: each pane inside its limits and the centre never narrower than `centreMin` (the side panes give way, right first). */
export function clampLayout(l: PaneLayout, containerWidth: number): PaneLayout {
  const { leftMin, leftMax, rightMin, rightMax, centreMin, collapsed, handle } = LIMITS;
  let left = Math.min(leftMax, Math.max(leftMin, l.left));
  let right = Math.min(rightMax, Math.max(rightMin, l.right));
  if (containerWidth > 0) {
    const lw = () => (l.leftCollapsed ? collapsed : left);
    const rw = () => (l.rightCollapsed ? collapsed : right);
    const over = () => lw() + rw() + 2 * handle + centreMin - containerWidth;
    if (over() > 0 && !l.rightCollapsed) right = Math.max(rightMin, right - over());
    if (over() > 0 && !l.leftCollapsed) left = Math.max(leftMin, left - over());
  }
  return { ...l, left: Math.round(left), right: Math.round(right) };
}

/** Grid template for the wide layout. The centre track is `minmax(0,1fr)` so it can never force horizontal overflow. */
export function gridTemplate(l: PaneLayout): string {
  const lw = l.leftCollapsed ? LIMITS.collapsed : l.left;
  const rw = l.rightCollapsed ? LIMITS.collapsed : l.right;
  return `${lw}px ${LIMITS.handle}px minmax(0,1fr) ${LIMITS.handle}px ${rw}px`;
}

/** Keyboard step for a handle: arrows move 16 px, with Shift 64 px. Returns the signed pixel delta along the x axis, or null for other keys. */
export function keyDelta(key: string, shift: boolean): number | null {
  const step = shift ? 64 : 16;
  if (key === "ArrowLeft") return -step;
  if (key === "ArrowRight") return step;
  return null;
}
