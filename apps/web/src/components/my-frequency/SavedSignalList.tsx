import Link from "next/link";
import type { SavedSignalSummary } from "@unfreq/contracts";
import { toExpandedSummary } from "./my-frequency-utils";

export function SavedSignalList({
  isUnavailable = false,
  signals,
}: {
  isUnavailable?: boolean;
  signals: SavedSignalSummary[];
}) {
  if (isUnavailable) {
    return (
      <section className="my-frequency-section empty-state justify-items-start p-5 text-left lg:col-start-2">
        <p className="radio-kicker">SAVED SIGNALS</p>
        <h2 className="my-frequency-section-title">收藏暂时没有同步</h2>
        <p className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">
          当前 FM 仍可访问。稍后刷新这里，会重新读取收藏信号。
        </p>
      </section>
    );
  }

  if (signals.length === 0) {
    return (
      <section className="my-frequency-section empty-state justify-items-start p-5 text-left lg:col-start-2">
        <p className="radio-kicker">SAVED SIGNALS</p>
        <h2 className="my-frequency-section-title">还没有收藏</h2>
        <p className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">
          在结果页或星图里收藏触动你的信号。这里只对你可见。
        </p>
      </section>
    );
  }

  return (
    <section className="my-frequency-section grid gap-4 p-5 lg:col-start-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="radio-kicker">SAVED SIGNALS</p>
          <h2 className="my-frequency-section-title">收藏发现</h2>
        </div>
        <span className="text-xs text-[color:var(--text-tertiary)]">
          只对自己可见
        </span>
      </div>
      <div className="grid gap-3">
        {signals.map((signal) => (
          <Link
            className="my-frequency-saved-card grid gap-3"
            href={`/result/${signal.id}`}
            key={signal.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <span className="radio-tag">{signal.authorFreqCode ?? "FM --.--"}</span>
                <span className="radio-tag">{signal.frequencyProfile.displayText}</span>
              </div>
              <span className="font-mono text-xs text-[color:var(--text-secondary)]">
                {signal.resonanceCount} RES
              </span>
            </div>
            <p className="font-serif text-base leading-[1.8] text-[color:var(--text-primary)]">
              {toExpandedSummary(signal.expandedText)}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
