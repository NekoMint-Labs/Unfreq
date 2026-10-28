import Link from "next/link";
import type { MySignalSummary } from "@unfreq/contracts";
import { formatDateTime, toExpandedSummary } from "./my-frequency-utils";
import { SignalKindBadge } from "./SignalKindBadge";

export function SignalTimeline({ signals }: { signals: MySignalSummary[] }) {
  return (
    <div className="my-frequency-timeline">
      {signals.map((signal) => (
        <Link
          className="my-frequency-timeline-entry"
          href={`/result/${signal.id}`}
          key={signal.id}
        >
          <span
            aria-hidden="true"
            className="absolute left-[-19px] top-3 size-[9px] rounded-full border border-[color:var(--tone-l9)] bg-[color:var(--tone-l9)] shadow-[0_0_14px_rgba(255,255,255,0.28)]"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <SignalKindBadge isExtended={signal.parentSignalId !== undefined} />
              <time
                className="font-mono text-[color:var(--text-tertiary)]"
                dateTime={signal.createdAt}
              >
                {formatDateTime(signal.createdAt)}
              </time>
            </div>
            <span className="font-serif text-sm text-[color:var(--tone-l8)]">
              ✧ {signal.resonanceCount} 次共鸣
            </span>
          </div>
          <div className="grid gap-2">
            <p className="text-sm leading-6 text-[color:var(--text-secondary)]">
              {signal.seedText}
            </p>
            <p className="font-serif text-[18px] leading-[1.8] text-[color:var(--tone-l8)]">
              {toExpandedSummary(signal.expandedText)}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
