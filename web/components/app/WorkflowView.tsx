"use client";

import { useEffect, useRef, useState } from "react";
import { STATUS_WORDS, type StepStatus, type WfNode, type Workflow } from "@/lib/workflow";
import { btnGhost } from "./ui";

const W = 236;
const GAP = 64;
const PAD = 16;
const HEAD = 34;
const SUMMARY = 46;
const ITEM = 22;
const ROW_GAP = 22;

const TONE: Record<StepStatus, string> = {
  idle: "var(--ink-3)",
  running: "var(--hw-warn)",
  done: "var(--hw-ok)",
  fail: "var(--hw-bad)",
  warn: "var(--hw-warn)",
  skipped: "var(--ink-3)",
};
const KIND_WORD: Record<WfNode["kind"], string> = { input: "Input", agent: "Agent", tool: "Tool", check: "Check", output: "Output" };

const OPEN_H = 36;
const heightOf = (n: WfNode) => HEAD + SUMMARY + (n.items?.length ? n.items.length * ITEM + 10 : 0) + 8 + (n.open ? OPEN_H : 0);

function Glyph({ s }: { s: StepStatus }) {
  const c = TONE[s];
  if (s === "done")
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill={c} opacity="0.2" />
        <path d="M4 7.2l2 2 4-4.4" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (s === "fail")
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill={c} opacity="0.2" />
        <path d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (s === "running")
    return <span aria-hidden="true" className="hw-wf-spin inline-block h-3 w-3 rounded-full border-2 border-[var(--hw-warn)] border-t-transparent" />;
  if (s === "warn")
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 1.8l5.6 9.8H1.4z" fill={c} opacity="0.2" stroke={c} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M7 5.5v2.6M7 9.6v.1" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  return <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full border ${s === "skipped" ? "border-dashed" : ""}`} style={{ borderColor: c }} />;
}

function Card({ n, style }: { n: WfNode; style?: React.CSSProperties }) {
  const tone = TONE[n.status];
  return (
    <article data-node={n.id} data-status={n.status} aria-label={`${n.title}: ${STATUS_WORDS[n.status]}`} className="min-w-0 rounded-xl border bg-panel" style={{ borderColor: n.status === "idle" ? "var(--line)" : tone, borderStyle: n.status === "skipped" ? "dashed" : "solid", width: W, ...style }}>
      <header className="flex h-[34px] items-center gap-2 rounded-t-xl border-b border-line bg-raised px-3">
        <Glyph s={n.status} />
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{n.title}</h3>
        <span className="hw-label !text-[9.5px]">{KIND_WORD[n.kind]}</span>
      </header>
      <div className="px-3 pt-2">
        <p className="line-clamp-2 h-[38px] break-words text-[12px] leading-snug text-ink-2" title={n.summary}>
          {n.summary}
        </p>
        {n.items && n.items.length > 0 && (
          <ul className="mt-1 mb-2 flex flex-col" aria-label={`${n.title} steps`}>
            {n.items.map((it) => (
              <li key={it.label} data-status={it.status} className="flex h-[22px] items-center gap-2 text-[11.5px] text-ink-2">
                <Glyph s={it.status} />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    setW(el.clientWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Positions of every card, and the size of the canvas that holds them. */
function layoutOf(wf: Workflow) {
  const cols = Math.max(...wf.nodes.map((n) => n.col)) + 1;
  const y = new Map<string, number>();
  for (let c = 0; c < cols; c++) {
    let at = PAD;
    for (const n of wf.nodes.filter((x) => x.col === c).sort((a, b) => a.row - b.row)) {
      y.set(n.id, at);
      at += heightOf(n) + ROW_GAP;
    }
  }
  const height = Math.max(...wf.nodes.map((n) => (y.get(n.id) ?? 0) + heightOf(n))) + PAD;
  const width = PAD * 2 + cols * W + (cols - 1) * GAP;
  return { y, height, width, x: (n: WfNode) => PAD + n.col * (W + GAP) };
}

function openButton(n: WfNode, onOpen: (t: "preview" | "proof" | "files") => void) {
  return n.open ? (
    <button type="button" onClick={() => onOpen(n.open!)} className={`${btnGhost} !h-7 !px-2.5 !text-[11.5px]`} data-testid={`wf-open-${n.id}`}>
      Open {n.open === "proof" ? "the proof" : n.open === "files" ? "the files" : "the preview"}
    </button>
  ) : null;
}

function Canvas({ wf, onOpen, scale = 1 }: { wf: Workflow; onOpen: (t: "preview" | "proof" | "files") => void; scale?: number }) {
  const { y, height, width, x } = layoutOf(wf);
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  return (
    <div style={{ width: width * scale, height: (height + 6) * scale }}>
      <div className="relative origin-top-left" style={{ width, height: height + 6, transform: `scale(${scale})` }}>
        <svg width={width} height={height + 6} className="pointer-events-none absolute inset-0" aria-hidden="true">
          {wf.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const x1 = x(a) + W;
            const y1 = (y.get(a.id) ?? 0) + HEAD / 2;
            const x2 = x(b);
            const y2 = (y.get(b.id) ?? 0) + HEAD / 2;
            const live = a.status === "done" || a.status === "warn";
            return (
              <g key={`${e.from}-${e.to}`}>
                <path d={`M${x1} ${y1} C${x1 + GAP * 0.6} ${y1}, ${x2 - GAP * 0.6} ${y2}, ${x2} ${y2}`} fill="none" stroke={live ? TONE[a.status] : "var(--line-2)"} strokeWidth="1.8" opacity={live ? 0.85 : 0.7} strokeDasharray={a.status === "skipped" ? "4 4" : undefined} />
                <circle cx={x1} cy={y1} r="3.2" fill={live ? TONE[a.status] : "var(--line-2)"} />
                <circle cx={x2} cy={y2} r="3.2" fill={b.status === "idle" ? "var(--line-2)" : TONE[b.status]} />
              </g>
            );
          })}
        </svg>
        {wf.nodes.map((n) => (
          <div key={n.id} className="absolute" style={{ left: x(n), top: y.get(n.id) }}>
            <Card n={n} />
            <div className="mt-1.5">{openButton(n, onOpen)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FullGraph({ wf, onOpen, onClose }: { wf: Workflow; onOpen: (t: "preview" | "proof" | "files") => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const avail = useWidth(box);
  const { width } = layoutOf(wf);
  const scale = avail > 0 ? Math.min(1, Math.max(0.5, (avail - 4) / width)) : 1;
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="The whole workflow" className="fixed inset-0 z-[60] flex flex-col bg-bg">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <h2 className="text-[14px] font-medium text-ink">The whole workflow</h2>
        <button ref={close} type="button" onClick={onClose} className={`${btnGhost} ml-auto !h-9`}>
          Close
        </button>
      </div>
      <div ref={box} className="scroll-quiet min-h-0 flex-1 overflow-auto p-6">
        <Canvas
          wf={wf}
          scale={scale}
          onOpen={(t) => {
            onClose();
            onOpen(t);
          }}
        />
      </div>
    </div>
  );
}

/** The project as connected steps. Where the canvas fits it is drawn left to right; otherwise a list, with the full graph one click away. Each step shows what really happened. */
export function WorkflowView({ wf, onOpen }: { wf: Workflow; onOpen: (t: "preview" | "proof" | "files") => void }) {
  const box = useRef<HTMLDivElement>(null);
  const avail = useWidth(box);
  const [full, setFull] = useState(false);
  const { width } = layoutOf(wf);
  const fits = avail >= width + 34;
  const legend = (
    <p className="px-1 text-[11.5px] leading-snug text-ink-3">Each box is a step that really ran. Green is done, red failed, amber needs a look or is running, grey was skipped or has not run yet.</p>
  );
  return (
    <div ref={box} className="flex min-w-0 flex-col gap-3 p-4" data-testid="workflow">
      {legend}
      {fits ? (
        <div role="region" aria-label="Workflow" tabIndex={0} className="scroll-quiet overflow-x-auto rounded-xl border border-line bg-sunken">
          <Canvas wf={wf} onOpen={onOpen} />
        </div>
      ) : (
        <>
          {avail > 0 && (
            <button type="button" onClick={() => setFull(true)} className={`${btnGhost} self-start`} data-testid="wf-full">
              Open the full graph
            </button>
          )}
          <ol className="flex flex-col items-stretch">
            {wf.nodes.map((n, i) => (
              <li key={n.id} className="flex flex-col items-center">
                <Card n={n} style={{ width: "100%" }} />
                <div className="mt-1.5">{openButton(n, onOpen)}</div>
                {i < wf.nodes.length - 1 && <span aria-hidden="true" className="my-1.5 h-5 w-px bg-line-2" />}
              </li>
            ))}
          </ol>
        </>
      )}
      {full && <FullGraph wf={wf} onOpen={onOpen} onClose={() => setFull(false)} />}
    </div>
  );
}
