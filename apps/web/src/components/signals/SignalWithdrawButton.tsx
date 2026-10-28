"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { withdrawSignal } from "@/lib/signal-publication";
import { SignalActionFeedback } from "./SignalActionFeedback";
import { getSignalActionFeedbackState } from "./signal-action-state";

type SignalWithdrawButtonProps = {
  signalId: string;
  publicationVersion: number;
  canWithdraw: boolean;
};

const confirmationMessage =
  "撤回后，这条表达将不再公开。你仍可私密查看，满足发布条件时可主动再次发布。" +
  "平台无法立即清除第三方已下载或缓存的副本。撤回不等于彻底删除。";

function getSignalWithdrawErrorMessage(caughtError: unknown): string {
  if (caughtError instanceof ApiClientError) {
    if (caughtError.status === 401) {
      return "频率还没接入。刷新后再试一次。";
    }
    if (caughtError.status === 403) {
      return "你暂时不能撤回这条表达。";
    }
    if (caughtError.status === 404) {
      return "这条表达暂时无法撤回。";
    }
    if (caughtError.status === 409) {
      return "这条表达的状态已改变。刷新后再试一次。";
    }
  }

  return "暂时无法确认撤回结果。请刷新后查看。";
}

function WithdrawSignalAction({
  signalId,
  publicationVersion,
}: Omit<SignalWithdrawButtonProps, "canWithdraw">) {
  const router = useRouter();
  const mounted = useRef(true);
  const submitting = useRef(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | undefined>();
  const feedback = getSignalActionFeedbackState({
    error,
    isPending,
    pendingMessage: "正在撤回公开。",
    successMessage,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const withdraw = async () => {
    if (submitting.current || successMessage !== undefined) {
      return;
    }
    submitting.current = true;

    if (!window.confirm(confirmationMessage)) {
      submitting.current = false;
      return;
    }

    setError(undefined);
    setSuccessMessage(undefined);
    setIsPending(true);

    try {
      await withdrawSignal(signalId, publicationVersion);
      if (mounted.current) {
        setSuccessMessage("已撤回公开，你仍可私密查看。");
        router.refresh();
      }
    } catch (caughtError) {
      if (mounted.current) {
        setError(getSignalWithdrawErrorMessage(caughtError));
      }
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setIsPending(false);
      }
    }
  };

  return (
    <div>
      <button
        className="signal-next-secondary"
        disabled={isPending || successMessage !== undefined}
        onClick={() => {
          void withdraw();
        }}
        type="button"
      >
        {isPending ? "撤回中" : successMessage !== undefined ? "已撤回公开" : "撤回公开"}
      </button>
      <SignalActionFeedback kind={feedback?.kind} message={feedback?.message} />
    </div>
  );
}

export function SignalWithdrawButton({
  signalId,
  publicationVersion,
  canWithdraw,
}: SignalWithdrawButtonProps) {
  if (canWithdraw !== true) {
    return null;
  }

  return (
    <WithdrawSignalAction
      key={`${signalId}:${publicationVersion}`}
      publicationVersion={publicationVersion}
      signalId={signalId}
    />
  );
}
