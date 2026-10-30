import { LogoutButton } from "@/components/radio/LogoutButton";
import { SignalDots } from "@/components/signals/SignalDots";
import type { MySignalSummary } from "@unfreq/contracts";

export function CaptainPlaque({
  createdParts,
  frequencyCode,
  signals,
  totalResonanceCount,
  totalSignalCount,
  topSignal,
  isUnavailable = false,
}: {
  createdParts: { monthDay: string; year: string };
  frequencyCode: string;
  signals: MySignalSummary[];
  totalResonanceCount: number;
  totalSignalCount?: number;
  topSignal?: MySignalSummary;
  isUnavailable?: boolean;
}) {
  return (
    <aside className="my-frequency-anchor">
      <div className="grid gap-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="my-frequency-cn-label">专属频段</p>
            <p className="my-frequency-en-cue mt-2">FREQ.</p>
            <h1 className="frequency-number mt-4 text-[clamp(52px,7vw,74px)]">
              {frequencyCode}
            </h1>
          </div>
          <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--tone-l6)]">
            STABLE
          </span>
        </div>
        <p className="my-frequency-cn-label">观测记录</p>
        <span aria-hidden="true" className="my-frequency-rule" />
      </div>

      <div className="grid gap-5">
        <div className="grid gap-2">
          <span className="my-frequency-cn-label">{totalSignalCount === undefined ? "本页回响" : "全部回响"}</span>
          <span className="my-frequency-en-cue">ECHOS</span>
          <span className="font-mono text-[40px] leading-none text-[color:var(--tone-l9)]">
            {isUnavailable ? "—" : totalResonanceCount}
          </span>
          {!isUnavailable && totalSignalCount !== undefined ? <div className="grid gap-2 text-sm">
            <p>历史最高共鸣 {topSignal?.resonanceCount ?? 0}</p>
            {topSignal ? <a className="radio-button-text" href={`/result/${topSignal.id}`}>查看最高记录</a> : null}
            <p className="text-xs text-[color:var(--text-secondary)]">统计已完成且未删除的表达，包含撤回后的私密历史。</p>
          </div> : null}
        </div>
        <div className="grid gap-2">
          <span className="my-frequency-cn-label">唤醒于</span>
          <span className="font-mono text-lg text-[color:var(--tone-l8)]">
            {createdParts.monthDay}
          </span>
          <span className="font-mono text-xs text-[color:var(--tone-l6)]">
            {createdParts.year}
          </span>
        </div>
      </div>

      <div className="grid gap-3">
        <p className="my-frequency-cn-label">思想矩阵</p>
        <span aria-hidden="true" className="my-frequency-rule" />
        <SignalDots signals={signals} />
        <p className="font-mono text-[11px] text-[color:var(--tone-l6)]">
          {isUnavailable ? "记录暂不可用" : `本页 ${signals.length} 条${totalSignalCount === undefined ? "" : ` · 全部 ${totalSignalCount} 条`}`}
        </p>
      </div>

      <div className="grid gap-3">
        <p className="my-frequency-cn-label">频率控制</p>
        <span aria-hidden="true" className="my-frequency-rule" />
        <LogoutButton />
      </div>
    </aside>
  );
}
