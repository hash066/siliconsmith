"use client";
import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { BoardFaultFact, RecordedAgent, RecordedChat } from "@/lib/facts";
import { Icon } from "./icons";
import { Md } from "./Md";
import { allSegments, finalText } from "./recorded";

export function Compare({ session, chat, fault }: { session: RecordedAgent; chat: RecordedChat; fault: BoardFaultFact }) {
  const [p, setP] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const segs = allSegments(session.events);
  const verified = finalText(segs);

  const setFromX = useCallback((x: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setP(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)));
  }, []);
  const down = (e: PointerEvent) => {
    drag.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setFromX(e.clientX);
  };
  const move = (e: PointerEvent) => drag.current && setFromX(e.clientX);
  const up = () => (drag.current = false);
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 4;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") setP((v) => Math.max(0, v - step));
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") setP((v) => Math.min(100, v + step));
    else if (e.key === "Home") setP(0);
    else if (e.key === "End") setP(100);
    else return;
    e.preventDefault();
  };

  return (
    <section id="proof" className="mk-section mk-center" aria-labelledby="proof-h">
      <div className="mk-wrap" style={{ maxWidth: 1000 }}>
        <h2 id="proof-h" className="hw-display mk-h2 mk-reveal">
          See the <span className="mk-grad">difference</span>
        </h2>
        <p className="mk-sub mk-reveal">The same board question, answered by a chatbot and by the agent with its tools.</p>
        <div className="mk-reveal" style={{ marginTop: 44 }}>
          <div
            ref={box}
            className="mk-cmp"
            style={{ ["--p" as string]: p, textAlign: "left" } as CSSProperties}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            <div className="mk-cmp-layer mk-cmp-good">
              <div className="mk-cmp-col mk-cmp-col-r">
                <span className="mk-chip mk-chip-sm" style={{ ["--chip" as string]: "var(--hw-ok)", width: "fit-content" } as CSSProperties}>
                  After
                </span>
                <h3 className="hw-display" style={{ fontSize: "1.3rem" }}>Verified answer</h3>
                <p className="mk-cmp-text"><Md text={verified} /></p>
                <div className="mk-statrow">
                  <span className="mk-rung mk-mono" data-s="pass">{session.toolCalls} tool call</span>
                  <span className="mk-rung mk-mono" data-s="pass">1 evidence id</span>
                  <span className="mk-rung mk-mono" data-s="fail">{fault.failedRung} fails</span>
                </div>
              </div>
            </div>
            <div className="mk-cmp-layer mk-cmp-bad" aria-hidden={p < 8}>
              <div className="mk-cmp-col">
                <span className="mk-chip mk-chip-sm" style={{ ["--chip" as string]: "var(--hw-bad)", width: "fit-content" } as CSSProperties}>
                  Before
                </span>
                <h3 className="hw-display" style={{ fontSize: "1.3rem" }}>Chatbot answer</h3>
                <p className="mk-cmp-text"><Md text={chat.answer} /></p>
                <div className="mk-statrow">
                  <span className="mk-rung mk-mono" data-s="fail">{chat.toolCalls} checks run</span>
                  <span className="mk-rung mk-mono" data-s="fail">{chat.evidenceIds} evidence ids</span>
                  <span className="mk-rung mk-mono">{chat.words} words</span>
                </div>
              </div>
            </div>
            <div
              className="mk-handle"
              role="slider"
              tabIndex={0}
              aria-label="Compare the chatbot answer with the verified answer"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(p)}
              aria-valuetext={`${Math.round(p)} percent chatbot answer shown`}
              onKeyDown={key}
            >
              <i>
                <Icon name="split" size={20} />
              </i>
            </div>
          </div>
          <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--hw-ink-3)" }}>
            Drag the divider or use the arrow keys. Recorded session, {chat.model.split("/").pop()}, {chat.captured}. The chatbot answer is unverified and costs ${chat.costUsd.toFixed(4)}.
          </p>
        </div>
      </div>
    </section>
  );
}
