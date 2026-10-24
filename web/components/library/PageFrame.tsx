import Link from "next/link";
import { ThemeToggle, Wordmark } from "../site/Brand";

const LINKS = [
  { href: "/workstation", label: "Workstation" },
  { href: "/workstation/library", label: "Library" },
  { href: "/workstation/templates", label: "Templates" },
];

/** Shared frame for the Library and Templates pages (same top bar language as the workstation). */
export function PageFrame({ current, title, intro, children }: { current: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh min-w-0 flex-col">
      <header className="shrink-0 border-b border-line bg-bg">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 lg:h-14 lg:flex-nowrap lg:py-0">
          <Wordmark href="/" />
          <nav aria-label="Workstation" className="flex min-w-0 items-center gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={l.href === current ? "page" : undefined}
                className={`inline-flex h-9 items-center rounded-md px-3 text-[13px] transition-colors duration-150 ${l.href === current ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full min-w-0 max-w-[1280px] flex-1 px-4 py-6 lg:px-6">
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-snug text-ink-2">{intro}</p>
        <div className="mt-5 min-w-0">{children}</div>
      </main>
    </div>
  );
}
