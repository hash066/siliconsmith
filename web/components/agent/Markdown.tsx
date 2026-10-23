import type { ReactNode } from "react";

// A small, safe Markdown subset for agent answers: paragraphs, **bold**, `code`, fenced code blocks and "-" lists.
// It builds React nodes (no HTML injection) and ignores everything else, which stays plain text.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={`${keyBase}-${i++}`} className="num rounded bg-sunken px-1 py-px text-[0.92em] text-ink">{tok.slice(1, -1)}</code>);
    else out.push(<strong key={`${keyBase}-${i++}`} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`} className="break-words">{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list.length)
      blocks.push(
        <ul key={`l${blocks.length}`} className="list-disc pl-4">
          {list.map((x, i) => (
            <li key={i} className="break-words">{inline(x, `l${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      flushPara();
      flushList();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith("```"); i++) code.push(lines[i]);
      blocks.push(
        <pre key={`c${blocks.length}`} className="scroll-quiet num max-h-60 overflow-auto rounded-md bg-sunken p-2.5 text-[12px] leading-relaxed text-ink">
          {code.join("\n")}
        </pre>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="flex min-w-0 flex-col gap-2 text-[13px] leading-snug text-ink">{blocks}</div>;
}
