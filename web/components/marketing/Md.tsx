import type { ReactNode } from "react";

/** Renders just **bold** and `code` from a model answer; everything else stays plain text. */
export function Md({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <strong key={k++} style={{ color: "var(--hw-ink)" }}>{m[1]}</strong> : <code key={k++} className="mk-mono" style={{ fontSize: "0.92em", color: "var(--hw-ember)" }}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
