import { AppShell } from "@/components/app/AppShell";
import { recordedRuns } from "@/lib/replay-index";

export default function AppPage() {
  return <AppShell runs={recordedRuns()} />;
}
