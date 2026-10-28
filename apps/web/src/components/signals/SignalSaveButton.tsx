"use client";

import { useState } from "react";
import { saveSignal, unsaveSignal } from "@/lib/signal-data";
import { SignalActionFeedback } from "./SignalActionFeedback";
import {
  getSignalActionFeedbackState,
  getSignalSaveButtonState,
  getSignalSaveErrorMessage,
} from "./signal-action-state";

type SignalSaveButtonProps = {
  activeButtonClassName?: string;
  buttonClassName?: string;
  initialSaved?: boolean;
  labelPrefix?: string;
  signalId: string;
};

export function SignalSaveButton({
  activeButtonClassName,
  buttonClassName,
  initialSaved = false,
  labelPrefix = "",
  signalId,
}: SignalSaveButtonProps) {
  const [error, setError] = useState<string | undefined>();
  const [hasSaved, setHasSaved] = useState(initialSaved);
  const [isPending, setIsPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | undefined>();
  const buttonState = getSignalSaveButtonState({
    hasSaved,
    isPending,
    labelPrefix,
  });
  const feedback = getSignalActionFeedbackState({
    error,
    isPending,
    pendingMessage: hasSaved ? "正在移出收藏。" : "正在保存信号。",
    successMessage,
  });

  const toggle = async () => {
    setError(undefined);
    setSuccessMessage(undefined);
    setIsPending(true);

    try {
      const result = hasSaved ? await unsaveSignal(signalId) : await saveSignal(signalId);

      setHasSaved(result.hasSaved);
      setSuccessMessage(result.hasSaved ? "信号已经收藏。" : "信号已移出收藏。");
    } catch (caughtError) {
      setError(getSignalSaveErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div>
      <button
        className={
          hasSaved
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
