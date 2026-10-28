import { cookies } from "next/headers";
import Link from "next/link";
import { CaptainPlaque } from "@/components/my-frequency/CaptainPlaque";
import { FrequencyBandSummary } from "@/components/my-frequency/FrequencyBandSummary";
import { FrequencyOnboardingPanel } from "@/components/my-frequency/FrequencyOnboardingPanel";
import { MonthlyRecapEntry } from "@/components/my-frequency/MonthlyRecapEntry";
import { MySignalsUnavailableNotice } from "@/components/my-frequency/MySignalsUnavailableNotice";
import { SavedSignalList } from "@/components/my-frequency/SavedSignalList";
import { SignalThoughtTree } from "@/components/my-frequency/SignalThoughtTree";
import { SignalTimeline } from "@/components/my-frequency/SignalTimeline";
import { formatCreatedParts, parseOnboardingMode } from "@/components/my-frequency/my-frequency-utils";
import { RouteStatusPanel } from "@/components/layout/RouteStatusPanel";
import { EchoSummaryNotice } from "@/components/signals/EchoSummaryNotice";
import { SignalDots } from "@/components/signals/SignalDots";
import { ApiClientError, isApiUnavailableError } from "@/lib/api-client";
import { getFrequencyCode } from "@/lib/frequency-data";
import { getCurrentMe } from "@/lib/current-frequency";
import { getMySignals } from "@/lib/signal-data";
import {
  createEmptyMySignals,
  getOptionalFrequencyData,
  type MyFrequencySignalsState,
} from "./my-frequency-data";

export const dynamic = "force-dynamic";

type MyFrequencyPageProps = {
  searchParams: Promise<{
    onboarding?: string;
  }>;
};

export default async function MyFrequencyPage({ searchParams }: MyFrequencyPageProps) {
  const params = await searchParams;
  const onboardingMode = parseOnboardingMode(params.onboarding);
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  let current: Awaited<ReturnType<typeof getCurrentMe>>;

  try {
    current = await getCurrentMe();
  } catch (caughtError) {
    if (!isApiUnavailableError(caughtError)) {
      throw caughtError;
    }

    return (
      <RouteStatusPanel
        body="当前 API 没有响应。稍后可以回到这里查看你的频率、信号和共鸣。"
        kicker="MY FREQUENCY"
        title="频率暂时没有接入"
      >
        <Link className="radio-button-primary" href="/">
          回到发射
        </Link>
      </RouteStatusPanel>
    );
  }

  if (current === undefined) {
    return (
      <RouteStatusPanel
        body="发射种子后，这里会沉淀你的信号、扩写和收到的共鸣。"
        kicker="MY FREQUENCY"
        title="先接入一组 FM 频率"
      >
        <Link className="radio-button-primary" href="/">
          去发射
        </Link>
      </RouteStatusPanel>
    );
  }

  let mySignalsState: MyFrequencySignalsState;
  try {
    mySignalsState = {
      isUnavailable: false,
      value: await getMySignals(cookieHeader),
    };
  } catch (caughtError) {
    if (!(caughtError instanceof ApiClientError)) {
      throw caughtError;
    }

    if (caughtError.status === 401 || caughtError.status === 403) {
      throw caughtError;
    }

    mySignalsState = {
      isUnavailable: true,
      value: createEmptyMySignals(),
    };
  }

  const mySignals = mySignalsState.value;
  const {
    areSavedSignalsUnavailable,
    echoSummary,
    isEchoSummaryUnavailable,
    isLatestRecapUnavailable,
    latestRecap,
    savedSignals,
  } = await getOptionalFrequencyData({
    cookieHeader,
    frequencyId: current.frequency.id,
    mySignals,
    skipEchoSummary: mySignalsState.isUnavailable,
  });

  const frequencyCode = getFrequencyCode(current.frequency);
  const createdParts = formatCreatedParts(current.frequency.createdAt);
  const hasSignals = mySignals.signals.length > 0;
  const shouldShowOnboarding = onboardingMode !== undefined;

  return (
    <section className="my-frequency-page">
      {shouldShowOnboarding ? (
        <FrequencyOnboardingPanel
          frequencyCode={frequencyCode}
          mode={onboardingMode}
          signalCount={mySignals.signals.length}
        />
      ) : null}

      <div className="my-frequency-grid">
        <CaptainPlaque
          createdParts={createdParts}
          frequencyCode={frequencyCode}
          signals={mySignals.signals}
          totalResonanceCount={echoSummary.totalResonanceCount}
        />

        <div className="grid gap-6">
          {mySignalsState.isUnavailable ? <MySignalsUnavailableNotice /> : null}
          <section className="my-frequency-section grid gap-5 p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="radio-kicker">VOYAGE LOG</p>
                <h2 className="my-frequency-section-title">
                  航行日志
                </h2>
              </div>
            </div>

            {hasSignals ? (
              <SignalTimeline signals={mySignals.signals} />
            ) : (
              <div className="grid gap-3">
                <p className="font-serif text-[20px] leading-[1.8] text-[color:var(--tone-l8)]">
                  {frequencyCode} 依然静默。写下第一句种子，让第一波引力波从这里扩散。
                </p>
                <p className="font-mono text-xs text-[color:var(--tone-l6)]">
                  Press / to start
                </p>
                <div>
                  <Link className="my-frequency-init-link" href="/">
                    [ INIT FIRST SIGNAL ]
                  </Link>
                </div>
              </div>
            )}
          </section>

          {isEchoSummaryUnavailable ? null : <EchoSummaryNotice summary={echoSummary} />}
          <FrequencyBandSummary signals={mySignals.signals} />
          <MonthlyRecapEntry
            isUnavailable={isLatestRecapUnavailable}
            recap={latestRecap}
          />
        </div>
      </div>

      {hasSignals ? (
        <div className="my-frequency-grid">
          <section className="my-frequency-section p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="radio-kicker">SIGNAL DENSITY</h2>
              <span className="text-xs text-[color:var(--text-tertiary)]">
                共鸣越亮
              </span>
            </div>
            <div className="mt-5">
              <SignalDots signals={mySignals.signals} />
            </div>
          </section>

          <div className="grid gap-6">
            <SignalThoughtTree signals={mySignals.signals} />
            <SavedSignalList
              isUnavailable={areSavedSignalsUnavailable}
              signals={savedSignals.signals}
            />
          </div>
        </div>
      ) : (
        <SavedSignalList
          isUnavailable={areSavedSignalsUnavailable}
          signals={savedSignals.signals}
        />
      )}
    </section>
  );
}
