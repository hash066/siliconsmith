// The Library: every instruction that passed the whole verification ladder (L1 to L5) in a recorded run, derived from the replays' events.
// Nothing is curated or hand-listed here. An entry says which run and node proved it and links to the evidence behind its numbers.

import type { Proposal } from "./events";
import { wallOf, type NodeState, type RunState } from "./run-state";

export interface Proof {
  runId: string;
  nodeId: string;
  wallSpeedup: number;
  areaPct: number;
  cycles: number;
  /** The rungs L1..L5 as recorded on node.scored (L6, real silicon, is never claimed). */
  rungs: Record<string, "pass" | "fail" | "skipped">;
  /** Whether this node's CPU is the run's best node or on its path. */
  onBestPath: boolean;
}

export interface LibraryEntry {
  mnemonic: string;
  title: string;
  semantics_c: string;
  operands: Proposal["operands"];
  rationale: string;
  /** The RTL text recorded in the event log for the node that first proved it (the reader can hash it); null if absent. */
  rtlText: string | null;
  proofs: Proof[];
  /** The proof with the highest wall-clock speedup. */
  best: Proof;
}

const REQUIRED = ["L1", "L2", "L3", "L4", "L5"] as const;

const isInstructionNode = (n: NodeState) => !!n.proposal && (n.proposal.kind === undefined || n.proposal.kind === "instruction");

function onPath(s: RunState, id: string): boolean {
  if (!s.best) return false;
  for (let cur: NodeState | undefined = s.nodes[s.best]; cur; cur = cur.parentId ? s.nodes[cur.parentId] : undefined) if (cur.id === id) return true;
  return false;
}

/** Instruction nodes whose score is feasible and whose rungs L1..L5 all passed, grouped by mnemonic across the given runs. */
export function libraryEntries(runs: ReadonlyArray<{ runId: string; state: RunState }>): LibraryEntry[] {
  const byMnemonic = new Map<string, { node: NodeState; proofs: Proof[] }>();
  for (const { runId, state } of runs) {
    if (state.domain !== "silicon") continue;
    for (const id of state.order) {
      const n = state.nodes[id];
      const sc = n.score;
      if (!isInstructionNode(n) || !sc?.feasible || !REQUIRED.every((r) => sc.ladder[r] === "pass")) continue;
      const proof: Proof = { runId, nodeId: id, wallSpeedup: wallOf(sc), areaPct: sc.area_delta_pct, cycles: sc.cycles, rungs: sc.ladder, onBestPath: onPath(state, id) };
      const g = byMnemonic.get(n.proposal!.mnemonic);
      if (g) g.proofs.push(proof);
      else byMnemonic.set(n.proposal!.mnemonic, { node: n, proofs: [proof] });
    }
  }
  return [...byMnemonic.values()]
    .map(({ node, proofs }): LibraryEntry => {
      proofs.sort((a, b) => b.wallSpeedup - a.wallSpeedup);
      const p = node.proposal!;
      return { mnemonic: p.mnemonic, title: p.title, semantics_c: p.semantics_c, operands: p.operands, rationale: p.rationale, rtlText: node.artifacts.rtl ?? null, proofs, best: proofs[0] };
    })
    .sort((a, b) => b.best.wallSpeedup - a.best.wallSpeedup || a.mnemonic.localeCompare(b.mnemonic));
}

/** Hex SHA-256 of a string with the platform's WebCrypto (browser and Node 20+). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
