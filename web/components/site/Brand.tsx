"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** The mark: a die outline with its pin rows and the pin-1 marker in the signal colour. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {[8.5, 12, 15.5].map((p) => (
        <g key={p} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <line x1={p} y1="1.8" x2={p} y2="3.4" />
          <line x1={p} y1="20.6" x2={p} y2="22.2" />
          <line x1="1.8" y1={p} x2="3.4" y2={p} />
          <line x1="20.6" y1={p} x2="22.2" y2={p} />
        </g>
      ))}
      <circle cx="8.6" cy="8.6" r="1.7" fill="var(--signal)" />
    </svg>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-ink" aria-label="SiliconSmith home">
      <Mark />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">SiliconSmith</span>
    </Link>
  );
}

export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => setLight(document.documentElement.dataset.theme === "light"), []);
  const flip = () => {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("ss-theme", next ? "light" : "dark");
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      title={light ? "Dark theme" : "Light theme"}
      className="grid h-9 w-9 place-items-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink"
    >
      {light ? (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="8" y1="1.4" x2="8" y2="2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" transform={`rotate(${a} 8 8)`} />
          ))}
        </svg>
      )}
    </button>
  );
}

export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-amber-dim px-2.5 text-[12px] font-medium text-amber ${className}`}
      title="This run is invented sample data in the event-contract format, not a real engine run"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <line x1="5" y1="2.8" x2="5" y2="5.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="5" cy="7.2" r="0.7" fill="currentColor" />
      </svg>
      Demo data
    </span>
  );
}
