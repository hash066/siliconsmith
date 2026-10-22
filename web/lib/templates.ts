// Templates manifest. PROVISIONAL FORMAT (the real one is still to be provided): a JSON file at /templates.json
//   { "version": 1, "templates": [{ "id": "int8-dot", "title": "...", "domain": "silicon", "summary": "...", "run_id": "r_w1_contree3" }] }
// A template is shown as usable only if its run_id is one of the recorded replays; otherwise it is listed as broken, never launched.

export interface Template {
  id: string;
  title: string;
  domain: string;
  summary: string;
  runId: string;
}
export interface TemplateRow {
  template: Template;
  /** null = the linked run is recorded; otherwise why the template cannot be opened. */
  problem: string | null;
}

const ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function parseTemplates(json: unknown, knownRunIds: readonly string[]): { rows: TemplateRow[]; error: string | null } {
  const j = json as { version?: unknown; templates?: unknown } | null;
  if (!j || typeof j !== "object" || j.version !== 1 || !Array.isArray(j.templates)) return { rows: [], error: "The templates manifest is not in the expected format (version 1, a templates list)." };
  const rows: TemplateRow[] = [];
  const seen = new Set<string>();
  for (const t of j.templates as Array<Record<string, unknown>>) {
    const ok = t && typeof t.id === "string" && ID.test(t.id) && typeof t.title === "string" && t.title && typeof t.run_id === "string" && ID.test(t.run_id);
    if (!ok) {
      rows.push({ template: { id: String((t as { id?: unknown })?.id ?? "?"), title: String((t as { title?: unknown })?.title ?? "Unnamed template"), domain: "unknown", summary: "", runId: "" }, problem: "The entry is missing an id, title or run_id." });
      continue;
    }
    const template: Template = { id: t.id as string, title: t.title as string, domain: typeof t.domain === "string" ? t.domain : "silicon", summary: typeof t.summary === "string" ? t.summary : "", runId: t.run_id as string };
    let problem: string | null = null;
    if (seen.has(template.id)) problem = "Another template already uses this id.";
    else if (!knownRunIds.includes(template.runId)) problem = `The linked run ${template.runId} is not recorded, so there is no real result to open.`;
    seen.add(template.id);
    rows.push({ template, problem });
  }
  return { rows, error: null };
}
