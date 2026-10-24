"use client";

import { useMemo, useRef, useState } from "react";
import { isGround, schematicOf, type DesignIn, type SPin, type SSymbol } from "@/lib/schematic";

const INK = "var(--ink)";
const DIM = "var(--ink-3)";
const LINE = "var(--hw-pcb)";
const FAIL = "#ff4d4d";
const OK = "#5fd38d";

function Body({ s }: { s: SSymbol }) {
  const mid = s.h / 2;
  const stroke = { stroke: LINE, strokeWidth: 1.6, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (s.kind) {
    case "resistor":
      return <path d={`M0 ${mid} H10 L14 ${mid - 8} L22 ${mid + 8} L30 ${mid - 8} L38 ${mid + 8} L46 ${mid - 8} L50 ${mid} H${s.w}`} {...stroke} />;
    case "capacitor":
      return <path d={`M0 ${mid} H${s.w / 2 - 4} M${s.w / 2 - 4} ${mid - 10} V${mid + 10} M${s.w / 2 + 4} ${mid - 10} V${mid + 10} M${s.w / 2 + 4} ${mid} H${s.w}`} {...stroke} />;
    case "led":
      return <path d={`M0 ${mid} H${s.w / 2 - 8} M${s.w / 2 - 8} ${mid - 9} L${s.w / 2 + 8} ${mid} L${s.w / 2 - 8} ${mid + 9} Z M${s.w / 2 + 8} ${mid - 9} V${mid + 9} M${s.w / 2 + 8} ${mid} H${s.w}`} {...stroke} />;
    case "button":
      return <path d={`M0 ${mid} H14 M${s.w - 14} ${mid} H${s.w} M14 ${mid} L${s.w - 16} ${mid - 11}`} {...stroke} />;
    default:
      return <rect width={s.w} height={s.h} rx={4} {...stroke} fill="var(--panel)" strokeWidth={s.kind === "connector" ? 2 : 1.6} />;
  }
}

function PinMark({ s, p, hot, onHover }: { s: SSymbol; p: SPin; hot: boolean; onHover: (n: string | null) => void }) {
  const dx = p.side === "left" ? 1 : p.side === "right" ? -1 : 0;
  const dy = p.side === "top" ? 1 : p.side === "bottom" ? -1 : 0;
  const x0 = p.x + dx * 16;
  const y0 = p.y + dy * 16;
  const gnd = isGround(p.net);
  const col = p.mark?.kind === "fail" ? FAIL : p.mark?.kind === "wired" ? OK : hot ? "var(--hw-steel)" : LINE;
  const anchor = p.side === "left" ? "end" : p.side === "right" ? "start" : "middle";
  const lx = p.side === "left" ? p.x - 4 : p.side === "right" ? p.x + 4 : p.x;
  const ly = p.side === "top" ? p.y - 5 : p.side === "bottom" ? p.y + 13 : p.y + 3.5;
  const two = s.kind !== "ic" && s.kind !== "connector";
  return (
    <g onMouseEnter={() => p.net && onHover(p.net)} onMouseLeave={() => onHover(null)} data-pin={`${s.ref}.${p.name}`} data-net={p.net}>
      <line x1={x0} y1={y0} x2={p.x} y2={p.y} stroke={col} strokeWidth={1.4} strokeDasharray={p.net === "" ? "3 3" : undefined} />
      {p.mark && <circle cx={p.x} cy={p.y} r={5.5} fill="none" stroke={col} strokeWidth={1.6} className="hw-marker" data-testid={`sch-mark-${p.mark.kind}-${p.name}`} />}
      {/* the net label, past the stub */}
      {p.net !== "" && (gnd ? (
        <g stroke={col} strokeWidth={1.4}>
          <line x1={p.x + dx * -0 - 0} y1={p.y} x2={p.x} y2={p.y} />
          {p.side === "bottom" ? (
            <>
              <line x1={p.x - 7} y1={p.y + 3} x2={p.x + 7} y2={p.y + 3} />
              <line x1={p.x - 4.5} y1={p.y + 6.5} x2={p.x + 4.5} y2={p.y + 6.5} />
              <line x1={p.x - 2} y1={p.y + 10} x2={p.x + 2} y2={p.y + 10} />
            </>
          ) : null}
        </g>
      ) : null)}
      {p.net !== "" && !(gnd && p.side === "bottom") && (
        <text x={lx} y={ly} textAnchor={anchor} fontSize="10.5" fontFamily="var(--font-code), monospace" fill={hot ? "var(--hw-steel)" : col === LINE ? INK : col} fontWeight={hot ? 700 : 400}>
          {p.net}
        </text>
      )}
      {p.net === "" && p.mark && (
        <text x={lx} y={ly} textAnchor={anchor} fontSize="10" fill={col}>
          not wired
        </text>
      )}
      {/* the pin's own name, inside a box symbol */}
      {!two && (
        <text x={p.side === "left" ? 5 : p.side === "right" ? s.w - 5 : p.x} y={p.side === "top" ? 12 : p.side === "bottom" ? s.h - 5 : p.y + 3.5} textAnchor={p.side === "left" ? "start" : p.side === "right" ? "end" : "middle"} fontSize="9.5" fill={DIM} fontFamily="var(--font-code), monospace">
          {p.name}
        </text>
      )}
      {p.mark && (
        <text x={lx} y={ly + (p.side === "top" || p.side === "bottom" ? 0 : 11)} textAnchor={anchor} fontSize="9" fill={col}>
          {p.net === "" ? "" : ""}
          {p.mark.text}
        </text>
      )}
    </g>
  );
}

/** The design as a schematic: symbols, pin names, net labels; hover a label to light up everything on that net. */
export function SchematicView({ design }: { design: DesignIn }) {
  const sch = useMemo(() => schematicOf(design), [design]);
  const [net, setNet] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const download = () => {
    const el = svg.current;
    if (!el) return;
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.insertAdjacentHTML("afterbegin", `<style>text{font-family:monospace}</style><rect width="100%" height="100%" fill="#ffffff"/>`);
    // the page's colour tokens do not exist in a standalone file: swap in plain colours
    const text = clone.outerHTML.replace(/var\(--ink-3\)/g, "#667").replace(/var\(--ink\)/g, "#111").replace(/var\(--hw-pcb\)/g, "#0a7d54").replace(/var\(--hw-steel\)/g, "#1b5fd6").replace(/var\(--panel\)/g, "#ffffff").replace(/var\(--font-code\), /g, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    a.download = "schematic.svg";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <div className="min-w-0" data-testid="schematic">
      <div role="region" aria-label="Schematic" tabIndex={0} className="scroll-quiet overflow-x-auto rounded-xl border border-line bg-sunken">
        <svg ref={svg} viewBox={`0 0 ${sch.width} ${sch.height}`} width={sch.width} height={sch.height} className="block max-w-none" role="img" aria-label={`Schematic with ${sch.sections.reduce((n, s) => n + s.symbols.length, 0)} parts. Each pin is labelled with the net it connects to.`}>
          {sch.sections.map((sec) => (
            <g key={sec.title}>
              <text x={8} y={sec.y + 12} fontSize="11" letterSpacing="0.12em" fill={DIM} style={{ textTransform: "uppercase" }}>
                {sec.title}
              </text>
              {sec.symbols.map((s) => (
                <g key={s.ref} transform={`translate(${s.x} ${s.y})`}>
                  <Body s={s} />
                  <text x={s.w / 2} y={-6} textAnchor="middle" fontSize="11.5" fontWeight="600" fill={INK}>
                    {s.ref}
                  </text>
                  <text x={s.w / 2} y={s.kind === "ic" || s.kind === "connector" ? s.h / 2 + 4 : s.h + 14} textAnchor="middle" fontSize="10.5" fill={DIM} fontFamily="var(--font-code), monospace">
                    {s.value || s.part}
                  </text>
                  {s.pins.map((p) => (
                    <PinMark key={p.name} s={s} p={p} hot={net !== null && p.net === net} onHover={setNet} />
                  ))}
                </g>
              ))}
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        <span className="min-h-[18px] flex-1" aria-live="polite">
          {net ? `Net ${net}` : "Hover a net label to light it up. A dashed pin is not connected on the board."}
        </span>
        <button type="button" onClick={download} className="h-8 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 hover:text-ink" data-testid="schematic-download">
          Download as SVG
        </button>
      </div>
    </div>
  );
}
