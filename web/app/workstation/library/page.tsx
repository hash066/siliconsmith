import type { Metadata } from "next";
import { LibraryView } from "@/components/library/LibraryView";
import { StoredEntries } from "@/components/library/StoredEntries";
import { PageFrame } from "@/components/library/PageFrame";
import { recordedRuns } from "@/lib/replay-index";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  const ids = recordedRuns().filter((r) => r.domain === "silicon").map((r) => r.id);
  return (
    <PageFrame
      current="/workstation/library"
      title="Library"
      intro="Instructions that passed the whole verification ladder: lint, unit tests against the C reference, the formal proof, the whole-workload check and synthesis. Stored entries carry a manifest and a reproduce command; the rest are read from the recorded runs. Nothing is listed by hand."
    >
      <div className="flex flex-col gap-8">
        <StoredEntries />
        <section aria-label="Instructions proven in recorded runs">
          <h2 className="text-[16px] font-semibold text-ink">Proven in recorded runs</h2>
          <p className="mb-3 mt-1 max-w-[70ch] text-[13px] leading-snug text-ink-3">Every instruction that passed L1 to L5 in any recorded run, read from the replays. Only the entries above have a stored evidence bundle; the others are recorded in their runs.</p>
          <LibraryView runIds={ids} />
        </section>
      </div>
    </PageFrame>
  );
}
