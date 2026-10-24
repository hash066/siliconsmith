"use client";

import { useState } from "react";

/** A code block with a copy button. The text is real text (selectable) even if copying is blocked. */
export function CopyBlock({ code, label }: { code: string; label: string }) {
  const [note, setNote] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setNote("Copied");
    } catch {
      setNote("Select and copy");
    }
    setTimeout(() => setNote(null), 1800);
  };
  return (
    <div className="relative min-w-0 rounded-xl border border-line bg-sunken">
      <pre tabIndex={0} aria-label={label} className="scroll-quiet num overflow-x-auto p-4 pr-24 text-[12.5px] leading-relaxed text-ink">
        <code>{code}</code>
      </pre>
      <button type="button" onClick={copy} className="absolute right-2 top-2 inline-flex h-8 items-center rounded-lg border border-line bg-panel px-3 text-[12px] text-ink-2 hover:text-ink">
        {note ?? "Copy"}
        <span className="sr-only" role="status">
          {note ? `${label}: ${note}` : ""}
        </span>
      </button>
    </div>
  );
}
