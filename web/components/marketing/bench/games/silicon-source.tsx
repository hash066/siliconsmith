"use client";
import { BenchApiError, getText } from "../api";
import { extractSilicon, parseNdjson, SILICON_REPLAY_URL, type SiliconData } from "../data/silicon";
import { useRemote } from "../ui";

/** The recorded run both Silicon games read. Loaded once, kept for the page. */
export function useSilicon() {
  return useRemote<SiliconData>("silicon:" + SILICON_REPLAY_URL, async (signal) => {
    const data = extractSilicon(parseNdjson(await getText(SILICON_REPLAY_URL, signal)));
    if (!data) throw new BenchApiError("parse", "the recorded run has no profile");
    return data;
  });
}
