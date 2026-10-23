import { redirect } from "next/navigation";
import { workstationRedirect } from "@/components/app/redirect";

// /workstation is retired: it, and its old Library and Templates sub-pages, now lead to the app.
export default async function WorkstationRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(workstationRedirect(await searchParams));
}
