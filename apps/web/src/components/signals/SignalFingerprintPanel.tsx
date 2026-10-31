import type { SignalFingerprint } from "@unfreq/contracts";

type SignalFingerprintPanelProps = {
  fingerprint: SignalFingerprint;
};

export function SignalFingerprintPanel({ fingerprint }: SignalFingerprintPanelProps) {
  return (
    <section className="radio-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="radio-kicker">表达记录</p>
          <h2 className="mt-3 text-xl font-semibold">解读状态</h2>
        </div>
        <span className="radio-tag">{fingerprint.frequency}</span>
      </div>

      {/* Rules, unverified Provider output, and missing legacy provenance are all suppressed. */}
      <p className="mt-5 text-sm leading-7 text-[color:var(--radio-muted)]">
        暂不展示心理解读。
      </p>
    </section>
  );
}
