import type { MySignalSummary } from "@unfreq/contracts";
import { getTopFrequencyProfiles } from "./my-frequency-utils";

export function FrequencyBandSummary({ signals }: { signals: MySignalSummary[] }) {
  const profiles = getTopFrequencyProfiles(signals);

  if (profiles.length === 0) {
    return null;
  }

  const keywords = Array.from(
    new Set(profiles.flatMap((profile) => profile.resonanceKeywords.slice(0, 2))),
  ).slice(0, 3);

  return (
    <section className="my-frequency-section grid gap-4 p-5">
      <p className="radio-kicker">FREQUENCY BANDS</p>
      <h2 className="my-frequency-section-title">这个月你的信号更多落在</h2>
      <div className="flex flex-wrap gap-2">
        {profiles.map((profile) => (
          <span className="radio-tag" key={profile.primaryBand}>
            {profile.displayText.split(" · ")[0]}
          </span>
        ))}
      </div>
      {keywords.length > 0 ? (
        <p className="font-serif text-base leading-[1.8] text-[color:var(--text-primary)]">
          你这个月反复在思考{keywords.join("、")}。
        </p>
      ) : null}
    </section>
  );
}
