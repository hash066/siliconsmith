"use client";
import { useId, useState, type CSSProperties } from "react";
import { WORKBENCHES } from "@/lib/brand";
import type { BoardFaultFact, RecordedAgent, RecordedChat } from "@/lib/facts";
import { Icon } from "./icons";
import { Md } from "./Md";
import { allSegments, type Seg } from "./recorded";

export function ToolCard({ s }: { s: Extract<Seg, { kind: "tool" }> }) {
  return (
    <div className="mk-toolcard mk-mono">
      <div>
        <Icon name="code" size={14} />
        <strong>{s.name}</strong>
        <span style={{ color: "var(--hw-ink-3)", overflowWrap: "anywhere" }}>{JSON.stringify(s.args)}</span>
      </div>
      <div style={{ color: s.status === "error" ? "var(--hw-bad)" : s.status === "ok" ? "var(--hw-ok)" : "var(--hw-warn)" }}>
        {s.status === "running" ? "running…" : s.summary}
      </div>
    </div>
  );
}

export function Solution({ session, chat, fault }: { session: RecordedAgent; chat: RecordedChat; fault: BoardFaultFact }) {
  const [verified, setVerified] = useState(true);
  const id = useId();
  const segs = allSegments(session.events);
  const rungs = ["B1", "B2", "B3", "B4", "B5"];
  const evidence = segs.find((s): s is Extract<Seg, { kind: "evidence" }> => s.kind === "evidence");
  const tc = { ["--tc" as string]: verified ? "var(--hw-pcb)" : "var(--hw-bad)" } as CSSProperties;
  return (
    <section id="workbenches" className="mk-section mk-center" aria-labelledby="sol-h">
      <div className="mk-bgfx" aria-hidden="true">
        <div className="mk-glow" style={{ width: 600, height: 600, left: "20%", top: "35%", background: "var(--hw-warn)", opacity: 0.1 }} />
      </div>
      <div className="mk-wrap" style={{ position: "relative" }}>
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-warn)" } as CSSProperties}>
          <Icon name="bulb" size={14} /> The solution
        </span>
        <h2 id="sol-h" className="hw-display mk-h2 mk-reveal">
          Meet <span className="mk-grad">Hardwright</span>
        </h2>
        <p className="mk-sub mk-reveal">Agents propose. Verifiers decide. Same question, two answers.</p>
        <div className="mk-reveal" style={{ marginTop: 22, display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {Object.values(WORKBENCHES).map((w) => (
            <span key={w.id} className="mk-chip" style={{ ["--chip" as string]: w.accent } as CSSProperties}>
              {w.name}
            </span>
          ))}
        </div>

        <div className="mk-win mk-reveal" style={{ marginTop: 44, textAlign: "left" }}>
          <div className="mk-win-bar">
            <span className="mk-dots" aria-hidden="true">
              <i style={{ background: "#ff6b5e" }} />
              <i style={{ background: "#f2c14e" }} />
              <i style={{ background: "#7bd88f" }} />
            </span>
            <span className="mk-mono">Hardwright · Board</span>
            <span className="mk-chip mk-chip-sm" style={{ marginLeft: "auto", ["--chip" as string]: "var(--hw-steel)" } as CSSProperties}>
              Recorded session
            </span>
          </div>
          <div className="mk-split">
            <div className="mk-pane" aria-live="polite">
              <div className="mk-user">{session.question}</div>
              {verified ? (
                <div key="v">
                  {segs.map((s, i) =>
                    s.kind === "text" ? (
                      <div key={i} className="mk-bot mk-msg-in">
                        {i === 0 && (
                          <div className="mk-bot-label hw-label">
                            Verified agent · {session.model}
                          </div>
                        )}
                        <Md text={s.text} />
                      </div>
                    ) : s.kind === "tool" ? (
                      <ToolCard key={i} s={s} />
                    ) : null,
                  )}
                </div>
              ) : (
                <div key="u" className="mk-bot mk-msg-in">
                  <div className="mk-bot-label hw-label" style={{ color: "var(--hw-bad)" }}>
                    Unverified chat · {chat.model.split("/").pop()}
                  </div>
                  <Md text={chat.answer} />
                </div>
              )}
            </div>
            <div className="mk-pane" style={{ background: "color-mix(in srgb, var(--hw-bg) 45%, transparent)" }}>
              {verified ? (
                <div className="mk-meter mk-msg-in" key="rv">
                  <p className="hw-label">Evidence · {fault.template}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {rungs.map((r) => (
                      <span key={r} className="mk-rung mk-mono" data-s={r === fault.failedRung ? "fail" : "pass"}>
                        <Icon name={r === fault.failedRung ? "x" : "check"} size={12} />
                        {r}
                      </span>
                    ))}
                  </div>
                  <div className="mk-kv">
                    <span>Rungs passing</span>
                    <b>
                      {fault.passed} of {fault.of}
                    </b>
                  </div>
                  <div className="mk-kv">
                    <span>Failing rung</span>
                    <b style={{ color: "var(--hw-bad)" }}>{fault.failedRung}</b>
                  </div>
                  <div className="mk-kv">
                    <span>Tool calls</span>
                    <b>{session.toolCalls}</b>
                  </div>
                  <div>
                    {evidence?.ids.map((e) => (
                      <span key={e} className="mk-chip mk-chip-sm mk-mono" style={{ ["--chip" as string]: "var(--hw-pcb)", height: "auto", whiteSpace: "normal", overflowWrap: "anywhere", paddingBlock: 4 } as CSSProperties}>
                        <Icon name="file" size={12} /> {e}
                      </span>
                    ))}
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--hw-ink-3)", lineHeight: 1.5 }}>Netlist-level check against author-curated part facts. It does not claim the board works on a bench.</p>
                </div>
              ) : (
                <div className="mk-empty mk-msg-in" key="re">
                  <span style={{ color: "var(--hw-bad)" }}>
                    <Icon name="alert" size={34} />
                  </span>
                  <strong style={{ color: "var(--hw-ink)" }}>Nothing was checked</strong>
                  <div style={{ width: "100%", maxWidth: 300 }}>
                    <div className="mk-kv">
                      <span>Tool calls</span>
                      <b>{chat.toolCalls}</b>
                    </div>
                    <div className="mk-kv">
                      <span>Evidence cited</span>
                      <b>{chat.evidenceIds}</b>
                    </div>
                    <div className="mk-kv">
                      <span>Words written</span>
                      <b>{chat.words}</b>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--hw-border)", padding: "14px 16px", display: "flex", justifyContent: "center" }}>
            <div className="mk-toggle" role="radiogroup" aria-label="Answer type" data-on={verified ? 1 : 0} style={tc}>
              <span className="thumb" aria-hidden="true" />
              <button type="button" role="radio" aria-checked={!verified} id={`${id}-u`} onClick={() => setVerified(false)}>
                Unverified chat
              </button>
              <button type="button" role="radio" aria-checked={verified} id={`${id}-v`} onClick={() => setVerified(true)}>
                Verified agent
              </button>
            </div>
          </div>
        </div>
        <p className="mk-reveal" style={{ marginTop: 14, fontSize: 12.5, color: "var(--hw-ink-3)" }}>
          Both answers were recorded on {chat.captured} from Nemotron through Nebius Token Factory. The chat answer used no tools and costs ${chat.costUsd.toFixed(4)}.
        </p>
      </div>
    </section>
  );
}
