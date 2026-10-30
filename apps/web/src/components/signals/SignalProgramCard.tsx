import type { PublicSignalDetail } from "@unfreq/contracts";

type SignalProgramCardProps = {
  signal: PublicSignalDetail;
};

export function SignalProgramCard({ signal }: SignalProgramCardProps) {
  return (
    <section className="radio-surface-strong p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="radio-kicker">share card</p>
          <h2 className="mt-3 text-2xl font-semibold leading-tight">
            {signal.authorFreqCode ?? "Unfreq"}
          </h2>
        </div>
        <span className="radio-tag">{signal.authorFreqCode}</span>
      </div>
      <blockquote className="mt-6 border-l border-[color:var(--radio-border)] pl-4 text-xl leading-9 text-[color:var(--radio-text)]">
        {signal.expandedText}
      </blockquote>
      <div className="mt-6 flex flex-wrap gap-2">
        {signal.tags.map((tag) => (
          <span className="radio-tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}
