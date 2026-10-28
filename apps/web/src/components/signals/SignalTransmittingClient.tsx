"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createSignal,
  getSignal,
  isSignalDetail,
  isSignalGenerationDetail,
} from "@/lib/signal-data";
import type { SignalGenerationDetail, SignalGenerationStatus } from "@unfreq/contracts";

const generationSteps: Array<{
  label: string;
  status: Exclude<SignalGenerationStatus, "COMPLETED" | "FAILED">;
}> = [
  { label: "已接收", status: "RECEIVED" },
  { label: "正在扩写", status: "EXPANDING" },
  { label: "正在匹配", status: "MATCHING" },
  { label: "正在写入", status: "WRITING" },
];

const pollIntervalMs = 1300;

type SignalTransmittingClientProps = {
  initialSignal: SignalGenerationDetail;
  onboardingStep?: "result";
};

function getResultHref(signalId: string, onboardingStep?: "result"): string {
  const resultPath = `/result/${signalId}`;

  return onboardingStep === "result"
    ? `${resultPath}?onboarding=result`
    : resultPath;
}

function getTransmittingHref(signalId: string, onboardingStep?: "result"): string {
  const transmittingPath = `/signal/${signalId}/transmitting`;

  return onboardingStep === "result"
    ? `${transmittingPath}?onboarding=result`
    : transmittingPath;
}

function getActiveStepIndex(status: SignalGenerationStatus): number {
  if (status === "COMPLETED") {
    return generationSteps.length;
  }

  if (status === "FAILED") {
    return Math.max(0, generationSteps.length - 1);
  }

  return Math.max(0, generationSteps.findIndex((step) => step.status === status));
}

function getTransmittingTitle(status: SignalGenerationStatus): string {
  if (status === "FAILED") {
    return "信号没有发出";
  }

  if (status === "WRITING") {
    return "信号即将抵达";
  }

  return "信号正在穿过星海";
}

export function SignalTransmittingClient({
  initialSignal,
  onboardingStep,
}: SignalTransmittingClientProps) {
  const router = useRouter();
  const [signal, setSignal] = useState(initialSignal);
  const [pollError, setPollError] = useState<string | undefined>();
  const [isRetrying, setIsRetrying] = useState(false);
  const activeStepIndex = useMemo(() => {
    return getActiveStepIndex(signal.generationStatus);
  }, [signal.generationStatus]);
  const isFailed = signal.generationStatus === "FAILED";
  const resultHref = getResultHref(signal.id, onboardingStep);

  useEffect(() => {
    if (isFailed) {
      return;
    }

    let isCancelled = false;

    const pollSignal = async () => {
      try {
        const nextSignal = await getSignal(signal.id);

        if (isCancelled) {
          return;
        }

        if (nextSignal === undefined) {
          setPollError("信号暂时不可读取。");
          return;
        }

        if (isSignalGenerationDetail(nextSignal)) {
          setSignal(nextSignal);

          if (nextSignal.generationStatus === "COMPLETED") {
            router.replace(getResultHref(nextSignal.id, onboardingStep));
          }

          return;
        }

        if (isSignalDetail(nextSignal) || "visibility" in nextSignal) {
          router.replace(getResultHref(nextSignal.id, onboardingStep));
        }
      } catch {
        if (!isCancelled) {
          setPollError("信号状态暂时没有返回。");
        }
      }
    };

    void pollSignal();
    const interval = window.setInterval(() => {
      void pollSignal();
    }, pollIntervalMs);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [isFailed, onboardingStep, router, signal.id]);

  const retry = async () => {
    setIsRetrying(true);
    setPollError(undefined);

    try {
      const nextSignal = await createSignal({
        parentSignalId: signal.parentSignalId,
        seedText: signal.seedText,
      });

      router.replace(getTransmittingHref(nextSignal.id, onboardingStep));
    } catch {
      setPollError("重新发射失败。");
      setIsRetrying(false);
    }
  };

  return (
    <section className="signal-archive-page signal-transmitting-page">
      <div className="signal-archive-toolbar">
        <p className="signal-archive-confirmed">UNFREQ</p>
        <Link className="signal-archive-text-link" href="/">
          返回首页
        </Link>
      </div>

      <article className="signal-archive-hero signal-transmitting-hero">
        <div className="signal-seed-whisper">
          <p className="radio-kicker">ORIGINAL SEED</p>
          <p>{signal.seedText}</p>
        </div>

        <div
          aria-busy={!isFailed}
          className="signal-transmitting-core"
          role="status"
        >
          <p className="radio-kicker">
            {isFailed ? "TRANSMISSION FAILED" : "TRANSMITTING"}
          </p>
          <h1>{getTransmittingTitle(signal.generationStatus)}</h1>

          <ol className="signal-transmitting-steps">
            {generationSteps.map((step, index) => {
              const isActive = index === activeStepIndex && !isFailed;
              const isComplete = index < activeStepIndex && !isFailed;

              return (
                <li
                  className={[
                    "signal-transmitting-step",
                    isActive ? "signal-transmitting-step-active" : "",
                    isComplete ? "signal-transmitting-step-complete" : "",
                  ].filter(Boolean).join(" ")}
                  key={step.status}
                >
                  <span className="signal-transmitting-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{step.label}</span>
                  <span className="signal-transmitting-marker" />
                </li>
              );
            })}
          </ol>

          {isFailed ? (
            <p className="signal-transmitting-message">
              {signal.generationError ?? "这句种子暂时没有发出。"}
            </p>
          ) : null}
          {pollError ? (
            <p className="signal-transmitting-message" role="alert">
              {pollError}
            </p>
          ) : null}
        </div>
      </article>

      <section className="signal-archive-section signal-action-section">
        <div className="signal-action-heading">
          <div>
            <p className="radio-kicker">ACTIONS</p>
            <p>
              {isFailed ? "可以重新发射这句 seed。" : "完成后会自动进入结果页。"}
            </p>
          </div>
          {isFailed ? (
            <button
              className="signal-next-primary"
              disabled={isRetrying}
              onClick={retry}
              type="button"
            >
              {isRetrying ? "重新发射中" : "重新发射"}
            </button>
          ) : (
            <Link className="signal-next-primary" href={resultHref}>
              查看结果
            </Link>
          )}
        </div>
        <div className="signal-next-step-row">
          <Link className="signal-next-secondary" href="/">
            返回首页
          </Link>
          <Link className="signal-next-secondary" href="/me">
            我的频率
          </Link>
        </div>
      </section>
    </section>
  );
}
