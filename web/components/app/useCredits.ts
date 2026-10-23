"use client";

import { useEffect, useState } from "react";
import { fetchAgentStatus } from "@/lib/agent-client";
import { LOADING_CREDITS, parseCredits, type CreditsView } from "./credits";

/** Window event the Agent can dispatch after a turn so the pill refreshes at once. */
export const CREDITS_EVENT = "hw:credits-changed";

/**
 * Credit balance for the pill. Reads `/api/agent` (the agent session's credits hook replaces this adapter when it lands:
 * only this file and credits.ts need to change). While the server is unreachable the pill says so; it never shows a made-up balance.
 */
export function useCredits(): CreditsView {
  const [view, setView] = useState<CreditsView>(LOADING_CREDITS);
  useEffect(() => {
    let dead = false;
    const ctl = new AbortController();
    const load = async () => {
      const s = await fetchAgentStatus(ctl.signal);
      if (!dead) setView(parseCredits(s));
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    window.addEventListener(CREDITS_EVENT, load);
    return () => {
      dead = true;
      ctl.abort();
      clearInterval(t);
      window.removeEventListener(CREDITS_EVENT, load);
    };
  }, []);
  return view;
}
