"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import { Icon } from "./icons";
import { useReducedMotion } from "./runtime";
import { SECTIONS } from "./sections";

const LINKS = [
  { href: "#workbenches", label: "Workbenches" },
  { href: "#how", label: "How it works" },
  { href: "#bench", label: "The Bench" },
  { href: "#proof", label: "Proof" },
  { href: "#stack", label: "Stack" },
];

export function Logo() {
  return (
    <Link href="/" className="mk-logo" aria-label={`${BRAND.name} home`}>
      <span className="mk-logo-mark">
        <Icon name="chip" size={19} />
      </span>
      {BRAND.name}
    </Link>
  );
}

export function Nav() {
  const [light, setLight] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setLight(document.documentElement.dataset.theme === "light"), []);
  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [open]);

  const toggle = () => {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("ss-theme", next ? "light" : "dark");
    } catch {
      // the theme still switches for this visit
    }
  };

  return (
    <>
      <header className="mk-nav">
        <div className="mk-wrap mk-nav-in">
          <Logo />
          <nav aria-label="Main" className="mk-links">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button className="mk-iconbtn mk-theme-top" onClick={toggle} aria-label={light ? "Switch to dark theme" : "Switch to light theme"} aria-pressed={light}>
              <Icon name={light ? "moon" : "sun"} size={18} />
            </button>
            <Link href="/app" className="mk-btn mk-btn-primary mk-btn-sm">
              Launch App <Icon name="arrow" size={16} />
            </Link>
            <button className="mk-iconbtn mk-burger" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} aria-controls="mk-drawer">
              <Icon name={open ? "x" : "menu"} size={18} />
            </button>
          </div>
        </div>
      </header>
      {open && (
        <nav id="mk-drawer" aria-label="Sections" className="mk-drawer">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <button type="button" className="mk-drawer-theme" onClick={toggle}>
            <Icon name={light ? "moon" : "sun"} size={18} /> {light ? "Dark theme" : "Light theme"}
          </button>
        </nav>
      )}
    </>
  );
}

/** Right-edge vertical icon navigator with scroll-spy. Hidden below 1400px by CSS. */
export function Rail() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const reduce = useReducedMotion();
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return (
    <nav className="mk-rail" aria-label="Page sections">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          style={{ ["--c" as string]: s.color }}
          aria-current={active === s.id}
          aria-label={s.label}
          onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })}
        >
          <Icon name={s.icon} size={20} />
          <span className="tip" aria-hidden="true">
            {s.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
