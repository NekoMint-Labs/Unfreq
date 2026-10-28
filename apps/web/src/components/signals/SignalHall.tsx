import Link from "next/link";
import type { SignalDetail } from "@unfreq/contracts";
import { SignalCard } from "@/components/signals/SignalCard";

type SignalHallProps = {
  signals: SignalDetail[];
};

export function SignalHall({ signals }: SignalHallProps) {
  if (signals.length === 0) {
    return (
      <div className="radio-surface mt-8 grid gap-4 p-5 sm:p-6">
        <div>
          <p className="radio-kicker">EMPTY SIGNALS</p>
          <h2 className="mt-3 text-xl font-semibold">还没有公开信号。</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[color:var(--radio-muted)]">
            先从首页发出一段种子，生成扩展信号后可以选择公开。
          </p>
        </div>
        <Link className="radio-button-secondary w-fit" href="/">
          发射种子
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-4">
      {signals.map((signal) => (
        <SignalCard key={signal.id} signal={signal} />
      ))}
    </div>
  );
}
