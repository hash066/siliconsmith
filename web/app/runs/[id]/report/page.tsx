import type { Metadata } from "next";
import { Report } from "@/components/report/Report";

export function generateStaticParams() {
  return [{ id: "r_w1_contree3" }, { id: "r_w1_final" }, { id: "r_w2_final3" }, { id: "r_w1_v3" }, { id: "r_m4_second" }];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Report ${id}` };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Report runId={id} />;
}
