import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SignalTransmittingClient } from "@/components/signals/SignalTransmittingClient";
import { getSignal, isSignalGenerationDetail } from "@/lib/signal-data";

export const dynamic = "force-dynamic";

type SignalTransmittingPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    onboarding?: string;
  }>;
};

function parseTransmittingOnboardingStep(value?: string): "result" | undefined {
  return value === "result" ? value : undefined;
}

function getResultHref(signalId: string, onboardingStep?: "result"): string {
  const resultPath = `/result/${signalId}`;

  return onboardingStep === "result"
    ? `${resultPath}?onboarding=result`
    : resultPath;
}

export default async function SignalTransmittingPage({
  params,
  searchParams,
}: SignalTransmittingPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const onboardingStep = parseTransmittingOnboardingStep(query.onboarding);
  const headersList = await headers();
  const signal = await getSignal(id, headersList.get("cookie") ?? undefined);

  if (signal === undefined) {
    notFound();
  }

  if (!isSignalGenerationDetail(signal)) {
    redirect(getResultHref(signal.id, onboardingStep));
  }

  return (
    <SignalTransmittingClient
      initialSignal={signal}
      onboardingStep={onboardingStep}
    />
  );
}
