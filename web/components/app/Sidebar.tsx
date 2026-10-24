"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { WORKBENCHES, WORKBENCH_ORDER, type WorkbenchId } from "@/lib/brand";
import { byWorkbench, type Project } from "@/lib/projects";
import { IconChevron, IconClose, IconPencil, IconPlug, IconPlus, IconTrash, WB_ICON } from "./ui";

const ago = (t: number, now = Date.now()): string => {
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
};

export interface SidebarProps {
  projects: Project[];
  currentId: string | null;
  /** The workbench whose "New project" screen is showing (so its section stays open). */
  creating: WorkbenchId | null;
  onSelect: (id: string) => void;
  onNew: (wb: WorkbenchId) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  /** Mobile drawer: show a close button. */
  onClose?: () => void;
}

/** Workbenches as folders of projects: click one to see its projects and start a new one. */
export function Sidebar({ projects, currentId, creating, onSelect, onNew, onRename, onDelete, onClose }: SidebarProps) {
  const current = projects.find((p) => p.id === currentId) ?? null;
  const [open, setOpen] = useState<Record<WorkbenchId, boolean>>({ matter: true, silicon: false, board: false });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const edit = useRef<HTMLInputElement>(null);
  const focus = current?.wb ?? creating;
  useEffect(() => {
    if (focus) setOpen((o) => (o[focus] ? o : { ...o, [focus]: true }));
  }, [focus]);
  // the first time the saved list arrives, every workbench that has projects opens
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || projects.length === 0) return;
    seeded.current = true;
    setOpen((o) => ({ matter: o.matter || projects.some((p) => p.wb === "matter"), silicon: o.silicon || projects.some((p) => p.wb === "silicon"), board: o.board || projects.some((p) => p.wb === "board") }));
  }, [projects]);
  useEffect(() => {
    if (editing) edit.current?.select();
  }, [editing]);
  const commit = () => {
    if (editing && draft.trim()) onRename(editing, draft);
    setEditing(null);
  };
  return (
    <nav aria-label="Projects" data-testid="sidebar" className="flex h-full min-h-0 w-full flex-col bg-panel">
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <span className="hw-label">Projects</span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close the projects list" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-raised hover:text-ink lg:hidden">
            <IconClose size={18} />
          </button>
        )}
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {WORKBENCH_ORDER.map((id) => {
          const Icon = WB_ICON[id];
          const list = byWorkbench(projects, id);
          const expanded = open[id];
          return (
            <section key={id} aria-label={`${WORKBENCHES[id].name} projects`} className="mb-1">
              <button type="button" aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))} data-testid={`sb-${id}`} className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] text-ink hover:bg-raised">
                <span style={{ color: WORKBENCHES[id].accent }}>
                  <Icon size={17} />
                </span>
                <span className="flex-1">{WORKBENCHES[id].name}</span>
                <span className="num text-[11.5px] text-ink-3">{list.length || ""}</span>
                <IconChevron size={14} dir={expanded ? "down" : "right"} className="text-ink-3" />
              </button>
              {expanded && (
                <ul className="mb-1 ml-3 border-l border-line pl-1.5">
                  <li>
                    <button type="button" onClick={() => onNew(id)} data-testid={`new-${id}`} aria-current={creating === id ? "true" : undefined} className={`flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] hover:bg-raised ${creating === id ? "bg-raised text-ink" : "text-ink-2"}`}>
                      <IconPlus size={14} />
                      New {WORKBENCHES[id].name} project
                    </button>
                  </li>
                  {list.length === 0 && <li className="px-2.5 py-1.5 text-[12px] leading-snug text-ink-3">No projects yet.</li>}
                  {list.map((p) => (
                    <li key={p.id} className="group relative">
                      {editing === p.id ? (
                        <input
                          ref={edit}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          maxLength={60}
                          aria-label="Project name"
                          className="my-0.5 h-8 w-full rounded-md border border-line-2 bg-bg px-2 text-[13px] text-ink focus:outline-none"
                        />
                      ) : (
                        <>
                          <button type="button" onClick={() => onSelect(p.id)} aria-current={p.id === currentId ? "page" : undefined} data-testid={`proj-${p.id}`} title={p.title} className={`flex h-9 w-full items-center gap-2 rounded-lg pl-2.5 pr-16 text-left text-[13px] hover:bg-raised ${p.id === currentId ? "bg-raised text-ink" : "text-ink-2"}`}>
                            <span className="min-w-0 flex-1 truncate">{p.title}</span>
                          </button>
                          <span className="num pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3 group-focus-within:opacity-0 group-hover:opacity-0 max-lg:opacity-0">{ago(p.updatedAt)}</span>
                          <span className="absolute right-1 top-1/2 flex -translate-y-1/2 opacity-0 focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
                            <button
                              type="button"
                              aria-label={`Rename ${p.title}`}
                              onClick={() => {
                                setDraft(p.title);
                                setEditing(p.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-bg hover:text-ink"
                            >
                              <IconPencil />
                            </button>
                            <button
                              type="button"
                              aria-label={armed === p.id ? `Confirm delete ${p.title}` : `Delete ${p.title}`}
                              onBlur={() => setArmed((a) => (a === p.id ? null : a))}
                              onClick={() => {
                                if (armed === p.id) {
                                  setArmed(null);
                                  onDelete(p.id);
                                } else setArmed(p.id);
                              }}
                              className={`flex h-7 items-center justify-center rounded-md px-1.5 text-[11px] hover:bg-bg ${armed === p.id ? "text-red" : "text-ink-3 hover:text-ink"}`}
                            >
                              {armed === p.id ? "Delete?" : <IconTrash />}
                            </button>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-line p-2">
        <Link href="/connect" className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-raised hover:text-ink" data-testid="sb-connect">
          <IconPlug size={16} />
          Use from your terminal or editor
        </Link>
        <p className="px-2.5 pb-1 pt-2 text-[11px] leading-snug text-ink-3">Projects are saved in this browser only.</p>
      </div>
    </nav>
  );
}
