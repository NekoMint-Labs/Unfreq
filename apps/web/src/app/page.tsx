import { HomeFrequencyEntry } from "@/components/signals/HomeFrequencyEntry";
import { isApiUnavailableError } from "@/lib/api-client";
import { getCurrentFrequency } from "@/lib/current-frequency";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{
    onboarding?: string;
    parentSignalId?: string;
    seed?: string;
  }>;
};

function parseHomeOnboardingStep(value?: string): "seed" | undefined {
  return value === "seed" ? value : undefined;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const onboardingStep = parseHomeOnboardingStep(params.onboarding);
  let frequency: Awaited<ReturnType<typeof getCurrentFrequency>> | undefined;
  let isApiUnavailable = false;

  const frequencyResult = await getCurrentFrequency().then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );

  if (frequencyResult.status === "fulfilled") {
    frequency = frequencyResult.value;
  } else if (isApiUnavailableError(frequencyResult.reason)) {
    isApiUnavailable = true;
  } else {
    throw frequencyResult.reason;
  }

  return (
    <HomeFrequencyEntry
      initialFrequency={frequency}
      initialParentSignalId={params.parentSignalId}
      initialSeedText={params.seed}
      onboardingStep={onboardingStep}
      isApiUnavailable={isApiUnavailable}
    />
  );
}
