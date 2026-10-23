// Small stroke icons (24 grid), drawn here so the landing adds no icon dependency.
const P: Record<string, string> = {
  zap: "M13 2 3 14h8l-1 8 10-12h-8l1-8z",
  alert: "M12 3 2 20h20L12 3zM12 10v4M12 17.5v.01",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  chat: "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1zM8 10h8M8 13h5",
  scale: "M12 3v18M6 21h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  flow: "M5 5h4v4H5zM15 15h4v4h-4zM15 5h4v4h-4zM9 7h6M17 9v6M9 7v8h6",
  game: "M6 10h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.3 2L15 15H9l-1.7 2A3 3 0 0 1 2 15v-1a4 4 0 0 1 4-4zM8 12v3M6.5 13.5h3M16 13h.01M18 14.5h.01",
  steps: "M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10",
  layers: "m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chip: "M7 7h10v10H7zM10 10h4v4h-4zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3",
  board: "M3 5h18v14H3zM7 9h4v4H7zM14 8h4M14 12h4M14 16h4M7 16h2",
  heat: "M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-1.7.8-3 2-4 0 1.5.8 2.5 2 2.5C11 8 11 5.5 12 3z",
  shield: "M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3zM9 12l2 2 4-4",
  check: "m5 12 5 5 9-10",
  x: "M6 6l12 12M18 6 6 18",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  menu: "M4 7h16M4 12h16M4 17h16",
  play: "M7 4v16l13-8L7 4z",
  reset: "M4 12a8 8 0 1 0 3-6.2M4 4v5h5",
  code: "m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14",
  file: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h4",
  box: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12 4 7.5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  git: "M6 3v12M18 9a3 3 0 1 0 0-.01zM6 18a3 3 0 1 0 0-.01zM18 12c0 4-6 2-12 3",
  split: "M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4",
  intent: "M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0zM12 8v4l3 2",
  gh: "M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, stroke = 1.8, className }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} focusable="false">
      <path d={P[name]} />
    </svg>
  );
}
