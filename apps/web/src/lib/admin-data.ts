import { cookies } from "next/headers";
import { apiClient } from "@/lib/api-client";
import type { AdminDashboardData } from "@unfreq/contracts/admin";
import type { SignalDetailPage } from "@unfreq/contracts";

type AdminOverviewResponse = Pick<AdminDashboardData, "overview">;
type AdminSignalsResponse = Pick<AdminDashboardData, "signals">;
type AdminReportsResponse = Pick<AdminDashboardData, "reports">;
type AdminFrequenciesResponse = Pick<AdminDashboardData, "frequencies">;
type AdminUsersResponse = Pick<AdminDashboardData, "users">;
type AdminAiReviewsResponse = Pick<AdminDashboardData, "aiReviews">;
type AdminAiEvaluationResponse = Pick<AdminDashboardData, "evaluation">;
type AdminProviderConfigsResponse = Pick<AdminDashboardData, "providerConfigs">;
type AdminAiSignalsResponse = { signals: SignalDetailPage };

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const headers = cookieHeader.length > 0 ? { cookie: cookieHeader } : undefined;

  const [
    overviewResult,
    signalsResult,
    reportsResult,
    frequenciesResult,
    usersResult,
    aiReviewsResult,
    evaluationResult,
    providerConfigsResult,
    aiSignalsResult,
  ] =
    await Promise.all([
      apiClient.get<AdminOverviewResponse>("/api/admin/overview", {
        cache: "no-store",
        headers,
      }),
      apiClient.get<AdminSignalsResponse>("/api/admin/signals", {
        cache: "no-store",
        headers,
      }),
      apiClient.get<AdminReportsResponse>("/api/admin/reports?status=PENDING", {
        cache: "no-store",
        headers,
      }),
      apiClient.get<AdminFrequenciesResponse>("/api/admin/frequencies", {
        cache: "no-store",
        headers,
      }),
      apiClient.get<AdminUsersResponse>("/api/admin/users", {
        cache: "no-store",
        headers,
      }),
      apiClient.get<AdminAiReviewsResponse>("/api/admin/ai-reviews", {
        cache: "no-store",
        headers,
      }),
      apiClient.get<AdminAiEvaluationResponse>("/api/admin/ai-evaluation", {
        cache: "no-store",
        headers,
      }),
      apiClient.get<AdminProviderConfigsResponse>("/api/admin/provider-configs", {
        cache: "no-store",
        headers,
      }),
      apiClient.get<AdminAiSignalsResponse>("/api/admin/ai-signals?source=ai_generated", {
        cache: "no-store",
        headers,
      }),
    ]);

  return {
    aiReviews: aiReviewsResult.aiReviews,
    aiSignals: aiSignalsResult.signals,
    evaluation: evaluationResult.evaluation,
    frequencies: frequenciesResult.frequencies,
    overview: overviewResult.overview,
    providerConfigs: providerConfigsResult.providerConfigs,
    reports: reportsResult.reports,
    signals: signalsResult.signals,
    users: usersResult.users,
  };
}
