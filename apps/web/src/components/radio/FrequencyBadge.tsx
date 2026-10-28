type FrequencyBadgeProps = {
  code: string;
  label?: string;
};

export function FrequencyBadge({ code, label }: FrequencyBadgeProps) {
  return (
    <span className="radio-surface inline-flex min-h-9 items-center gap-3 px-3 py-2 font-mono text-sm text-[color:var(--radio-text)]">
      <span className="tracking-[0.18em]">{code}</span>
      {label ? (
        <span className="border-l border-[color:var(--radio-border)] pl-3 font-sans text-xs text-[color:var(--radio-dim)]">
          {label}
        </span>
      ) : null}
    </span>
  );
}
