"use client";

import { useEffect, useState } from "react";
import { highlight, normaliseCode, type CodeLang } from "@/lib/highlight";

export function Code({ code, lang, maxHeight, label }: { code: string; lang: CodeLang; maxHeight?: number | string; label?: string }) {
  const text = normaliseCode(code);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setHtml(null);
    highlight(text, lang)
      .then((h) => alive && setHtml(h))
      .catch(() => alive && setHtml(null));
    return () => {
      alive = false;
    };
  }, [text, lang]);

  return (
    <div
      className="code-block scroll-quiet overflow-auto rounded-md border border-line bg-sunken py-3 pl-1"
      style={{ maxHeight }}
      role="region"
      aria-label={label ?? `${lang} source`}
      tabIndex={0}
    >
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="font-mono text-[12.5px] leading-[1.6] text-ink-2">
          <code>
            {text.split("\n").map((l, i) => (
              <span className="line" key={i}>
                {l}
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
}
