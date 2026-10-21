"use client";

import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { motion } from "motion/react";
import { useMemo } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks";
import type { NodeId } from "@/lib/events";
import { lineage, stageStrip, type NodeState, type RunState } from "@/lib/run-state";
import { NodeGlyph } from "./NodeGlyph";
import { rowValue, stageFill, TONE_VAR, visualOf, VISUAL_LABEL } from "./status";

const EASE = [0.22, 1, 0.36, 1] as const;

interface Layout {
  id: NodeId;
  x: number;
  y: number;
  depth: number;
  parent: NodeId | null;
}

export function useTreeLayout(state: RunState, row: number, colW: number, rootW: number) {
  return useMemo(() => {
    const rootId = state.rootId;
    if (!rootId || !state.nodes[rootId]) return { nodes: [] as Layout[], width: rootW, height: row * 2, maxDepth: 0 };
    const h = hierarchy<NodeState>(state.nodes[rootId], (n) => n.children.map((c) => state.nodes[c]).filter(Boolean));
    const laid = d3tree<NodeState>()
      .nodeSize([row, 1])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.35))(h);
    const all: HierarchyPointNode<NodeState>[] = laid.descendants();
    const minX = Math.min(...all.map((d) => d.x));
    const maxX = Math.max(...all.map((d) => d.x));
    const maxDepth = Math.max(state.config?.max_depth ?? 0, ...all.map((d) => d.depth));
    const nodes: Layout[] = all.map((d) => ({
      id: d.data.id,
      depth: d.depth,
      parent: d.parent?.data.id ?? null,
      x: d.depth === 0 ? 8 : rootW + (d.depth - 1) * colW,
      y: d.x - minX + row * 0.75,
    }));
    return { nodes, width: rootW + maxDepth * colW, height: maxX - minX + row * 1.5, maxDepth };
  }, [state.nodes, state.rootId, state.config?.max_depth, row, colW, rootW]);
}

export function BranchTree({
  state,
  selected,
  onSelect,
  compact = false,
}: {
  state: RunState;
  selected: NodeId | null;
  onSelect?: (id: NodeId) => void;
  compact?: boolean;
}) {
  const reduce = usePrefersReducedMotion();
  const ROW = compact ? 21 : 26;
  const COLW = compact ? 164 : 196;
  const ROOTW = compact ? 84 : 92;
  const { nodes, width, height, maxDepth } = useTreeLayout(state, ROW, COLW, ROOTW);
  const pos = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const bestPath = useMemo(() => new Set(state.best ? lineage(state, state.best).map((n) => n.id) : []), [state]);
  const selPath = useMemo(() => new Set(selected && state.nodes[selected] ? lineage(state, selected).map((n) => n.id) : []), [state, selected]);
  const perDepth = useMemo(() => {
    const c: number[] = [];
    for (const n of nodes) c[n.depth] = (c[n.depth] ?? 0) + 1;
    return c;
  }, [nodes]);

  const t = (d: number) => (reduce ? { duration: 0 } : { duration: d, ease: EASE });

  return (
    <div className="relative" style={{ width, minWidth: "100%" }}>
      {!compact && (
        <div className="sticky top-0 z-10 flex h-8 items-center bg-sunken/90 text-[12px] text-ink-3" aria-hidden="true">
          <span className="absolute" style={{ left: 0 }}>
            Baseline
          </span>
          {Array.from({ length: maxDepth }, (_, i) => (
            <span key={i} className="absolute whitespace-nowrap" style={{ left: ROOTW + i * COLW - 6 }}>
              Depth {i + 1}
              <span className="num text-ink-3/80"> · {perDepth[i + 1] ?? 0}</span>
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} role="tree" aria-label="Search tree of candidate CPUs" className="block overflow-visible">
        <g>
          {nodes.map((n) => {
            if (!n.parent) return null;
            const p = pos.get(n.parent);
            if (!p) return null;
            // Traces leave from the end of the parent's row and enter the child's pad: a PCB-style bus.
            const x1 = p.x + (p.depth === 0 ? ROOTW - 22 : COLW - 24) - 7;
            const x2 = n.x - 8;
            const xm = n.x - 14;
            const d = `M${x1},${p.y} H${xm} V${n.y} H${x2}`;
            const onBest = bestPath.has(n.id) && bestPath.has(n.parent);
            const onSel = selPath.has(n.id) && selPath.has(n.parent);
            return (
              <motion.path
                key={`l-${n.id}`}
                d={d}
                fill="none"
                stroke={onBest ? "var(--signal)" : onSel ? "var(--ink-2)" : "var(--line-2)"}
                strokeWidth={onBest ? 1.5 : 1}
                initial={reduce ? false : { pathLength: 0, opacity: 0.4 }}
                animate={{ pathLength: 1, opacity: 1, d }}
                transition={t(0.7)}
              />
            );
          })}
        </g>
        <g>
          {nodes.map((n) => {
            const node = state.nodes[n.id];
            const visual = visualOf(node, state);
            const isRoot = n.depth === 0;
            const val = rowValue(node, state);
            const isSel = selected === n.id;
            const mnemonic = isRoot ? "baseline" : (node.proposal?.mnemonic ?? n.id);
            const dim = visual === "nogain" || visual === "failed" || visual === "budget";
            const label = `${n.id} ${mnemonic}: ${VISUAL_LABEL[visual]}${val.text ? `, ${val.text}` : ""}`;
            const rowW = isRoot ? ROOTW - 22 : COLW - 24;
            const parent = n.parent ? pos.get(n.parent) : undefined;
            return (
              <motion.g
                key={n.id}
                role="treeitem"
                aria-selected={isSel}
                aria-label={label}
                tabIndex={onSelect ? 0 : -1}
                className={onSelect ? "cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-[var(--focus)]" : undefined}
                onClick={onSelect ? () => onSelect(n.id) : undefined}
                onKeyDown={
                  onSelect
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(n.id);
                        }
                      }
                    : undefined
                }
                initial={reduce ? false : { opacity: 0, x: parent ? parent.x + 20 : n.x, y: parent ? parent.y : n.y }}
                animate={{ opacity: 1, x: n.x, y: n.y }}
                transition={t(0.55)}
              >
                <rect
                  x={-9}
                  y={-ROW / 2 + 2}
                  width={rowW}
                  height={ROW - 4}
                  rx={4}
                  fill={isSel ? "var(--raised)" : "transparent"}
                  stroke={isSel ? "var(--signal-line)" : "transparent"}
                  strokeWidth={1}
                  className="transition-[fill] duration-150 hover:fill-[var(--raised)]"
                />
                <NodeGlyph visual={visual} size={compact ? 9 : 10} />
                <text
                  x={isRoot ? 12 : 11}
                  y={4}
                  className="num select-none"
                  fontSize={compact ? 11 : 11.5}
                  fill={dim ? "var(--ink-3)" : "var(--ink)"}
                  fontWeight={visual === "best" ? 600 : 400}
                >
                  {mnemonic}
                </text>
                {!isRoot && (
                  <g transform={`translate(${compact ? 72 : 76}, -4)`} aria-hidden="true">
                    {stageStrip(node).map((s, i) => (
                      <rect
                        key={s.stage}
                        x={i * 5}
                        y={0}
                        width={compact ? 3.5 : 4}
                        height={8}
                        rx={1}
                        fill={stageFill(s.status)}
                        className={s.status === "running" ? "anim-breathe" : undefined}
                      />
                    ))}
                  </g>
                )}
                {!isRoot && (
                  <text x={rowW - 10} y={4} textAnchor="end" className="num select-none" fontSize={compact ? 10.5 : 11} fill={TONE_VAR[val.tone]}>
                    {val.text}
                  </text>
                )}
                <title>{label}</title>
              </motion.g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
