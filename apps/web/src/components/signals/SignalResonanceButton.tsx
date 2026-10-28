"use client";

import { useState } from "react";
import { addSignalResonance } from "@/lib/signal-data";
import { SignalActionFeedback } from "./SignalActionFeedback";
import {
  getSignalActionFeedbackState,
  getSignalResonanceButtonState,
  getSignalResonanceErrorMessage,
} from "./signal-action-state";

type SignalResonanceButtonProps = {
  activeButtonClassName?: string;
  buttonClassName?: string;
  initialCount: number;
  labelPrefix?: string;
  signalId: string;
};

export function SignalResonanceButton({
  activeButtonClassName,
  buttonClassName,
  initialCount,
  labelPrefix = "",
  signalId,
}: SignalResonanceButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | undefined>();
  const [hasResonated, setHasResonated] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | undefined>();
  const buttonState = getSignalResonanceButtonState({
    count,
    hasResonated,
    isPending,
    labelPrefix,
  });
  const feedback = getSignalActionFeedbackState({
    error,
    isPending,
    pendingMessage: "正在送出共鸣。",
    successMessage,
  });

  const toggle = async () => {
    if (hasResonated) {
      return;
    }

    setError(undefined);
    setSuccessMessage(undefined);
    setIsPending(true);

    try {
      const result = await addSignalResonance(signalId, {});

      setCount(result.resonanceCount);
      setHasResonated(result.hasResonated);
      setSuccessMessage("共鸣已经送出。");
    } catch (caughtError) {
      setError(getSignalResonanceErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div>
      <button
        className={
          hasResonated
            ? activeButtonClassName ?? "radio-button-primary"
            : buttonClassName ?? "radio-button-secondary"
        }
        disabled={buttonState.disabled}
        onClick={toggle}
        type="button"
      >
        {buttonState.label}
      </button>
      <SignalActionFeedback kind={feedback?.kind} message={feedback?.message} />
    </div>
  );
}
