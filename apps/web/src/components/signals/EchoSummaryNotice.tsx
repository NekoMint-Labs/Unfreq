"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { markMyEchoSummarySeen } from "@/lib/signal-data";
import type { EchoSummary } from "@unfreq/contracts";

type EchoSummaryNoticeProps = {
  summary: EchoSummary;
};

const storageKeyPrefix = "unfreq:seen-resonance-total";

function subscribeToSeenTotal(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
  };
}

function readSeenTotal(storageKey: string): number | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const storedValue = window.localStorage.getItem(storageKey);
  const parsedValue =
    storedValue === null || storedValue.trim().length === 0
      ? undefined
      : Number(storedValue);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

export function EchoSummaryNotice({ summary }: EchoSummaryNoticeProps) {
  const storageKey = `${storageKeyPrefix}:${summary.frequencyId}`;
  const [isDismissed, setIsDismissed] = useState(false);
  const seenTotal = useSyncExternalStore(
    subscribeToSeenTotal,
    () => readSeenTotal(storageKey),
    () => undefined,
  );
  const visibleNewCount = useMemo(() => {
    if (seenTotal === undefined) {
      return summary.newResonanceCount;
    }

    return Math.max(summary.totalResonanceCount - seenTotal, summary.newResonanceCount);
  }, [seenTotal, summary.newResonanceCount, summary.totalResonanceCount]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(summary.totalResonanceCount));
    if (visibleNewCount > 0) {
      void markMyEchoSummarySeen();
    }
  }, [storageKey, summary.totalResonanceCount, visibleNewCount]);

  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    window.localStorage.setItem(storageKey, String(summary.totalResonanceCount));
  }, [storageKey, summary.totalResonanceCount]);

  if (isDismissed || visibleNewCount <= 0) {
    return null;
  }

  return (
    <aside className="my-frequency-section my-frequency-notice grid gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="radio-kicker">
          NEW RESONANCE
        </p>
        <button
          aria-label="关闭共鸣提示"
          className="radio-icon-button"
          onClick={handleDismiss}
          type="button"
        >
          ×
        </button>
      </div>
      <p className="mt-2 text-sm leading-6 text-[color:var(--text-primary)]">
        上次访问后新增 {visibleNewCount} 次共鸣。
      </p>
      {summary.topSignal ? (
        <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
          最亮的一段来自「{summary.topSignal.seedText}」。
        </p>
      ) : null}
    </aside>
  );
}
