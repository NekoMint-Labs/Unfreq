type SignalActionFeedbackKind = "error" | "status";

type SignalActionFeedbackProps = {
  className?: string;
  kind?: SignalActionFeedbackKind;
  message?: string;
};

export function SignalActionFeedback({
  className,
  kind = "status",
  message,
}: SignalActionFeedbackProps) {
  if (message === undefined) {
    return null;
  }

  return (
    <p
      aria-live={kind === "status" ? "polite" : undefined}
      className={className ?? "radio-alert mt-2"}
      role={kind === "error" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}
