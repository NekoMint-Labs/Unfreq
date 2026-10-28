"use client";

import Link from "next/link";
import { useState } from "react";
import type { ShareSignalCard } from "@unfreq/contracts";
import { SignalActionFeedback } from "./SignalActionFeedback";
import {
  getSignalActionFeedbackState,
  getSignalShareButtonState,
  getSignalShareErrorMessage,
} from "./signal-action-state";

type ShareSignalCardPreviewProps = {
  card: ShareSignalCard;
  shareUrl: string;
};

export function ShareSignalCardPreview({ card, shareUrl }: ShareSignalCardPreviewProps) {
  const [error, setError] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | undefined>();
  const buttonState = getSignalShareButtonState({ isPending });
  const feedback = getSignalActionFeedbackState({
    error,
    isPending,
    pendingMessage: "正在复制信号链接。",
    successMessage,
  });

  const copyShareUrl = async () => {
    setError(undefined);
    setSuccessMessage(undefined);
    setIsPending(true);

    try {
      if (navigator.clipboard === undefined) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(shareUrl);
      setSuccessMessage("信号链接已经复制。");
    } catch (caughtError) {
      setError(getSignalShareErrorMessage(caughtError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <section className="signal-archive-section share-signal-preview">
      <div className="signal-section-heading">
        <div>
          <p className="radio-kicker">SHARE SIGNAL</p>
          <p>
            LINK / {card.frequencyCode}
          </p>
        </div>
        <div className="share-signal-actions">
          <button
            className="signal-archive-text-link"
            disabled={buttonState.disabled}
            onClick={() => {
              void copyShareUrl();
            }}
            type="button"
          >
            {buttonState.label}
          </button>
          <Link
            className="signal-archive-text-link"
            href={card.imageUrl}
            prefetch={false}
            target="_blank"
          >
            打开卡片
          </Link>
        </div>
      </div>
      <p className="share-signal-url">
        {shareUrl}
      </p>
      <SignalActionFeedback
        className="share-signal-feedback"
        kind={feedback?.kind}
        message={feedback?.message}
      />
    </section>
  );
}
