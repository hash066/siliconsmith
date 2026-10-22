import type { Metadata } from "next";
import { LibraryView } from "@/components/library/LibraryView";
import { PageFrame } from "@/components/library/PageFrame";
import { recordedRuns } from "@/lib/replay-index";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  const ids = recordedRuns().filter((r) => r.domain === "silicon").map((r) => r.id);
  return (
    <PageFrame
      current="/workstation/library"
      title="Library"
      intro="Instructions that passed the whole verification ladder in a recorded run: lint, unit tests against the C reference, the formal proof, the whole-workload check and synthesis. Nothing is listed by hand; each entry is read from the run's own events and links to the evidence behind its numbers."
    >
      <LibraryView runIds={ids} />
    </PageFrame>
  );
}
