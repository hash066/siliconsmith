import type { Metadata } from "next";
import { Workstation } from "@/components/workstation/Workstation";
import { recordedRuns } from "@/lib/replay-index";

export const metadata: Metadata = { title: "Workstation" };

export default function WorkstationPage() {
  return <Workstation runs={recordedRuns()} />;
}
