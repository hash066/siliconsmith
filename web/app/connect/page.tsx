import type { Metadata } from "next";
import Link from "next/link";
import { CopyBlock } from "@/components/connect/CopyBlock";
import { SiteHeader } from "@/components/site/SiteChrome";
import { BRAND } from "@/lib/brand";
import { CLI_EXAMPLES, CLIENTS, CURL_BOARD, CURL_MATTER, INSTALL_CLONE, INSTALL_GIT, PROMPTS, PY_EXAMPLE, TOOLS } from "@/lib/connect";

export const metadata: Metadata = {
  title: "Use Hardwright from your terminal or editor",
  description: "Install the Hardwright checks as a Python library, a command-line tool or an MCP server for Claude Code, Cursor, Codex and VS Code.",
};

const H2 = "text-[clamp(20px,3vw,26px)] font-semibold tracking-[-0.02em] text-ink";

export default function ConnectPage() {
  return (
    <div className="hw-app min-h-dvh bg-bg text-ink">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-[860px] px-4 pb-24 pt-12 sm:px-6">
        <p className="hw-label">CLI and MCP</p>
        <h1 className="hw-display mt-3 text-[clamp(28px,5vw,44px)]">Use {BRAND.name} from your terminal or editor</h1>
        <p className="mt-4 max-w-[62ch] text-[15.5px] leading-relaxed text-ink-2">
          The checks behind the app are an open-source Python package. Install it once and your coding agent can run the same verifiers the app uses, before it tells you a board or a heat sink is right. It runs on your machine: no account, no API key, no network, no cost.
        </p>

        <section aria-labelledby="what" className="mt-12">
          <h2 id="what" className={H2}>What your agent gets</h2>
          <ul className="mt-4 grid gap-2.5">
            {TOOLS.map((t) => (
              <li key={t.name} className="rounded-xl border border-line bg-panel p-3.5">
                <p className="num text-[13px] text-ink">{t.name}</p>
                <p className="mt-1 text-[13.5px] leading-snug text-ink-2">{t.does}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-snug text-ink-3">Every check answers pass, fail or unknown. Only pass is a claim, and unknown is never counted as a pass. Results name the facts they rest on.</p>
        </section>

        <section aria-labelledby="install" className="mt-12">
          <h2 id="install" className={H2}>1. Install</h2>
          <p className="mt-2 text-[14px] text-ink-2">Python 3.11 or newer.</p>
          <div className="mt-3 grid gap-3">
            <CopyBlock code={INSTALL_GIT} label="Install with pip" />
            <details className="rounded-xl border border-line bg-panel p-3.5">
              <summary className="cursor-pointer text-[13.5px] text-ink-2">Or from a clone</summary>
              <div className="mt-3">
                <CopyBlock code={INSTALL_CLONE} label="Install from a clone" />
              </div>
            </details>
          </div>
          <p className="mt-3 text-[13px] leading-snug text-ink-3">
            Check it worked: <code className="num text-ink-2">hardwright board check --template clean_sensor</code> should print five passes.
          </p>
        </section>

        <section aria-labelledby="connect" className="mt-12">
          <h2 id="connect" className={H2}>2. Connect your agent</h2>
          <p className="mt-2 text-[14px] text-ink-2">The server starts when your agent needs it and stops with it. Pick your tool.</p>
          <div className="mt-4 grid gap-5">
            {CLIENTS.map((c) => (
              <div key={c.id}>
                <h3 className="text-[14px] font-medium text-ink">
                  {c.name} <span className="font-normal text-ink-3">· {c.where}</span>
                </h3>
                <div className="mt-2">
                  <CopyBlock code={c.code} label={`${c.name} setup`} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] leading-snug text-ink-3">
            If your editor cannot find <code className="num text-ink-2">hardwright</code>, use <code className="num text-ink-2">python -m hardwright mcp</code> as the command. Run <code className="num text-ink-2">hardwright mcp --setup</code> to print these lines again.
          </p>
        </section>

        <section aria-labelledby="try" className="mt-12">
          <h2 id="try" className={H2}>3. Ask for it</h2>
          <p className="mt-2 text-[14px] text-ink-2">Say what you want in plain words. Mentioning hardwright helps the agent pick the tools.</p>
          <ul className="mt-4 grid gap-2.5">
            {PROMPTS.map((p) => (
              <li key={p} className="rounded-xl border border-line bg-panel px-3.5 py-3 text-[14px] leading-snug text-ink">
                {p}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="cli" className="mt-12">
          <h2 id="cli" className={H2}>Terminal, scripts and CI</h2>
          <p className="mt-2 text-[14px] text-ink-2">
            <code className="num text-ink-2">hardwright board check</code> exits 0 only when all five checks pass, 1 when any does not, and 2 on bad input, so it works as a CI gate for a design file.
          </p>
          <div className="mt-3">
            <CopyBlock code={CLI_EXAMPLES} label="Command line examples" />
          </div>
          <h3 className="mt-6 text-[14px] font-medium text-ink">As a Python library</h3>
          <div className="mt-2">
            <CopyBlock code={PY_EXAMPLE} label="Python example" />
          </div>
        </section>

        <section aria-labelledby="http" className="mt-12">
          <h2 id="http" className={H2}>No install: the hosted checks</h2>
          <p className="mt-2 text-[14px] text-ink-2">The board checker and the heat solver are also open over HTTP, free and rate limited. Nothing here uses AI credits.</p>
          <div className="mt-3 grid gap-3">
            <CopyBlock code={CURL_BOARD} label="Hosted board check" />
            <CopyBlock code={CURL_MATTER} label="Hosted heat simulation" />
          </div>
        </section>

        <section aria-labelledby="limits" className="mt-12">
          <h2 id="limits" className={H2}>What it does not do</h2>
          <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-[14px] leading-snug text-ink-2">
            <li>The board check is netlist level. It does not prove a board works, and it does no layout or routing.</li>
            <li>Part facts are author-curated. A fact that was not checked against its datasheet is reported as such.</li>
            <li>The heat model is 2D and steady state with stated constants. It is not CFD and not a measurement.</li>
          </ul>
        </section>

        <div className="mt-14 flex flex-wrap items-center gap-3">
          <Link href="/app" className="inline-flex h-11 items-center rounded-xl bg-signal px-5 text-[14px] font-medium text-on-signal">
            Open the app
          </Link>
          <a href={BRAND.repo} className="inline-flex h-11 items-center rounded-xl border border-line px-5 text-[14px] text-ink-2 hover:text-ink">
            Source on GitHub
          </a>
        </div>
      </main>
    </div>
  );
}
