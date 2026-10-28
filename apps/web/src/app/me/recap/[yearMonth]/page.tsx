import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentMe } from "@/lib/current-frequency";
import { getFrequencyCode } from "@/lib/frequency-data";
import { getMonthlyRecap } from "@/lib/signal-data";

export const dynamic = "force-dynamic";

type MonthlyRecapPageProps = {
  params: Promise<{
    yearMonth: string;
  }>;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function MonthlyRecapPage({ params }: MonthlyRecapPageProps) {
  const { yearMonth } = await params;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const current = await getCurrentMe();

  if (current === undefined) {
    return (
      <section className="empty-state mx-auto max-w-2xl py-16">
        <p className="radio-kicker">MONTHLY RECAP</p>
        <h1 className="empty-state-title mt-4">先接入一组 FM 频率</h1>
        <p className="mt-4 leading-7 text-[color:var(--text-secondary)]">
          月度回顾只属于当前频率。
        </p>
        <Link className="radio-button-primary mt-8" href="/">
          去发射
        </Link>
      </section>
    );
  }

  const recap = await getMonthlyRecap(yearMonth, cookieHeader);

  if (recap === undefined) {
    notFound();
  }

  const frequencyCode = getFrequencyCode(current.frequency);

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="radio-button-secondary" href="/me">
          返回我的频率
        </Link>
        <span className="font-mono text-sm text-[color:var(--text-primary)]">
          {frequencyCode}
        </span>
      </div>

      <article className="radio-card grid gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="radio-kicker">MONTHLY RECAP</p>
            <h1 className="mt-4 text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
              {recap.yearMonth} 月度回顾
            </h1>
          </div>
          <time
            className="font-mono text-xs text-[color:var(--text-tertiary)]"
            dateTime={recap.generatedAt}
          >
            {formatDate(recap.generatedAt)}
          </time>
        </div>

        <p className="font-serif text-xl leading-[1.8] text-[color:var(--text-primary)]">
          {recap.summary}
        </p>

        <dl className="stat-grid">
          <div className="stat-cell">
            <dt className="stat-label">SIGNALS</dt>
            <dd className="stat-value">{recap.signalCount}</dd>
          </div>
          <div className="stat-cell">
            <dt className="stat-label">RESONANCE</dt>
            <dd className="stat-value">{recap.totalResonanceCount}</dd>
          </div>
          <div className="stat-cell">
            <dt className="stat-label">THEMES</dt>
            <dd className="mt-3 flex flex-wrap gap-2">
              {recap.themeWords.map((word) => (
                <span className="radio-tag" key={word}>
                  {word}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </article>

      {recap.topSignal !== undefined ? (
        <section className="radio-card grid gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="radio-kicker">TOP RESONANCE</p>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">
                本月最高共鸣信号
              </h2>
            </div>
            <Link className="radio-button-secondary" href={`/result/${recap.topSignal.id}`}>
              打开
            </Link>
          </div>
          <p className="text-sm leading-6 text-[color:var(--text-secondary)]">
            {recap.topSignal.seedText}
          </p>
          <p className="font-serif text-lg leading-[1.8] text-[color:var(--text-primary)]">
            {recap.topSignal.expandedText}
          </p>
          <span className="font-mono text-xs text-[color:var(--text-secondary)]">
            {recap.topSignal.resonanceCount} RES
          </span>
        </section>
      ) : null}
    </section>
  );
}
