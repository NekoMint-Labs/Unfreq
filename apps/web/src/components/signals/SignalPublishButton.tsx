"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import type { SignalPublicationPreview } from "@unfreq/contracts";
import { publishSignal } from "@/lib/signal-data";
import { SignalActionFeedback } from "./SignalActionFeedback";
import { getSignalActionFeedbackState } from "./signal-action-state";

type SignalPublishButtonProps = {
  signalId: string;
  preview: SignalPublicationPreview;
  republish?: boolean;
};

function getSignalPublishErrorMessage(caughtError: unknown): string {
  if (caughtError instanceof ApiClientError && caughtError.status === 401) {
    return "频率还没接入。刷新后再试一次。";
  }

  if (caughtError instanceof ApiClientError && caughtError.status === 409) {
    return "预览或发布条件已改变。请刷新、重新检查预览后再发布。";
  }

  return "信号暂时没有公开。";
}

export function SignalPublishButton({ signalId, preview, republish }: SignalPublishButtonProps) {
  const router = useRouter();
  const submitting = useRef(false);
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
    if (submitting.current) return;
    submitting.current = true;
    setError(undefined);
    setSuccessMessage(undefined);
    setIsPending(true);

    try {
      await publishSignal(signalId, { expectedVersion: preview.version, digest: preview.digest });
      setSuccessMessage("信号已经公开。");
      router.refresh();
    } catch (caughtError) {
      setError(getSignalPublishErrorMessage(caughtError));
    } finally {
      submitting.current = false;
      setIsPending(false);
    }
  };

  return (
    <div className="signal-publication-preview">
      <p>将公开以下全部内容：</p>
      <p className="mt-3 font-mono">{preview.content.authorFreqCode ?? "未设置 FM 代号"}</p>
      <p className="signal-publication-body my-5">{preview.content.expandedText}</p>
      <div className="flex flex-wrap gap-2 mb-5">{preview.content.tags.map((tag) => <span className="radio-tag" key={tag}>{tag}</span>)}</div>
      <p className="mb-4 text-sm">原始输入字段和完整分析不会随信号公开。请检查正文；点击下方按钮，即确认公开以上正文、FM 代号和标签。</p>
      <button
        className="signal-next-primary"
        disabled={isPending || successMessage !== undefined}
        onClick={() => {
          void publish();
        }}
        type="button"
      >
        {isPending ? "公开中" : republish ? "确认重新发布" : "确认发布"}
      </button>
      <SignalActionFeedback kind={feedback?.kind} message={feedback?.message} />
    </div>
  );
}
