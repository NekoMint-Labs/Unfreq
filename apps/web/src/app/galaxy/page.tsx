import { cookies } from "next/headers";
import { GalaxyCanvas } from "@/components/galaxy/GalaxyCanvas";
import { isApiUnavailableError } from "@/lib/api-client";
import { getSignalGalaxy } from "@/lib/signal-data";
import type { SignalPrimaryBand } from "@unfreq/contracts";

export const dynamic = "force-dynamic";

type GalaxyPageProps = {
  searchParams: Promise<{
    band?: string;
    onboarding?: string;
    theme?: string;
    focus?: string;
  }>;
};

const signalPrimaryBands = [
  "self_mirror",
  "emotional_undercurrent",
  "relationship_nebula",
  "time_ring",
  "meaning_deep_space",
  "stagnant_orbit",
  "era_cluster",
] as const satisfies readonly SignalPrimaryBand[];

function parseGalaxyOnboardingStep(value?: string): "galaxy" | undefined {
  return value === "galaxy" ? value : undefined;
}

function getSelectedBand(band?: string): SignalPrimaryBand | undefined {
  const value = band?.trim();

  if (value === undefined || !signalPrimaryBands.includes(value as SignalPrimaryBand)) {
    return undefined;
  }

  return value as SignalPrimaryBand;
}

export default async function GalaxyPage({ searchParams }: GalaxyPageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const onboardingStep = parseGalaxyOnboardingStep(params.onboarding);
  const selectedBand = getSelectedBand(params.band);
  const focus = typeof params.focus === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(params.focus) ? params.focus : undefined;
  const selectedTheme = selectedBand === undefined && typeof params.theme === "string" && params.theme.trim().length <= 48
    ? params.theme.trim() || undefined : undefined;
  let galaxy: Awaited<ReturnType<typeof getSignalGalaxy>>;
  let isUnavailable = false;

  try {
    galaxy = await getSignalGalaxy(cookieHeader, selectedBand, focus, selectedTheme);
  } catch (caughtError) {
    if (!isApiUnavailableError(caughtError)) {
      throw caughtError;
    }

    const emptyGalaxy = {
      bandOptions: [],
      generatedAt: new Date().toISOString(),
      points: [],
      themeOptions: [],
    };

    galaxy = emptyGalaxy;
    isUnavailable = true;
  }

  return (
    <GalaxyCanvas
      generatedAt={galaxy.generatedAt}
      coverage={galaxy.coverage}
      isUnavailable={isUnavailable}
      key={`${selectedBand ?? selectedTheme ?? "all"}:${focus ?? "none"}:${onboardingStep ?? "idle"}`}
      bandOptions={galaxy.bandOptions ?? []}
      onboardingStep={onboardingStep}
      points={galaxy.points}
      selectedBand={selectedBand}
      selectedTheme={selectedTheme}
    />
  );
}
