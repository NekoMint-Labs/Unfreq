import type { SignalProgram } from "@unfreq/contracts";

type DualSignalRadioProgramProps = {
  program: SignalProgram;
};

const scriptRows: Array<{
  key: keyof SignalProgram;
  label: string;
}> = [
  { key: "hostIntro", label: "开场" },
  { key: "leftSignalSummary", label: "左频" },
  { key: "rightSignalSummary", label: "右频" },
  { key: "bridgeNarration", label: "桥段" },
  { key: "closingQuestion", label: "收束" },
  { key: "shareQuote", label: "截句" },
];

export function DualSignalRadioProgram({ program }: DualSignalRadioProgramProps) {
  return (
    <section className="radio-surface p-5">
      <p className="radio-kicker">expanded signal</p>
      <h2 className="mt-3 text-xl font-semibold">{program.programTitle}</h2>
      <div className="mt-5 grid gap-3">
        {scriptRows.map((row) => {
          const value = program[row.key];

          if (value === undefined || value.length === 0) {
            return null;
          }

          return (
            <div className="grid gap-2 border-l border-[color:var(--radio-border)] pl-4" key={row.key}>
              <p className="font-mono text-xs tracking-[0.2em] text-[color:var(--radio-dim)]">
                {row.label}
              </p>
              <p className="text-sm leading-7 text-[color:var(--radio-muted)]">{value}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
