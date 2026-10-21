"use client";

import type { NodeId } from "@/lib/events";
import { stageStrip, type RunState } from "@/lib/run-state";
import { GlyphIcon } from "./NodeGlyph";
import { rowValue, stageFill, TONE_VAR, visualOf, VISUAL_LABEL } from "./status";

/** The search tree as an indented list: the phone composition of the branch tree. */
export function OutlineTree({ state, selected, onSelect }: { state: RunState; selected: NodeId | null; onSelect: (id: NodeId) => void }) {
  const rows: Array<{ id: NodeId; depth: number }> = [];
  const walk = (id: NodeId, depth: number) => {
    rows.push({ id, depth });
    for (const c of state.nodes[id]?.children ?? []) if (state.nodes[c]) walk(c, depth + 1);
  };
  if (state.rootId) walk(state.rootId, 0);

  return (
    <ul role="tree" aria-label="Search tree of candidate CPUs" className="divide-y divide-line/60">
      {rows.map(({ id, depth }) => {
        const n = state.nodes[id];
        const visual = visualOf(n, state);
        const v = rowValue(n, state);
        const isRoot = depth === 0;
        const sel = selected === id;
        return (
          <li key={id} role="none">
            <button
              type="button"
              role="treeitem"
              aria-selected={sel}
              onClick={() => onSelect(id)}
              className={`flex min-h-11 w-full items-center gap-2 pr-3 text-left transition-colors duration-150 ${sel ? "bg-raised" : "hover:bg-raised/60"}`}
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              <GlyphIcon visual={visual} />
              <span className="num min-w-0 flex-1 truncate text-[13px]" style={{ color: visual === "nogain" || visual === "failed" || visual === "budget" ? "var(--ink-3)" : "var(--ink)" }}>
                {isRoot ? "baseline" : n.proposal?.kind === "area" ? "area polish" : n.proposal?.kind === "software" ? "sw polish" : n.proposal?.mnemonic}
                <span className="ml-2 text-[11px] text-ink-3">{id}</span>
              </span>
              {!isRoot && (
                <span className="flex gap-[2px]" aria-hidden="true">
                  {stageStrip(n).map((s) => (
                    <span key={s.stage} className={`block h-2 w-1 rounded-[1px] ${s.status === "running" ? "anim-breathe" : ""}`} style={{ background: stageFill(s.status) }} />
                  ))}
                </span>
              )}
              <span className="num w-16 text-right text-[12px]" style={{ color: TONE_VAR[v.tone] }}>
                {isRoot ? "1.00×" : v.text}
              </span>
              <span className="sr-only">{VISUAL_LABEL[visual]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
