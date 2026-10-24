// Server-side post-checks on the agent's final text. The model streams its answer before these run, so a problem is reported as a
// `flag` event the UI shows next to the message (the same way the uncited-claim filter works), never silently rewritten.

export type FlagKind = "invented_command" | "claims_run" | "invented_number";

export interface Flag {
  kind: FlagKind;
  message: string;
}

const COMMAND = /siliconsmith\s+verify-entry\s+(\S+)/gi;
const TRAILING = /[`'".,;:)\]]+$/;

/** Every id the text puts after `siliconsmith verify-entry`, cleaned of quotes and sentence punctuation. */
export function verifyEntryIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(COMMAND)) out.push(m[1].replace(TRAILING, ""));
  return out;
}

const CLAIMS_RUN = /\b(?:i|we)\s+(?:have\s+|just\s+|also\s+)?(?:ran|run|executed|re-?verified|re-?ran)\b[^.\n]{0,80}(?:verify-entry|proof|library entry|entry)|verify-entry[^.\n]{0,80}\b(?:passed|succeeded|completed|ran successfully|was run)\b/i;

/**
 * A `verify-entry` command is real only for an id in the evidence library. Anything else is an invented command.
 * An answer that says it ran the command is also flagged: the agent has no tool that runs it.
 */
export function guardText(text: string, entryIds: readonly string[]): Flag[] {
  const flags: Flag[] = [];
  const known = new Set(entryIds);
  const seen = new Set<string>();
  for (const id of verifyEntryIds(text)) {
    if (known.has(id) || seen.has(id)) continue;
    seen.add(id);
    flags.push({
      kind: "invented_command",
      message: `The answer shows \`siliconsmith verify-entry ${id}\`, but ${id} is not an evidence library entry, so that command does not exist. ${entryIds.length ? `The real entries are: ${entryIds.join(", ")}.` : "No library entries are installed on this server."} Ignore it.`,
    });
  }
  if (CLAIMS_RUN.test(text)) {
    flags.push({ kind: "claims_run", message: "The answer suggests the reproduce command was run. The agent cannot run commands: it only shows the command. Nothing was re-verified." });
  }
  return flags;
}

const TEMP = /(-?\d+(?:\.\d+)?)\s*(?:°\s*C|degrees?\s*C|\bC\b(?!\w))/g;
const NUMBER = /-?\d+(?:\.\d+)?/g;

/**
 * A temperature the answer quotes must be a number the user wrote or a tool returned (to rounding). Anything else is invented: the model
 * said "about 288 C" after a simulation that never solved. The text is already streamed, so this is a flag, like the other post-checks.
 */
export function guardNumbers(text: string, sources: readonly string[]): Flag[] {
  const known: number[] = [];
  for (const src of sources) for (const m of src.matchAll(NUMBER)) known.push(Number(m[0]));
  const bad = new Set<string>();
  for (const m of text.matchAll(TEMP)) {
    const v = Number(m[1]);
    if (!known.some((k) => Math.abs(k - v) <= Math.max(0.6, Math.abs(k) * 0.03))) bad.add(m[1]);
  }
  return bad.size ? [{ kind: "invented_number", message: `The answer quotes ${[...bad].map((b) => `${b} °C`).join(", ")}, but no simulation returned that number and you did not give it. Ignore it; the simulation result in the tool card is the real figure.` }] : [];
}
