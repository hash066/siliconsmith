import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { TryForm } from "@/components/landing/TryForm";

export const metadata: Metadata = { title: "Try it" };

export default function Try() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[900px] px-4 pb-8 pt-16 sm:px-6 lg:px-8">
        <h1 className="text-[clamp(36px,5.5vw,64px)] font-semibold leading-[1] tracking-[-0.04em] text-ink">Start a real run</h1>
        <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-ink-2">
          Pick one of the two kernels SiliconSmith has harnesses for, and the engine starts a live search with Nemotron on Nebius Token Factory. You will watch the
          tree grow as it happens. Arbitrary C is not accepted yet: a new kernel needs a test harness, and the engine never runs code it has not been given one for.
        </p>
        <TryForm />
      </main>
      <SiteFooter />
    </>
  );
}
