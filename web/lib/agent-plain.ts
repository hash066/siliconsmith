// Plain-language post-processing of the agent's streamed text. The model is told to write for a non-expert; this is the safety net that turns
// the jargon that still slips through into words a maker would use, and replaces raw evidence ids (which the app shows behind a toggle) with
// readable phrases. It never adds a claim: it only rewords. The honesty filters run on the model's ORIGINAL text, not on this output.

const ID = "(?:run:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.]+(?:#[a-z_]+)?|(?:board|matter):[a-z0-9_]+#[A-Z][0-9]|library:[A-Za-z0-9_.-]+|part:[a-z0-9_]+\\.[a-z0-9_.]+)";
const ID_LIST = new RegExp(`\\s*[\\(\\[]\\s*${ID}(?:\\s*[,;]\\s*${ID})*\\s*[\\)\\]]`, "g");
const ID_BARE = new RegExp(ID, "g");

/** A bare evidence id in a sentence, as words. */
function idWords(id: string): string {
  let m = id.match(/^(?:board|matter):[a-z0-9_]+#([A-Z][0-9])$/);
  if (m) return `check ${m[1]}`;
  m = id.match(/^run:[A-Za-z0-9_.-]+\/([A-Za-z0-9_.]+)/);
  if (m) return `candidate ${m[1]}`;
  m = id.match(/^library:(.+)$/);
  if (m) return m[1].replace(/[.]+$/, "");
  return "a stored fact";
}

const cap = (from: string, to: string) => (from[0] === from[0].toUpperCase() && from[0] !== from[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to);

const WORDS: Array<[RegExp, string]> = [
  [/\bformally\s+(?:proven|proved)\b/gi, "proved for every possible input"],
  [/\bformal(?:ly)?\s+(?:proof|verification)\b/gi, "proof that holds for every possible input"],
  [/\brungs\b/gi, "checks"],
  [/\brung\b/gi, "check"],
  [/\bladders?\b/gi, "checks"],
  [/\bcounter-?examples?\b/gi, "failing example"],
  [/\bstrapping pins?\b/gi, "boot-setting pin"],
];

/** Rewords jargon and replaces evidence ids. Idempotent: running it twice gives the same text. */
export function plainText(text: string): string {
  let t = text.replace(ID_LIST, "").replace(ID_BARE, (id) => idWords(id));
  for (const [re, to] of WORDS) t = t.replace(re, (m) => cap(m, to));
  return t.replace(/\*\*/g, "").replace(/ {2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1");
}

/**
 * Applies `plainText` to a stream of deltas. Text is held back until a phrase or an id list can no longer straddle the cut: the last 30
 * characters, anything after an unclosed "(" and a dangling first word of a phrase stay in the buffer. `flush()` returns the rest at the end of the turn.
 */
export class PlainStream {
  private buf = "";
  push(chunk: string): string {
    this.buf += chunk;
    // Decide the cut on the RAW text, so a half-received id is never rewritten, then reword only what is emitted.
    let limit = this.buf.length - 30;
    const open = this.buf.lastIndexOf("(");
    if (open > this.buf.lastIndexOf(")") && open < limit) limit = open;
    if (limit <= 0) return "";
    const space = (from: number) => Math.max(this.buf.lastIndexOf(" ", from), this.buf.lastIndexOf("\n", from));
    let cut = space(limit);
    // a cut inside a bracketed id list would split it
    const inside = (c: number) => Math.max(this.buf.lastIndexOf("(", c), this.buf.lastIndexOf("[", c)) > Math.max(this.buf.lastIndexOf(")", c), this.buf.lastIndexOf("]", c));
    while (cut > 0 && inside(cut)) cut = space(Math.max(this.buf.lastIndexOf("(", cut), this.buf.lastIndexOf("[", cut)) - 1);
    // never end on the first word of a two-word phrase ("formally" | "proven")
    while (cut > 0 && /(?:^|\s)(?:formally|formal|strapping)$/i.test(this.buf.slice(0, cut))) cut = space(cut - 1);
    if (cut <= 0) return "";
    const out = this.buf.slice(0, cut);
    this.buf = this.buf.slice(cut);
    return plainText(out);
  }
  flush(): string {
    const t = plainText(this.buf);
    this.buf = "";
    return t;
  }
}
