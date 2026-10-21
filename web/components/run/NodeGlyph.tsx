import type { Visual } from "./status";

/** The pad drawn for a node: an IC pad whose fill and outline encode its state. 10×10, centred on 0,0. */
export function NodeGlyph({ visual, size = 10 }: { visual: Visual; size?: number }) {
  const h = size / 2;
  switch (visual) {
    case "baseline":
      return <rect x={-h - 1} y={-h - 1} width={size + 2} height={size + 2} rx={1.5} fill="var(--panel)" stroke="var(--ink-2)" strokeWidth={1.5} />;
    case "best":
      return (
        <g>
          <rect x={-h - 3.5} y={-h - 3.5} width={size + 7} height={size + 7} rx={3} fill="none" stroke="var(--signal)" strokeWidth={1} />
          <rect x={-h} y={-h} width={size} height={size} rx={2} fill="var(--signal)" />
        </g>
      );
    case "feasible":
      return <rect x={-h} y={-h} width={size} height={size} rx={2} fill="var(--ink)" />;
    case "unproven":
      return (
        <g>
          <rect x={-h + 0.75} y={-h + 0.75} width={size - 1.5} height={size - 1.5} rx={1.5} fill="none" stroke="var(--amber)" strokeWidth={1.5} />
          <rect x={-1.5} y={-1.5} width={3} height={3} fill="var(--amber)" />
        </g>
      );
    case "budget":
      return <rect x={-h + 0.75} y={-h + 0.75} width={size - 1.5} height={size - 1.5} rx={1.5} fill="var(--amber-dim)" stroke="var(--amber)" strokeWidth={1.5} />;
    case "nogain":
      return <rect x={-h + 0.75} y={-h + 0.75} width={size - 1.5} height={size - 1.5} rx={1.5} fill="none" stroke="var(--ink-3)" strokeWidth={1.25} />;
    case "failed":
      return (
        <g stroke="var(--red)" strokeWidth={1.6} strokeLinecap="round">
          <line x1={-h + 1} y1={-h + 1} x2={h - 1} y2={h - 1} />
          <line x1={h - 1} y1={-h + 1} x2={-h + 1} y2={h - 1} />
        </g>
      );
    case "running":
      return <rect className="anim-breathe" x={-h + 0.75} y={-h + 0.75} width={size - 1.5} height={size - 1.5} rx={1.5} fill="var(--signal-dim)" stroke="var(--signal)" strokeWidth={1.5} />;
    case "repairing":
      return <rect className="anim-breathe" x={-h + 0.75} y={-h + 0.75} width={size - 1.5} height={size - 1.5} rx={1.5} fill="var(--amber-dim)" stroke="var(--amber)" strokeWidth={1.5} />;
    case "queued":
      return <rect x={-h + 0.75} y={-h + 0.75} width={size - 1.5} height={size - 1.5} rx={1.5} fill="none" stroke="var(--line-2)" strokeWidth={1.25} strokeDasharray="2 2" />;
  }
}

/** The same glyph as a standalone inline SVG, for legends and lists. */
export function GlyphIcon({ visual, size = 10, className }: { visual: Visual; size?: number; className?: string }) {
  const box = size + 8;
  return (
    <svg width={box} height={box} viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`} className={className} aria-hidden="true">
      <NodeGlyph visual={visual} size={size} />
    </svg>
  );
}
