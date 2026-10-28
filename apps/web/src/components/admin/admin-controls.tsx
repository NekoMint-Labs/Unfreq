export function ActionButton({
  disabled,
  isPending,
  label,
  onClick,
  tone = "default",
}: {
  disabled?: boolean;
  isPending: boolean;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  const className =
    tone === "danger"
      ? "min-h-9 rounded-[8px] border border-rose-500/35 px-3 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-45"
      : "min-h-9 rounded-[8px] border border-[color:var(--radio-border)] px-3 text-xs font-semibold text-[color:var(--radio-text)] transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <button
      className={className}
      disabled={disabled || isPending}
      onClick={onClick}
      type="button"
    >
      {isPending ? "处理中" : label}
    </button>
  );
}

export function AdminField({
  className,
  label,
  onChange,
  type = "text",
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  type?: "password" | "text";
  value: string;
}) {
  return (
    <label className={`grid gap-2 ${className ?? ""}`}>
      <span className="font-mono text-xs uppercase tracking-[0.14em] text-[color:var(--radio-dim)]">
        {label}
      </span>
      <input
        className="min-h-10 rounded-[8px] border border-[color:var(--radio-border)] bg-black/20 px-3 py-2 font-mono text-sm text-[color:var(--radio-text)] outline-none transition focus:border-white/35"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}
