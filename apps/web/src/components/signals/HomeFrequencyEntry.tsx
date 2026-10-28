"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError } from "@/lib/api-client";
import { getFrequencyCode } from "@/lib/frequency-data";
import { createSignal, getRandomSignal } from "@/lib/signal-data";
import type { FrequencyIdentity } from "@unfreq/contracts";
import { getHomeEntryStateCopy, type HomeEntryPhase } from "./home-frequency-entry-state";
import { SignalGenerationProgress } from "./SignalGenerationProgress";

const minSeedLength = 5;
const maxSeedLength = 200;
const defaultFrequencyCode = "FM 00.00";

function toErrorMessage(caughtError: unknown): string {
  if (caughtError instanceof ApiClientError && caughtError.code === "VALIDATION_ERROR") {
    return "种子需要 5 到 200 字。";
  }

  if (caughtError instanceof ApiClientError && caughtError.status === 401) {
    return "频率还没接入。刷新后再试一次。";
  }

  return "这句种子暂时没有发出。";
}

type HomeFrequencyEntryProps = {
  initialFrequency?: FrequencyIdentity;
  initialParentSignalId?: string;
  initialSeedText?: string;
  isApiUnavailable?: boolean;
  onboardingStep?: "seed";
};

export function HomeFrequencyEntry({
  initialFrequency,
  initialParentSignalId,
  initialSeedText = "",
  isApiUnavailable = false,
  onboardingStep,
}: HomeFrequencyEntryProps) {
  const router = useRouter();
  const [frequency] = useState<FrequencyIdentity | undefined>(initialFrequency);
  const [phase, setPhase] = useState<HomeEntryPhase>(
    initialFrequency !== undefined ? "ready" : isApiUnavailable ? "failed" : "locked",
  );
  const [seedText, setSeedText] = useState(initialSeedText);
  const [error, setError] = useState<string | undefined>();
  const [isTuningRandom, setIsTuningRandom] = useState(false);
  const [randomTuneError, setRandomTuneError] = useState<string | undefined>();

  const frequencyCode = frequency === undefined ? defaultFrequencyCode : getFrequencyCode(frequency);
  const trimmedSeedText = seedText.trim();
  const seedLength = trimmedSeedText.length;
  const isSubmitting = phase === "transmitting";
  const hasSeedText = seedLength > 0;
  const isLocked = phase === "locked";
  const shouldShowFrequencyEntry = frequency === undefined && isLocked;
  const stateCopy = getHomeEntryStateCopy(phase, isApiUnavailable);
  const loginHref = `/login?returnTo=${encodeURIComponent("/?onboarding=seed")}`;
  const canSubmit = useMemo(() => {
    return (
      phase === "ready" &&
      seedLength >= minSeedLength &&
      seedLength <= maxSeedLength &&
      !isSubmitting
    );
  }, [isSubmitting, phase, seedLength]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setError(undefined);
    setRandomTuneError(undefined);
    setPhase("transmitting");

    try {
      const signal = await createSignal({
        parentSignalId: initialParentSignalId,
        seedText: trimmedSeedText,
      });

      const transmittingPath = `/signal/${signal.id}/transmitting`;
      const nextPath = onboardingStep === "seed"
        ? `${transmittingPath}?onboarding=result`
        : transmittingPath;

      router.push(nextPath);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
      setPhase(frequency === undefined ? "locked" : "ready");
    }
  };

  const tuneRandom = async () => {
    setError(undefined);
    setRandomTuneError(undefined);
    setIsTuningRandom(true);

    try {
      const signal = await getRandomSignal();

      if (signal === undefined) {
        setRandomTuneError("还没有可接收的陌生信号。先发出一句种子。");
        return;
      }

      router.push(`/result/${signal.id}`);
    } catch {
      setRandomTuneError("暂时没有接收到陌生信号。");
    } finally {
      setIsTuningRandom(false);
    }
  };

  return (
    <section className="home-transmitter-shell">
      <div className={`home-transmitter ${isSubmitting ? "home-transmitter-active" : ""}`}>
        <p className="home-micro-brand">UNFREQ / {frequencyCode}</p>

        {onboardingStep === "seed" ? (
          <div className="tour-panel tour-panel-home" role="status">
            <p className="radio-kicker">FIRST TUNE · 01</p>
            <h1>把第一句话发向星海</h1>
            <p>
              不必解释来龙去脉。只把此刻最真实的一句话写在中央。够 5 个字后，底部「发射」会亮起，信号会自动去往结果页。
            </p>
          </div>
        ) : null}

        <form className="home-void-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="seed-text">
            写下种子
          </label>
          <div className="seed-field-frame">
            {isLocked ? (
              <div className="home-locked-seed-prompt" aria-hidden="true">
                <p>{stateCopy.lockedHint}</p>
              </div>
            ) : null}
            <textarea
              className={`home-seed-textarea disabled:opacity-60 ${hasSeedText ? "" : "home-seed-textarea-empty"} ${isLocked ? "home-seed-textarea-locked" : ""}`}
              disabled={phase !== "ready" && !isSubmitting}
              id="seed-text"
              maxLength={maxSeedLength}
              minLength={minSeedLength}
              name="seedText"
              onChange={(event) => setSeedText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="落笔，一念起..."
              readOnly={isSubmitting}
              required
              value={seedText}
            />
          </div>

          <SignalGenerationProgress isActive={isSubmitting} />

          <div
            className={`home-void-controls ${hasSeedText ? "home-void-controls-awake" : ""}`}
          >
            <button
              className="home-void-action home-void-action-zh"
              disabled={isTuningRandom || isSubmitting}
              onClick={tuneRandom}
              type="button"
            >
              {isTuningRandom ? "漫 游 中" : "漫 游"}
            </button>
            <span aria-hidden="true" className="home-void-separator">
              ·
            </span>
            <p className="home-void-count">
              {seedLength.toString().padStart(3, "0")} / {maxSeedLength}
            </p>
            <span aria-hidden="true" className="home-void-separator">
              ·
            </span>
            <button
              className={`home-void-action home-void-action-zh ${canSubmit ? "home-void-submit-ready" : ""}`}
              disabled={!canSubmit}
              type="submit"
            >
              {isSubmitting ? "调 频 中" : "发 射"}
            </button>
          </div>

          <div className="home-void-messages">
            {shouldShowFrequencyEntry && isLocked ? (
              <Link
                className="home-fm-entry-link"
                href={loginHref}
              >
                创建或登录 FM
              </Link>
            ) : null}
            {stateCopy.message !== undefined ? (
              <p className="home-micro-text">{stateCopy.message}</p>
            ) : null}
            {shouldShowFrequencyEntry ? (
              <p className="home-fm-entry-note mt-1 text-xs leading-6 text-white/35">
                已有频率也从这里登录
              </p>
            ) : null}
            {error ? (
              <p className="home-micro-text" role="alert">
                {error}
              </p>
            ) : null}
            {randomTuneError ? (
              <p className="home-micro-text" role="status">
                {randomTuneError}
              </p>
            ) : null}
          </div>
        </form>

        <Link className="home-void-exit" href="/galaxy">
          ENTER THE VOID
        </Link>
      </div>
    </section>
  );
}
