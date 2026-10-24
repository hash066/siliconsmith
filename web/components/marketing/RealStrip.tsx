import Link from "next/link";
import { Icon, type IconName } from "./icons";

/** What a visitor can do right now without an account, and what is not claimed. */
export function RealStrip({ entryId }: { entryId: string }) {
  const items: { icon: IconName; title: string; text: string; href?: string; code?: string }[] = [
    { icon: "game", title: "Play the Bench", text: "Games run on the real engines.", href: "#bench" },
    { icon: "arrow", title: "Open the app", text: "Board and Matter checks are free.", href: "/app" },
    { icon: "chat", title: "Ask the agent", text: "Runs on demo credits.", href: "/app" },
    { icon: "shield", title: "Reproduce a proof", text: "Run it yourself with the CLI.", code: `siliconsmith verify-entry ${entryId}` },
  ];
  return (
    <section id="real" className="mk-section mk-center" style={{ paddingBlock: "clamp(40px, 6vw, 72px)" }} aria-labelledby="real-h">
      <div className="mk-wrap">
        <p id="real-h" className="hw-label mk-reveal">
          What is real
        </p>
        <div className="mk-real mk-reveal">
          {items.map((i) => {
            const body = (
              <>
                <span className="mk-tile-ico" style={{ ["--c" as string]: "var(--hw-pcb)" }}>
                  <Icon name={i.icon} size={20} />
                </span>
                <h3>{i.title}</h3>
                <p>{i.text}</p>
                {i.code && <code className="mk-mono">{i.code}</code>}
              </>
            );
            return i.href ? (
              <Link key={i.title} href={i.href.startsWith("#") ? { hash: i.href.slice(1) } : i.href} className="mk-card mk-real-item">
                {body}
              </Link>
            ) : (
              <div key={i.title} className="mk-card mk-real-item">
                {body}
              </div>
            );
          })}
        </div>
        <p className="mk-reveal" style={{ marginTop: 20, fontSize: 13.5, color: "var(--hw-ink-3)", maxWidth: "70ch", marginInline: "auto", lineHeight: 1.55 }}>
          Honest limits: Silicon search runs are replays of real runs, Board checks are netlist-level, and Matter gains are small.
        </p>
      </div>
    </section>
  );
}
