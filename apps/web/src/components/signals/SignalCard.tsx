import Link from "next/link";
import type { PublicSignalDetail } from "@unfreq/contracts";
import { SignalPlaybackButton } from "@/components/signals/SignalPlaybackButton";
import { SignalResonanceButton } from "@/components/signals/SignalResonanceButton";

type SignalCardProps = {
  signal: PublicSignalDetail;
};

export function SignalCard({ signal }: SignalCardProps) {
  const displayTags = signal.tags;

  return (
    <article className="radio-surface radio-card-interactive p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm tracking-[0.16em] text-[color:var(--radio-text)]">
          {signal.authorFreqCode ?? "Unfreq"}
        </span>
        <time className="text-sm text-[color:var(--radio-dim)]" dateTime={signal.createdAt}>
          {new Date(signal.createdAt).toLocaleString("zh-CN", {
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            month: "2-digit",
          })}
        </time>
      </div>

      <h2 className="mt-4 text-xl font-semibold leading-tight">
        {signal.expandedText}
      </h2>

      <div className="mt-4 flex flex-wrap gap-2">
        {displayTags.slice(0, 5).map((tag) => (
          <span className="radio-tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-4 font-mono text-xs text-[color:var(--radio-dim)]">
          <span>共振回应 {signal.echoCount}</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <SignalResonanceButton
            initialCount={signal.resonanceCount}
            signalId={signal.id}
          />
          <SignalPlaybackButton
            signalId={signal.id}
            text={signal.expandedText}
          />
          <Link className="radio-button-secondary" href={`/result/${signal.id}`}>
            查看信号
          </Link>
        </div>
      </div>
    </article>
  );
}
