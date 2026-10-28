import Link from "next/link";
import type { SignalDetail } from "@unfreq/contracts";
import { SignalPlaybackButton } from "@/components/signals/SignalPlaybackButton";
import { SignalResonanceButton } from "@/components/signals/SignalResonanceButton";

type SignalCardProps = {
  signal: SignalDetail;
};

export function SignalCard({ signal }: SignalCardProps) {
  const displayTags =
    signal.fingerprint.tags.length > 0
      ? signal.fingerprint.tags
      : signal.frequencyProfile.resonanceKeywords;

  return (
    <article className="radio-surface radio-card-interactive p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm tracking-[0.16em] text-[color:var(--radio-text)]">
          {signal.authorFreqCode ?? signal.fingerprint.frequency}
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
        {signal.seedText}
      </h2>
      <p className="mt-3 text-sm leading-7 text-[color:var(--radio-muted)]">
        {signal.expandedText}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="radio-tag">{signal.frequencyProfile.displayText}</span>
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
            initialAudio={{
              audioError: signal.audioError,
              audioStatus: signal.audioStatus,
              audioUrl: signal.audioUrl,
              audioUrlLeft: signal.audioUrlLeft,
              audioUrlRight: signal.audioUrlRight,
              signalId: signal.id,
            }}
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
