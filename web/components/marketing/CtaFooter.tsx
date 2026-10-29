import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Icon } from "./icons";
import { Logo } from "./Nav";

export function Cta() {
  return (
    <section id="cta" className="mk-section" aria-labelledby="cta-h">
      <div className="mk-wrap">
        <div className="mk-cta mk-reveal">
          <h2 id="cta-h" className="hw-display mk-h2">
            Open the <span className="mk-grad">workstation</span>
          </h2>
          <p className="mk-sub" style={{ marginInline: "auto" }}>
            {BRAND.tagline}
          </p>
          <div style={{ marginTop: 30, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
            <Link href="/app" className="mk-btn mk-btn-primary">
              Launch App <Icon name="arrow" size={16} />
            </Link>
          </div>
          <div className="mk-checks">
            {["Board and Matter checks are free", "Agent runs on demo credits", "Nemotron is the only model"].map((t) => (
              <span key={t}>
                <span style={{ color: "var(--hw-ok)", display: "inline-flex" }}>
                  <Icon name="check" size={15} />
                </span>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Col({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h4>{title}</h4>
      <ul>
        {items.map(([label, href]) => (
          <li key={label}>
            {href.startsWith("http") ? (
              <a href={href} rel="noreferrer">
                {label}
              </a>
            ) : href.startsWith("/") ? (
              <Link href={href}>{label}</Link>
            ) : (
              <a href={href}>{label}</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mk-foot">
      <div className="mk-wrap">
        <div className="mk-foot-grid">
          <div style={{ minWidth: 0 }}>
            <Logo />
            <p style={{ marginTop: 16, maxWidth: "34ch", color: "var(--hw-ink-2)", fontSize: 14.5, lineHeight: 1.5 }}>{BRAND.sub}</p>
          </div>
          <Col title="Product" items={[["Launch App", "/app"], ["Workbenches", "#workbenches"], ["The Bench", "#bench"], ["How it works", "#how"]]} />
          <Col title="Proof" items={[["Learn Arduino", "#demo"], ["Chatbot vs verified", "#proof"], ["Pipeline", "#pipeline"], ["Architecture", "#stack"]]} />
          <Col title="Project" items={[["Code", BRAND.repo], ["Example pull request", BRAND.prExample]]} />
        </div>
        <div className="mk-foot-base">
          <span>
            <span className="mk-dot" aria-hidden="true" />
            Figures are computed at build time from real runs. Recorded content is labelled.
          </span>
          <span>Built for the Nebius × NVIDIA hackathon.</span>
        </div>
      </div>
    </footer>
  );
}
