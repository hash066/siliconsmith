"use client";
import { getJson } from "../api";
import type { CheckResponse, Rung, TemplateResponse } from "../data/board";
import { Chip, useRemote, type Tone } from "../ui";

export const useTemplate = (id: string) => useRemote<TemplateResponse>(`board:template:${id}`, (s) => getJson<TemplateResponse>(`/api/board/templates/${id}`, s));

export const checkBoard = (design: unknown, signal: AbortSignal) => import("../api").then((m) => m.postJson<CheckResponse>("/api/board/check", { design }, signal));

const TONE: Record<string, Tone> = { pass: "ok", fail: "bad" };

export function RungRow({ rungs }: { rungs: Rung[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Verification ladder">
      {rungs.map((r) => (
        <li key={r.rung}>
          <Chip tone={TONE[r.status]}>
            {r.rung} {r.status}
          </Chip>
        </li>
      ))}
    </ul>
  );
}
