import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/library/PageFrame";
import { recordedRuns } from "@/lib/replay-index";
import { parseTemplates, type TemplateRow } from "@/lib/templates";

export const metadata: Metadata = { title: "Templates" };

function load(): { rows: TemplateRow[]; error: string | null; present: boolean; domains: Record<string, string> } {
  const runs = recordedRuns();
  const domains = Object.fromEntries(runs.map((r) => [r.id, r.domain]));
  const file = join(process.cwd(), "public", "templates.json");
  if (!existsSync(file)) return { rows: [], error: null, present: false, domains };
  try {
    return { ...parseTemplates(JSON.parse(readFileSync(file, "utf8")), runs.map((r) => r.id)), present: true, domains };
  } catch {
    return { rows: [], error: "The templates manifest is not valid JSON.", present: true, domains };
  }
}

export default function TemplatesPage() {
  const t = load();
  return (
    <PageFrame
      current="/workstation/templates"
      title="Templates"
      intro="A template is a starting point that links to a real, recorded run. It is listed as usable only when that run exists in the replays; a template whose run is missing is marked broken and cannot be opened."
    >
      {t.error ? (
        <p className="rounded-md bg-red-dim px-3 py-2 text-[13px] text-red" role="alert">
          {t.error}
        </p>
      ) : t.rows.length === 0 ? (
        <section className="rounded-lg border border-line bg-panel p-5" role="status">
          <h2 className="text-[15px] font-medium text-ink">No templates yet</h2>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-snug text-ink-3">
            {t.present ? "The templates manifest lists none." : "No templates manifest is installed on this deployment."} Nothing is shown until a template links to a run that exists.
          </p>
        </section>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
          {t.rows.map(({ template, problem }) => (
            <li key={template.id} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-panel p-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">{template.domain}</span>
              <h2 className="break-words text-[15px] font-medium text-ink">{template.title}</h2>
              {template.summary && <p className="text-[13px] leading-snug text-ink-2">{template.summary}</p>}
              {problem ? (
                <p className="mt-1 text-[12.5px] text-amber" role="note">
                  Broken: {problem}
                </p>
              ) : (
                <Link
                  href={t.domains[template.runId] === "silicon" ? `/runs/${template.runId}` : `/workstation?run=${template.runId}`}
                  className="mt-1 inline-flex h-9 w-fit items-center rounded-md border border-line-2 px-3 text-[13px] text-ink hover:bg-raised"
                >
                  Open run <span className="num ml-1.5 text-ink-3">{template.runId}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageFrame>
  );
}
