"use client";

import { useState } from "react";
import type { LayoutOptions } from "./useBoardLayout";
import { btnPrimary } from "./ui";

export const STYLE_CHOICES: { id: NonNullable<LayoutOptions["style"]>; label: string; hint: string }[] = [
  { id: "default", label: "Default", hint: "Room for routing around every part." },
  { id: "smallest", label: "Smallest", hint: "Tighter gaps, smaller board. Harder to route; the check says whether it worked." },
  { id: "emi", label: "Reduce EMI", hint: "Supply connections weigh more in placement; ground stitching vias twice as dense." },
];

export const MAX_CONSTRAINTS = 300;

/** Style choice and a short text of wishes for the board, sent with the request. The server says what it understood. */
export function MakeBoardCard({ onMake, label, error }: { onMake: (o: LayoutOptions) => void; label: string; error?: string }) {
  const [style, setStyle] = useState<NonNullable<LayoutOptions["style"]>>("default");
  const [text, setText] = useState("");
  return (
    <div className="mt-2">
      <fieldset>
        <legend className="text-[12px] font-medium text-ink-2">Board style</legend>
        <div className="mt-1 flex flex-col gap-1" data-testid="board-style">
          {STYLE_CHOICES.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-start gap-2 text-[12.5px] leading-snug text-ink">
              <input type="radio" name="board-style" value={c.id} checked={style === c.id} onChange={() => setStyle(c.id)} className="mt-0.5" />
              <span>
                <span className="font-medium">{c.label}</span> <span className="text-ink-3">{c.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-2 block text-[12px] font-medium text-ink-2" htmlFor="board-constraints">
        Wishes (optional)
      </label>
      <textarea
        id="board-constraints"
        value={text}
        maxLength={MAX_CONSTRAINTS}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="e.g. 50 x 40 mm, USB-C on the left edge"
        className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink"
        data-testid="board-constraints"
      />
      <p className="text-[11px] text-ink-3">
        Understands a board size (25–120 mm) and which edge the USB-C or battery connector sits on. Anything else is listed back as not acted on. <span className="num">{text.length}/{MAX_CONSTRAINTS}</span>
      </p>
      {error && (
        <p className="mt-2 rounded-lg bg-amber-dim px-3 py-2 text-[12.5px] leading-snug text-ink" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={() => onMake({ style, constraints: text })} className={`${btnPrimary} mt-2`} data-testid="make-board-go">
        {label}
      </button>
    </div>
  );
}

/** What the placer did with the request, from the board's summary. */
export function RequestNote({ request }: { request?: { style: string; understood: string[]; ignored: string[] } }) {
  if (!request || (request.style === "default" && !request.understood.length && !request.ignored.length)) return null;
  return (
    <div className="mt-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[12px] leading-snug text-ink-2" data-testid="request-note">
      <p>
        Style: <span className="font-medium text-ink">{STYLE_CHOICES.find((c) => c.id === request.style)?.label ?? request.style}</span>
      </p>
      {request.understood.length > 0 && <p>Acted on: {request.understood.join("; ")}.</p>}
      {request.ignored.length > 0 && <p>Not acted on: {request.ignored.join("; ")}.</p>}
    </div>
  );
}
