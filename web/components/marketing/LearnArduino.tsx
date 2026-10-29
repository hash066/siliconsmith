import type { CSSProperties } from "react";
import { Icon } from "./icons";

export const LEARN_ARDUINO_URL = "https://learn-arduino-red.vercel.app/";

/** The Learn Arduino app, embedded as it is: interactive 3D lessons. It is its own site; nothing from it is copied or altered here. */
export function LearnArduino() {
  return (
    <section id="demo" className="mk-section mk-center" aria-labelledby="demo-h">
      <div className="mk-wrap" style={{ maxWidth: 940 }}>
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-steel)" } as CSSProperties}>
          <Icon name="chat" size={14} /> Try it yourself
        </span>
        <h2 id="demo-h" className="hw-display mk-h2 mk-reveal">
          Learn Arduino, <span className="mk-grad">hands on</span>
        </h2>
        <p className="mk-sub mk-reveal">Interactive 3D lessons for beginners. Click the board to explore it.</p>

        <div className="mk-win mk-reveal" style={{ textAlign: "left", marginTop: 32 }}>
          <div className="mk-win-bar" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <span className="mk-mono" style={{ fontSize: 12 }}>
              learn-arduino-red.vercel.app
            </span>
            <a className="mk-btn mk-btn-sm" href={LEARN_ARDUINO_URL} target="_blank" rel="noopener noreferrer">
              Open full page
            </a>
          </div>
          <iframe
            src={LEARN_ARDUINO_URL}
            title="Learn Arduino: interactive 3D lessons for beginners"
            loading="lazy"
            allow="fullscreen"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-pointer-lock"
            style={{ display: "block", width: "100%", height: 640, border: 0, background: "#f6ecda" }}
            data-testid="learn-arduino-frame"
          />
        </div>
      </div>
    </section>
  );
}
