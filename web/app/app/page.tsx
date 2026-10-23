import { AppShell } from "@/components/app/AppShell";
import { recordedRuns } from "@/lib/replay-index";

export default function AppPage() {
  // The full recorded search is only a link under Proof; it needs the ids of the recordings installed here.
  return <AppShell recorded={recordedRuns().filter((r) => r.domain === "silicon").map((r) => r.id)} />;
}
