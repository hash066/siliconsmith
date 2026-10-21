// Lazy shiki highlighter for Verilog, C and diffs, with two instrument themes (no WASM).

import type { HighlighterCore, ThemeRegistration } from "shiki/core";

export type CodeLang = "verilog" | "c" | "diff" | "text";

const theme = (name: string, p: Record<string, string>): ThemeRegistration => ({
  name,
  type: name.endsWith("dark") ? "dark" : "light",
  colors: { "editor.background": "#00000000", "editor.foreground": p.fg },
  settings: [],
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: p.comment, fontStyle: "italic" } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control"], settings: { foreground: p.keyword } },
    { scope: ["constant.numeric", "constant.language", "constant.other"], settings: { foreground: p.number } },
    { scope: ["string", "string.quoted"], settings: { foreground: p.string } },
    { scope: ["entity.name.function", "support.function", "entity.name.type.module", "entity.name.type"], settings: { foreground: p.fn } },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: p.fg } },
    { scope: ["keyword.operator", "punctuation"], settings: { foreground: p.op } },
    { scope: ["meta.preprocessor", "keyword.control.directive", "entity.name.function.preprocessor"], settings: { foreground: p.pre } },
    { scope: ["markup.inserted", "punctuation.definition.inserted"], settings: { foreground: p.add } },
    { scope: ["markup.deleted", "punctuation.definition.deleted"], settings: { foreground: p.del } },
    { scope: ["meta.diff.range", "meta.diff.header", "meta.diff.index"], settings: { foreground: p.comment } },
  ],
});

const DARK = theme("instrument-dark", {
  fg: "#e4e7dd",
  comment: "#7f857b",
  keyword: "#c6f135",
  number: "#f0b43c",
  string: "#c9cfbf",
  fn: "#f3f5ee",
  op: "#9aa093",
  pre: "#b4b9ad",
  add: "#c6f135",
  del: "#ff6a59",
});
const LIGHT = theme("instrument-light", {
  fg: "#1a1d17",
  comment: "#6a7065",
  keyword: "#3f6400",
  number: "#8a5200",
  string: "#3c4237",
  fn: "#12140f",
  op: "#555b50",
  pre: "#444a40",
  add: "#3f6400",
  del: "#b02c1c",
});

let instance: Promise<HighlighterCore> | null = null;

function highlighter() {
  instance ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import("shiki/core"), import("shiki/engine/javascript")]);
    return createHighlighterCore({
      themes: [DARK, LIGHT],
      langs: [import("@shikijs/langs/verilog"), import("@shikijs/langs/c"), import("@shikijs/langs/diff")],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return instance;
}

const cache = new Map<string, string>();

export async function highlight(code: string, lang: CodeLang): Promise<string> {
  const key = `${lang}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const h = await highlighter();
  const html = h.codeToHtml(code, {
    lang: lang === "text" ? "text" : lang,
    themes: { dark: "instrument-dark", light: "instrument-light" },
    defaultColor: false,
    transformers: [
      {
        line(node, line) {
          if (lang !== "diff") return;
          const text = code.split("\n")[line - 1] ?? "";
          if (text.startsWith("+") && !text.startsWith("+++")) this.addClassToHast(node, "diff-add");
          else if (text.startsWith("-") && !text.startsWith("---")) this.addClassToHast(node, "diff-del");
        },
      },
    ],
  });
  if (cache.size > 200) cache.clear();
  cache.set(key, html);
  return html;
}

/** Some engine artifacts arrive double-escaped ("\\n" for newlines); show them as code, not as one line. */
export function normaliseCode(code: string): string {
  if (!code.includes("\n") && code.includes("\\n")) return code.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  if ((code.match(/\\n/g)?.length ?? 0) > 3 && (code.match(/\n/g)?.length ?? 0) < 2) return code.replace(/\\n/g, "\n");
  return code;
}
