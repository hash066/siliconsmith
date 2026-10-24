"use client";

import { useEffect, useState } from "react";
import type { ApiFailure } from "@/lib/hosted";

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return <span className="num">{left > 0 ? `try again in ${left} s` : "you can try again now"}</span>;
}

const TITLE: Record<ApiFailure["kind"], string> = {
  field: "The input was not accepted",
  rate: "Too many requests",
  too_large: "The input is too large",
  disabled: "Not enabled on this deployment",
  server: "The service had a problem",
  network: "The service could not be reached",
};

/** One place for every failure state of the hosted functions. Field errors list the exact path so the user can fix them. */
export function ApiErrorView({ failure, onRetry }: { failure: ApiFailure; onRetry?: () => void }) {
  const tone = failure.kind === "rate" ? "border-amber/40 bg-amber-dim" : "border-red/40 bg-red-dim";
  return (
    <div className={`rounded-lg border px-4 py-3 ${tone}`} role="alert">
      <h3 className="text-[13px] font-medium text-ink">
        {TITLE[failure.kind]}
        {failure.status ? <span className="num ml-2 text-[12px] font-normal text-ink-3">HTTP {failure.status}</span> : null}
      </h3>
      <p className="mt-1 break-words text-[13px] leading-snug text-ink-2">{failure.message}</p>
      {failure.kind === "field" && failure.fields.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {failure.fields.map((f, i) => (
            <li key={i} className="text-[12.5px] leading-snug text-ink">
              <span className="num mr-2 break-all rounded-[3px] bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">{f.path || "(whole input)"}</span>
              {f.message}
            </li>
          ))}
        </ul>
      )}
      {failure.kind === "rate" && (
        <p className="mt-1 text-[12.5px] text-ink-2">
          The limit is counted in memory per server instance. {failure.retryAfterS !== null ? <Countdown seconds={failure.retryAfterS} /> : "Wait a little and try again."}
        </p>
      )}
      {failure.kind === "network" && onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 h-8 rounded-md border border-line-2 px-3 text-[12.5px] text-ink hover:bg-raised">
          Try again
        </button>
      )}
    </div>
  );
}
