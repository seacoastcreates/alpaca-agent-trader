"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

const INTERVAL_MS = 60_000; // matches the bot's 1-minute runs

/**
 * Re-fetches the page's server data every minute while the tab is visible, without a full reload.
 * Skips a refresh while focus is in a form field so it never interrupts typing.
 */
export function AutoRefresh({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const busy = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    };
    const refresh = () => {
      if (document.visibilityState === "visible" && !busy()) startTransition(() => router.refresh());
    };
    const id = setInterval(refresh, INTERVAL_MS);
    // Catch up immediately when returning to a tab that's been in the background.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - Date.parse(renderedAt) > INTERVAL_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, renderedAt]);

  const time = new Date(renderedAt).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit",
  });
  return (
    <p className="text-right text-xs text-muted" aria-live="polite">
      {pending ? "Refreshing…" : `Updated ${time} ET · refreshes every minute`}
    </p>
  );
}
