import Link from "next/link";
import type { MonthlyRecap } from "@unfreq/contracts";

export function MonthlyRecapSourceNote() {
  return (
    <p className="text-sm leading-7 text-[color:var(--text-secondary)]">
      自动整理的回顾，可能有误，请对照原文。
    </p>
  );
}

export function MonthlyRecapEntry({
  isUnavailable = false,
  recap,
}: {
  isUnavailable?: boolean;
  recap?: MonthlyRecap;
}) {
  if (isUnavailable) {
    return (
      <section className="my-frequency-section p-5">
        <p className="radio-kicker">MONTHLY RECAP</p>
        <h2 className="my-frequency-section-title">月度回顾暂时没有同步</h2>
        <p className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">
          当前频率页面可以继续使用。回顾数据稍后刷新后会回到这里。
        </p>
      </section>
    );
  }

  if (recap === undefined) {
    return (
      <section className="my-frequency-section p-5">
        <p className="radio-kicker">MONTHLY RECAP</p>
        <h2 className="my-frequency-section-title">还没有月度回顾</h2>
        <p className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">
          回顾会整理符合条件的上月表达，至少需要 3 条。
        </p>
      </section>
    );
  }

  return (
    <section className="my-frequency-section grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="radio-kicker">MONTHLY RECAP</p>
          <h2 className="my-frequency-section-title">
            {recap.yearMonth} 月度回顾
          </h2>
        </div>
        <Link className="radio-button-secondary" href={`/me/recap/${recap.yearMonth}`}>
          打开
        </Link>
      </div>
      <p className="font-serif text-base leading-[1.8] text-[color:var(--text-primary)]">
        {recap.summary}
      </p>
      <MonthlyRecapSourceNote />
      <div className="flex flex-wrap gap-2">
        {recap.themeWords.map((word) => (
          <span className="radio-tag" key={word}>
            {word}
          </span>
        ))}
      </div>
      <p className="font-mono text-xs text-[color:var(--text-tertiary)]">
        {recap.signalCount} signals · {recap.totalResonanceCount} RES
      </p>
    </section>
  );
}
