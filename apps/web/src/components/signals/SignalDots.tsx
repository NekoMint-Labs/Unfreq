import type { MySignalSummary } from "@unfreq/contracts";

type SignalDotsProps = {
  signals: MySignalSummary[];
};

function toDotScale(resonanceCount: number): string {
  if (resonanceCount >= 8) {
    return "scale-[1.38] opacity-100";
  }

  if (resonanceCount >= 3) {
    return "scale-[1.18] opacity-90";
  }

  if (resonanceCount > 0) {
    return "scale-100 opacity-75";
  }

  return "scale-[0.86] opacity-45";
}

export function SignalDots({ signals }: SignalDotsProps) {
  return (
    <div
      aria-label="信号点阵"
      className="grid grid-cols-8 gap-2 sm:grid-cols-10 md:grid-cols-12"
      role="list"
    >
      {signals.map((signal) => (
        <span
          aria-label={`${signal.seedText}，${signal.resonanceCount} 次共鸣`}
          className={`size-3 rounded-full border border-[color:var(--text-primary)] bg-[color:var(--text-primary)] ${toDotScale(signal.resonanceCount)}`}
          key={signal.id}
          role="listitem"
          title={`${signal.resonanceCount} 次共鸣`}
        />
      ))}
    </div>
  );
}
