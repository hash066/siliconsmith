import type { Metadata } from "next";
import { RunConsole } from "@/components/run/RunConsole";

export const dynamicParams = true;
export function generateStaticParams() {
  return [{ id: "r_w1_contree3" }, { id: "r_w1_final" }, { id: "r_w2_final3" }, { id: "r_w1_v3" }, { id: "r_m4_second" }];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Run ${id}` };
}

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const t = one(sp.t);
  const speed = Number(one(sp.speed));
  return (
    <RunConsole
      runId={id}
      initialNode={one(sp.node) ?? null}
      start={t === "end" ? "end" : t && Number.isFinite(Number(t)) ? Number(t) * 1000 : 0}
      speed={[1, 2, 4, 8, 16].includes(speed) ? speed : 8}
    />
  );
}
