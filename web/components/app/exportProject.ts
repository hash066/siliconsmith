import { makeZip, type ZipEntry } from "@/lib/zip";
import type { Project } from "@/lib/projects";
import type { ProductFile } from "./files";

const enc = new TextEncoder();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function bytesOf(f: ProductFile): Promise<Uint8Array | null> {
  if (f.text !== undefined) return enc.encode(f.text);
  if (f.base64) return b64ToBytes(f.base64);
  if (f.href) {
    try {
      const r = await fetch(f.href);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** What the zip's README says, so it is useful on its own without the app. */
export function readmeFor(p: { title: string; wb: string; request: string; verdict: string; files: Array<{ name: string; note: string; included: boolean }>; when: Date }): string {
  const lines = [
    `Hardwright project: ${p.title}`,
    `Workbench: ${p.wb}`,
    `Exported: ${p.when.toISOString()}`,
    "",
    "Your request",
    p.request || "(none)",
    "",
    "Result",
    p.verdict || "(no result yet)",
    "",
    "Files",
    ...p.files.map((f) => `- ${f.name}: ${f.note}${f.included ? "" : " (could not be fetched, not included)"}`),
    "",
    "project.json holds the settings and the conversation with the agent.",
    "What the checks do and do not show is stated by the app next to each result; nothing in this folder has been fabricated or tested electrically.",
  ];
  return lines.join("\n") + "\n";
}

export async function buildProjectZip(p: { project: Project; request: string; verdict: string; files: ProductFile[]; now?: Date }): Promise<Uint8Array> {
  const now = p.now ?? new Date();
  const entries: ZipEntry[] = [];
  const listed: Array<{ name: string; note: string; included: boolean }> = [];
  for (const f of p.files) {
    const data = await bytesOf(f);
    listed.push({ name: f.name, note: f.note, included: data !== null });
    if (data) entries.push({ name: `files/${f.name}`, data });
  }
  const chat = p.project.chat.messages.map((m) => ({ role: m.role, text: m.text, model: m.model, cost_usd: m.cost?.usd, evidence: m.evidence }));
  entries.unshift(
    { name: "README.txt", data: enc.encode(readmeFor({ title: p.project.title, wb: p.project.wb, request: p.request, verdict: p.verdict, files: listed, when: now })) },
    { name: "project.json", data: enc.encode(JSON.stringify({ title: p.project.title, workbench: p.project.wb, created: new Date(p.project.createdAt).toISOString(), exported: now.toISOString(), request: p.request, settings: p.project.snap, verdict: p.verdict, conversation: chat }, null, 2)) },
  );
  return makeZip(entries, now);
}

export function downloadBytes(name: string, data: Uint8Array, mime = "application/zip") {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const zipName = (title: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project"}.zip`;
