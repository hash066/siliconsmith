"use client";

import { useCredits as useServerCredits } from "@/lib/credits-client";
import { viewCredits, type CreditsView } from "./credits";

/** Credit balance for the pill. It refreshes itself whenever an agent turn ends (the hook listens for CREDITS_CHANGED). */
export function useCredits(): CreditsView {
  const { credits, loading } = useServerCredits();
  return viewCredits({ credits, loading });
}
