import Link from "next/link";
import type { PublicSignalMatchSummary } from "@unfreq/contracts";
import { contentSourceLabel } from "./content-source-label";

type MatchedSignalPanelProps = {
  matches: PublicSignalMatchSummary[];
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
                <h3 className="font-semibold"><Link href={`/result/${match.id}`}>{match.authorFreqCode ?? "Unfreq"}</Link></h3>
                <span className="font-mono text-xs text-[color:var(--radio-dim)]">
                  {contentSourceLabel(match.contentSource, match.source)}
                </span>
              </div>
              <p className="mt-3 text-sm leading-7 text-[color:var(--radio-muted)]">
                {match.expandedText}
              </p>
              <p className="mt-2 text-xs">{match.tags.join(" / ")}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-7 text-[color:var(--radio-muted)]">
          暂无合适同频。这段信号会先独自停留，之后也可以再来看看。
        </p>
      )}
    </section>
  );
}
