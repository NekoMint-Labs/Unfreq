import { apiClient } from "@/lib/api-client";
import type { ThemeRadioDay, ThemeRadioDayResponse } from "@unfreq/contracts";

export async function getCurrentThemeRadioDay(
  cookieHeader?: string,
): Promise<ThemeRadioDay | undefined> {
  const result = await apiClient.get<ThemeRadioDayResponse>("/api/theme-radio/current", {
    cache: "no-store",
    headers: cookieHeader !== undefined && cookieHeader.length > 0
      ? { cookie: cookieHeader }
      : undefined,
    timeoutMs: 2200,
  });

  return result.themeRadioDay;
}
