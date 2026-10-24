// Projects: one saved piece of work per project (its workbench, its agent chat and the workbench settings), kept in this browser.
// Pure functions over a plain list plus a tiny storage wrapper, so the logic is testable without a DOM.
import type { AgentState } from "./agent";
import type { WorkbenchId } from "./brand";

export const PROJECTS_KEY = "hw-projects-v1";
export const MAX_PROJECTS = 40;
const MAX_MESSAGES = 60;
const MAX_BYTES = 900_000;

export interface MatterSnap {
  generator?: string;
  gen_params?: Record<string, number>;
  spreader?: Record<string, number>;
}
export interface BoardSnap {
  templateId?: string | null;
  designText?: string;
}
export interface ProjectSnap {
  matter?: MatterSnap;
  board?: BoardSnap;
}

export interface Project {
  id: string;
  wb: WorkbenchId;
  title: string;
  createdAt: number;
  updatedAt: number;
  chat: AgentState;
  snap: ProjectSnap;
}

export const emptyChat = (): AgentState => ({ messages: [], pending: null, activeModel: null });

/** A saved chat never keeps a half-streamed reply or an open proposal (a proposal needs a live click). */
export function sanitizeChat(s: AgentState): AgentState {
  const messages = s.messages
    .filter((m) => !(m.streaming && !m.text.trim()))
    .slice(-MAX_MESSAGES)
    .map((m) => (m.streaming ? { ...m, streaming: false } : m));
  return { messages, pending: null, activeModel: s.activeModel };
}

export const titleFrom = (text: string): string => {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "Untitled project";
  return t.length > 48 ? `${t.slice(0, 47).trimEnd()}…` : t;
};

let counter = 0;
export const newId = (now = Date.now()): string => `p${now.toString(36)}${(counter++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function createProject(wb: WorkbenchId, title: string, now = Date.now()): Project {
  return { id: newId(now), wb, title: titleFrom(title), createdAt: now, updatedAt: now, chat: emptyChat(), snap: {} };
}

/** Newest first; the oldest are dropped past the cap. */
export function addProject(list: Project[], p: Project): Project[] {
  return [p, ...list.filter((x) => x.id !== p.id)].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROJECTS);
}

export function patchProject(list: Project[], id: string, patch: Partial<Omit<Project, "id" | "createdAt">>, now = Date.now()): Project[] {
  return list.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now } : p));
}

export const renameProject = (list: Project[], id: string, title: string, now = Date.now()): Project[] => patchProject(list, id, { title: titleFrom(title) }, now);

export const removeProject = (list: Project[], id: string): Project[] => list.filter((p) => p.id !== id);

export const byWorkbench = (list: Project[], wb: WorkbenchId): Project[] => list.filter((p) => p.wb === wb).sort((a, b) => b.updatedAt - a.updatedAt);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads whatever is stored and keeps only well-formed projects (a corrupt or foreign value yields an empty list). */
export function parseProjects(raw: string | null): Project[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: Project[] = [];
  for (const x of v) {
    if (!isRecord(x) || typeof x.id !== "string" || typeof x.title !== "string") continue;
    if (x.wb !== "matter" && x.wb !== "board" && x.wb !== "silicon") continue;
    const chat = isRecord(x.chat) && Array.isArray(x.chat.messages) ? sanitizeChat({ messages: x.chat.messages as AgentState["messages"], pending: null, activeModel: (x.chat.activeModel as AgentState["activeModel"]) ?? null }) : emptyChat();
    out.push({ id: x.id, wb: x.wb, title: x.title.slice(0, 80), createdAt: Number(x.createdAt) || 0, updatedAt: Number(x.updatedAt) || 0, chat, snap: isRecord(x.snap) ? (x.snap as ProjectSnap) : {} });
  }
  return out.slice(0, MAX_PROJECTS);
}

/** Serialises under a size budget: the oldest projects lose their chat first, then are dropped. Returns null if nothing fits. */
export function serializeProjects(list: Project[]): string {
  let cur = list;
  let s = JSON.stringify(cur);
  for (let i = cur.length - 1; s.length > MAX_BYTES && i >= 0; i--) {
    cur = cur.map((p, j) => (j === i ? { ...p, chat: emptyChat() } : p));
    s = JSON.stringify(cur);
  }
  while (s.length > MAX_BYTES && cur.length > 1) {
    cur = cur.slice(0, -1);
    s = JSON.stringify(cur);
  }
  return s;
}

export function loadProjects(): Project[] {
  try {
    return parseProjects(localStorage.getItem(PROJECTS_KEY));
  } catch {
    return [];
  }
}

export function saveProjects(list: Project[]): void {
  try {
    localStorage.setItem(PROJECTS_KEY, serializeProjects(list));
  } catch {
    // storage blocked or full: projects live for this visit only
  }
}
