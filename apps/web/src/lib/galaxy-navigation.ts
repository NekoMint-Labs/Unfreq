import type { SignalPrimaryBand } from "@unfreq/contracts";

export function galaxyHref(params: { band?: SignalPrimaryBand; theme?: string; focus?: string; onboarding?: string } = {}): string {
  const query = new URLSearchParams();
  if (params.band !== undefined) query.set("band", params.band);
  else if (params.theme !== undefined) query.set("theme", params.theme);
  if (params.focus !== undefined) query.set("focus", params.focus);
  if (params.onboarding !== undefined) query.set("onboarding", params.onboarding);
  return `/galaxy${query.size === 0 ? "" : `?${query}`}`;
}
