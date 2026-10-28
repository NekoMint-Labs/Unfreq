import type { SignalMatchSummary } from "@unfreq/contracts";

type MatchedSignalPanelProps = {
  matches: SignalMatchSummary[];
};

export function MatchedSignalPanel({ matches }: MatchedSignalPanelProps) {
  return (
    <section className="radio-surface p-5">
      <p className="radio-kicker">same frequency</p>
      <h2 className="mt-3 text-xl font-semibold">同频信号</h2>

      {matches.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {matches.map((match) => (
            <article className="radio-surface-strong p-4" key={match.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">{match.title}</h3>
                <span className="font-mono text-xs text-[color:var(--radio-dim)]">
                  {match.source === "SEEDED" ? "SEEDED" : "PUBLISHED"} / {match.score}
                </span>
              </div>
              <p className="mt-3 text-sm leading-7 text-[color:var(--radio-muted)]">
                {match.summary}
              </p>
              <p className="mt-3 text-sm leading-7 text-[color:var(--radio-muted)]">
                也在思考：{match.frequencyProfile.innerConflict}
              </p>
              <p className="mt-2 font-mono text-xs text-[color:var(--radio-dim)]">
                {match.frequencyProfile.displayText} ·{" "}
                {match.frequencyProfile.resonanceKeywords.slice(0, 3).join(" / ")}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-7 text-[color:var(--radio-muted)]">
          暂时没有匹配到公开同频信号。这段信号会先独自停留。
        </p>
      )}
    </section>
  );
}
