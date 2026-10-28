import type { SignalDetail } from "@unfreq/contracts";

type SignalProgramCardProps = {
  signal: SignalDetail;
};

export function SignalProgramCard({ signal }: SignalProgramCardProps) {
  return (
    <section className="radio-surface-strong p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="radio-kicker">share card</p>
          <h2 className="mt-3 text-2xl font-semibold leading-tight">
            {signal.program.programTitle}
          </h2>
        </div>
        <span className="radio-tag">{signal.fingerprint.frequency}</span>
      </div>
      <blockquote className="mt-6 border-l border-[color:var(--radio-border)] pl-4 text-xl leading-9 text-[color:var(--radio-text)]">
        {signal.program.shareQuote}
      </blockquote>
      <div className="mt-6 flex flex-wrap gap-2">
        <span className="radio-tag">{signal.frequencyProfile.displayText}</span>
        {signal.frequencyProfile.resonanceKeywords.slice(0, 3).map((tag) => (
          <span className="radio-tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}
