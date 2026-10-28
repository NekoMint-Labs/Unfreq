import type { SignalFingerprint } from "@unfreq/contracts";

type SignalFingerprintPanelProps = {
  fingerprint: SignalFingerprint;
};

const toPercent = (value: number) => `${Math.round(value * 100)}%`;

export function SignalFingerprintPanel({ fingerprint }: SignalFingerprintPanelProps) {
  const displayTags =
    fingerprint.tags.length > 0 ? fingerprint.tags : fingerprint.resonanceKeywords;

  return (
    <section className="radio-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="radio-kicker">signal fingerprint</p>
          <h2 className="mt-3 text-xl font-semibold">{fingerprint.title}</h2>
        </div>
        <span className="radio-tag">{fingerprint.frequency}</span>
      </div>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div className="radio-surface-strong p-3">
          <dt className="text-[color:var(--radio-dim)]">主频段</dt>
          <dd className="mt-1 text-[color:var(--radio-text)]">{fingerprint.displayText}</dd>
        </div>
        <div className="radio-surface-strong p-3">
          <dt className="text-[color:var(--radio-dim)]">情绪色彩</dt>
          <dd className="mt-1 text-[color:var(--radio-text)]">
            {fingerprint.emotionTone}
          </dd>
        </div>
        <div className="radio-surface-strong p-3">
          <dt className="text-[color:var(--radio-dim)]">能量</dt>
          <dd className="mt-1 font-mono text-[color:var(--radio-text)]">
            {toPercent(fingerprint.energy)}
          </dd>
        </div>
        <div className="radio-surface-strong p-3">
          <dt className="text-[color:var(--radio-dim)]">开放度</dt>
          <dd className="mt-1 font-mono text-[color:var(--radio-text)]">
            {toPercent(fingerprint.openness)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-3 text-sm">
        <p className="leading-7 text-[color:var(--radio-muted)]">
          {fingerprint.innerConflict}
        </p>
        <p className="leading-7 text-[color:var(--radio-muted)]">
          {fingerprint.coreNeed}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {displayTags.slice(0, 5).map((tag) => (
          <span className="radio-tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}
