// Deep links from the landing page (games, CTAs) into the app. Owned by the integrator.
//   /app?wb=board&template=fault_gpio12_vs_gpio14
//   /app?wb=matter&p=<base64url(JSON {generator, gen_params, spreader})>&autorun=1
//   /app?wb=silicon&run=r_w1_contree3&node=n1.2.1
import type { WorkbenchId } from "./brand";

export type DeepLink =
  | { wb: "board"; template?: string; autorun?: boolean }
  | { wb: "matter"; params?: { generator?: string; gen_params?: Record<string, number>; spreader?: Record<string, number> }; autorun?: boolean }
  | { wb: "silicon"; run?: string; node?: string };

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export function toHref(link: DeepLink): string {
  const q = new URLSearchParams({ wb: link.wb });
  if (link.wb === "board" && link.template) q.set("template", link.template);
  if (link.wb === "matter" && link.params) q.set("p", b64(JSON.stringify(link.params)));
  if (link.wb === "silicon") {
    if (link.run) q.set("run", link.run);
    if (link.node) q.set("node", link.node);
  }
  if ("autorun" in link && link.autorun) q.set("autorun", "1");
  return `/app?${q.toString()}`;
}

export function fromSearch(sp: URLSearchParams): DeepLink | null {
  const wb = sp.get("wb") as WorkbenchId | null;
  if (wb === "board") return { wb, template: sp.get("template") ?? undefined, autorun: sp.get("autorun") === "1" };
  if (wb === "matter") {
    let params;
    try {
      const p = sp.get("p");
      params = p ? JSON.parse(unb64(p)) : undefined;
    } catch {
      params = undefined; // a malformed link opens the workbench with defaults
    }
    return { wb, params, autorun: sp.get("autorun") === "1" };
  }
  if (wb === "silicon") return { wb, run: sp.get("run") ?? undefined, node: sp.get("node") ?? undefined };
  return null;
}
