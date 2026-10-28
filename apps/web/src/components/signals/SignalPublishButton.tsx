"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { publishSignal } from "@/lib/signal-data";
import { SignalActionFeedback } from "./SignalActionFeedback";
import { getSignalActionFeedbackState } from "./signal-action-state";

type SignalPublishButtonProps = {
  signalId: string;
};

function getSignalPublishErrorMessage(caughtError: unknown): string {
  if (caughtError instanceof ApiClientError && caughtError.status === 401) {
    return "频率还没接入。刷新后再试一次。";
  }

  if (caughtError instanceof ApiClientError && caughtError.status === 409) {
    return "这条信号暂时不能公开。";
  }

  return "信号暂时没有公开。";
}

export function SignalPublishButton({ signalId }: SignalPublishButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | undefined>();
  const feedback = getSignalActionFeedbackState({
    error,
    isPending,
    pendingMessage: "正在公开信号。",
    successMessage,
  });

  const publish = async () => {
    setError(undefined);
    setSuccessMessage(undefined);
    setIsPending(true);

    try {
      await publishSignal(signalId);
      setSuccessMessage("信号已经公开。");
      router.refresh();
    } catch (caughtError) {
      setError(getSignalPublishErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div>
      <button
        className="signal-next-primary"
        disabled={isPending}
        onClick={() => {
          void publish();
        }}
        type="button"
      >
        {isPending ? "公开中" : "确认发布"}
      </button>
      <SignalActionFeedback kind={feedback?.kind} message={feedback?.message} />
    </div>
  );
}
