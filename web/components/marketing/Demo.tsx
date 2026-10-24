"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { RecordedAgent } from "@/lib/facts";
import { Icon } from "./icons";
import { useReducedMotion } from "./runtime";
import { applyEvent, type Seg } from "./recorded";
import { Md } from "./Md";
import { ToolCard } from "./Solution";

type Status = "idle" | "playing" | "done";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function Demo({ sessions }: { sessions: RecordedAgent[] }) {
  const [idx, setIdx] = useState(0);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [asked, setAsked] = useState(false);
  const token = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const s = sessions[idx];

  const reset = useCallback(() => {
    token.current++;
    setSegs([]);
    setAsked(false);
    setStatus("idle");
  }, []);

  useEffect(() => () => void token.current++, []);

  const play = useCallback(async () => {
    const mine = ++token.current;
    setSegs([]);
    setAsked(false);
    setStatus("playing");
    const alive = () => token.current === mine;
    await sleep(reduce ? 0 : 250);
    if (!alive()) return;
    setAsked(true);
    let acc: Seg[] = [];
    for (const e of s.events) {
      if (!alive()) return;
      const wait = reduce ? 0 : e.type === "text.delta" ? 28 : e.type === "tool.call" ? 500 : e.type === "tool.result" ? 900 : e.type === "evidence" ? 350 : 0;
      if (wait) await sleep(wait);
      if (!alive()) return;
      acc = applyEvent(acc, e);
      setSegs(acc);
    }
    if (alive()) setStatus("done");
  }, [s, reduce]);

  // keep the newest message in view while playing
  useEffect(() => {
    const el = logRef.current;
    if (el && status === "playing") el.scrollTop = el.scrollHeight;
  }, [segs, status]);

  const pick = (i: number) => {
    token.current++;
    setIdx(i);
    setSegs([]);
    setAsked(false);
    setStatus("idle");
  };

  return (
    <section id="demo" className="mk-section mk-center" aria-labelledby="demo-h">
      <div className="mk-wrap" style={{ maxWidth: 940 }}>
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-steel)" } as CSSProperties}>
          <Icon name="chat" size={14} /> See it in action
        </span>
        <h2 id="demo-h" className="hw-display mk-h2 mk-reveal">
          Watch the agent <span className="mk-grad">use the tools</span>
        </h2>
        <p className="mk-sub mk-reveal">Real sessions, replayed. Press Play.</p>

        <div className="mk-tabs mk-reveal" role="tablist" aria-label="Recorded sessions" style={{ marginTop: 32 }}>
          {sessions.map((x, i) => (
            <button key={x.id} role="tab" type="button" className="mk-tab" aria-selected={i === idx} onClick={() => pick(i)}>
              {x.title}
            </button>
          ))}
        </div>

        <div className="mk-win mk-reveal" style={{ textAlign: "left" }}>
          <div className="mk-win-bar" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span className="mk-chip mk-chip-sm" style={{ ["--chip" as string]: "var(--hw-steel)" } as CSSProperties}>
                Recorded session
              </span>
              <span className="mk-mono" style={{ fontSize: 12 }}>
                {s.model} · {s.captured}
              </span>
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" className="mk-btn mk-btn-sm mk-btn-primary" onClick={play} disabled={status === "playing"}>
                <Icon name="play" size={13} /> {status === "done" ? "Replay" : "Play"}
              </button>
              <button type="button" className="mk-btn mk-btn-sm" onClick={reset} disabled={status === "idle"}>
                <Icon name="reset" size={14} /> Reset
              </button>
            </span>
          </div>
          <div ref={logRef} className="mk-pane" style={{ height: 430 }} role="log" tabIndex={0} aria-live="polite" aria-label={`Recorded session: ${s.title}`}>
            {!asked ? (
              <div className="mk-empty">
                <Icon name="play" size={30} />
                <span style={{ maxWidth: "34ch" }}>Press Play to replay “{s.title}”.</span>
              </div>
            ) : (
              <>
                <div className="mk-user mk-msg-in">{s.question}</div>
                {segs.map((g, i) =>
                  g.kind === "text" ? (
                    <div key={i} className="mk-bot mk-msg-in">
                      <Md text={g.text.trim()} />
                      {status === "playing" && i === segs.length - 1 && <span className="mk-caret" aria-hidden="true" />}
                    </div>
                  ) : g.kind === "tool" ? (
                    <div key={i} className="mk-msg-in">
                      <ToolCard s={g} />
                    </div>
                  ) : (
                    <div key={i} className="mk-msg-in" style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {g.ids.map((id) => (
                        <span key={id} className="mk-chip mk-chip-sm mk-mono" style={{ ["--chip" as string]: "var(--hw-pcb)", height: "auto", whiteSpace: "normal", overflowWrap: "anywhere", paddingBlock: 4 } as CSSProperties}>
                          <Icon name="file" size={12} /> {id}
                        </span>
                      ))}
                    </div>
                  ),
                )}
                {status === "done" && (
                  <p className="mk-msg-in" style={{ marginTop: 16, fontSize: 12.5, color: "var(--hw-ink-3)" }}>
                    End of recording. {s.toolCalls} tool call{s.toolCalls === 1 ? "" : "s"}. The agent endpoint reports no cost for this session.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <p className="mk-reveal" style={{ marginTop: 14, fontSize: 12.5, color: "var(--hw-ink-3)" }}>
          The events are the saved stream from the live agent. Only the playback speed is set for reading.
        </p>
      </div>
    </section>
  );
}
