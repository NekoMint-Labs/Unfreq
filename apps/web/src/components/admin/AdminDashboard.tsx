"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, apiClient } from "@/lib/api-client";
import type {
  AdminDashboardData,
  AdminFrequencyRecord,
  AdminGenerateSignalsResponse,
  AdminKeepSignalUpdate,
  AdminSignalPage,
  AdminProviderConfigKind,
  AdminProviderConfigRecord,
  AdminProviderConfigTestResponse,
  AdminProviderConfigTestResult,
  AdminProviderConfigUpdate,
  AdminReportRecord,
  AdminReportResolution,
  AdminSignalRecord,
  AdminSignalStatusUpdate,
  AdminUserStatus,
  AdminUserStatusUpdate,
} from "@unfreq/contracts/admin";
import type { SignalDetail, SignalDetailPage, SignalStatus } from "@unfreq/contracts";
import {
  AdminAiEvaluationSection,
  AdminAiObservabilitySection,
  AdminSeedLibrarySection,
} from "./AdminAiSections";
import { AdminOperationsSection, AdminReportsSection } from "./AdminModerationSections";
import {
  AdminFrequenciesSection,
  AdminGalaxyOpsSection,
  AdminSignalsSection,
} from "./AdminSignalSections";
import {
  AdminNavButton,
  type AdminSectionId,
  CapabilityTile,
  CategoryTile,
  CollapsibleSection,
  matchesSearch,
  MetricTile,
  type MutationState,
  type PagedRows,
  usePagedRows,
  userStatusLabels,
} from "./admin-dashboard-shared";
import { ProviderConfigSection, providerKindLabels } from "./ProviderConfigSection";
import {
  buildProviderPayload,
  confirmAndDeleteProviderConfig,
  createEmptyProviderDraft,
  getProviderDraftKey,
  type ProviderConfigDraft,
  removeProviderDraftOverride,
  toProviderDrafts,
} from "./provider-config-workflow";

type AdminDashboardProps = {
  data: AdminDashboardData;
};

function toServerPagedRows<T>(params: {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isPending: boolean;
  items: T[];
  limit: number;
  next: () => void;
  page: number;
  previous: () => void;
  total: number;
}): PagedRows<T> {
  const pageCount = Math.max(1, Math.ceil(params.total / params.limit));

  return {
    canNext: params.hasNextPage && !params.isPending,
    canPrevious: params.hasPreviousPage && !params.isPending,
    end: params.items.length === 0 ? 0 : params.page * params.limit + params.items.length,
    items: params.items,
    next: params.next,
    page: params.page,
    pageCount,
    previous: params.previous,
    start: params.items.length === 0 ? 0 : params.page * params.limit + 1,
    total: params.total,
  };
}

const toErrorMessage = (caughtError: unknown): string => {
  if (caughtError instanceof ApiClientError) {
    if (caughtError.status === 401 || caughtError.status === 403) {
      return "当前频率不能使用后台。";
    }

    if (caughtError.code === "VALIDATION_ERROR") {
      const validationMessage = readProviderConfigValidationMessage(caughtError.details);

      if (validationMessage !== undefined) {
        return validationMessage;
      }

      return "后台操作参数不完整。";
    }
  }

  return "后台操作暂时没有完成。";
};

const readProviderConfigValidationMessage = (details: unknown): string | undefined => {
  if (typeof details !== "object" || details === null || Array.isArray(details)) {
    return undefined;
  }

  const fieldErrors = (details as Record<string, unknown>).fieldErrors;

  if (typeof fieldErrors !== "object" || fieldErrors === null || Array.isArray(fieldErrors)) {
    return undefined;
  }

  const priorityErrors = (fieldErrors as Record<string, unknown>).priority;

  if (
    Array.isArray(priorityErrors) &&
    priorityErrors.some((value) => typeof value === "string" && value.length > 0)
  ) {
    return "优先级必须在 1 到 999 之间。";
  }

  return undefined;
};

export function AdminDashboard({ data }: AdminDashboardProps) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<AdminSectionId>("overview");
  const [aiReviewSearch, setAiReviewSearch] = useState("");
  const [aiReviewStatusFilter, setAiReviewStatusFilter] = useState("all");
  const [reportSearch, setReportSearch] = useState("");
  const [reportTargetFilter, setReportTargetFilter] = useState("all");
  const [signalSearch, setSignalSearch] = useState("");
  const [signalStatusFilter, setSignalStatusFilter] = useState("all");
  const [signalPage, setSignalPage] = useState(data.signals);
  const [signalPageCursors, setSignalPageCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [signalPageIndex, setSignalPageIndex] = useState(0);
  const [signalPagePending, setSignalPagePending] = useState(false);
  const [seedSignalSearch, setSeedSignalSearch] = useState("");
  const [seedSignalPage, setSeedSignalPage] = useState(data.aiSignals);
  const [seedSignalPageCursors, setSeedSignalPageCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [seedSignalPageIndex, setSeedSignalPageIndex] = useState(0);
  const [seedSignalPagePending, setSeedSignalPagePending] = useState(false);
  const [state, setState] = useState<MutationState>({});
  const [providerDraftOverrides, setProviderDraftOverrides] = useState<
    Record<string, ProviderConfigDraft>
  >({});
  const [providerTestResults, setProviderTestResults] = useState<
    Record<string, AdminProviderConfigTestResult>
  >({});
  const serverProviderDrafts = toProviderDrafts(data.providerConfigs);
  const providerDrafts = {
    ...serverProviderDrafts,
    ...providerDraftOverrides,
  };
  const galaxyBacklog = signalPage.items.filter(
    (signal) =>
      signal.embedding.status === "missing" ||
      signal.galaxyPositionStatus === "missing" ||
      signal.audioStatus === "FAILED",
  );

  const runMutation = async (params: {
    action: () => Promise<void>;
    afterSuccess?: () => Promise<void> | void;
    key: string;
    success: string;
  }) => {
    setState({ pendingKey: params.key });

    try {
      await params.action();
      await params.afterSuccess?.();
      setState({ success: params.success });
      router.refresh();
    } catch (caughtError) {
      setState({ error: toErrorMessage(caughtError) });
    }
  };

  const fetchSignalPage = async (params: {
    cursor?: string;
    direction: "next" | "previous" | "reset";
    q?: string;
    status?: string;
  }) => {
    setSignalPagePending(true);

    try {
      const searchParams = new URLSearchParams();
      const status = params.status ?? signalStatusFilter;
      const q = params.q ?? signalSearch;

      if (params.cursor !== undefined) {
        searchParams.set("cursor", params.cursor);
      }

      if (status !== "all") {
        searchParams.set("status", status);
      }

      if (q.trim().length > 0) {
        searchParams.set("q", q.trim());
      }

      const query = searchParams.size === 0 ? "" : `?${searchParams.toString()}`;
      const result = await apiClient.get<{ signals: AdminSignalPage }>(
        `/api/admin/signals${query}`,
        {
          cache: "no-store",
        },
      );

      setSignalPage(result.signals);

      if (params.direction === "next") {
        setSignalPageCursors((currentCursors) => [
          ...currentCursors.slice(0, signalPageIndex + 1),
          params.cursor,
        ]);
        setSignalPageIndex((currentPage) => currentPage + 1);
      } else if (params.direction === "previous") {
        setSignalPageIndex((currentPage) => Math.max(currentPage - 1, 0));
      } else {
        setSignalPageCursors([undefined]);
        setSignalPageIndex(0);
      }
    } catch (caughtError) {
      setState({ error: toErrorMessage(caughtError) });
    } finally {
      setSignalPagePending(false);
    }
  };

  const fetchSeedSignalPage = async (params: {
    cursor?: string;
    direction: "next" | "previous" | "reset";
    q?: string;
  }) => {
    setSeedSignalPagePending(true);

    try {
      const searchParams = new URLSearchParams();
      const q = params.q ?? seedSignalSearch;

      searchParams.set("source", "ai_generated");

      if (params.cursor !== undefined) {
        searchParams.set("cursor", params.cursor);
      }

      if (q.trim().length > 0) {
        searchParams.set("q", q.trim());
      }

      const result = await apiClient.get<{ signals: SignalDetailPage }>(
        `/api/admin/ai-signals?${searchParams.toString()}`,
        {
          cache: "no-store",
        },
      );

      setSeedSignalPage(result.signals);

      if (params.direction === "next") {
        setSeedSignalPageCursors((currentCursors) => [
          ...currentCursors.slice(0, seedSignalPageIndex + 1),
          params.cursor,
        ]);
        setSeedSignalPageIndex((currentPage) => currentPage + 1);
      } else if (params.direction === "previous") {
        setSeedSignalPageIndex((currentPage) => Math.max(currentPage - 1, 0));
      } else {
        setSeedSignalPageCursors([undefined]);
        setSeedSignalPageIndex(0);
      }
    } catch (caughtError) {
      setState({ error: toErrorMessage(caughtError) });
    } finally {
      setSeedSignalPagePending(false);
    }
  };

  const updateSignalSearch = (value: string) => {
    setSignalSearch(value);
    void fetchSignalPage({
      direction: "reset",
      q: value,
    });
  };

  const updateSignalStatusFilter = (value: string) => {
    setSignalStatusFilter(value);
    void fetchSignalPage({
      direction: "reset",
      status: value,
    });
  };

  const updateSeedSignalSearch = (value: string) => {
    setSeedSignalSearch(value);
    void fetchSeedSignalPage({
      direction: "reset",
      q: value,
    });
  };

  const filteredReports = data.reports.filter((report) => {
    const isTargetMatched =
      reportTargetFilter === "all" || report.targetType === reportTargetFilter;

    return (
      isTargetMatched &&
      matchesSearch(
        [
          report.reporterFreqCode,
          report.targetType,
          report.targetId,
          report.reason,
          report.note,
          report.status,
        ],
        reportSearch,
      )
    );
  });
  const filteredAiReviews = data.aiReviews.filter((review) => {
    const isStatusMatched =
      aiReviewStatusFilter === "all" || review.status === aiReviewStatusFilter;

    return (
      isStatusMatched &&
      matchesSearch(
        [
          review.reviewType,
          review.status,
          review.provider,
          review.model,
          review.targetType,
          review.targetId,
          JSON.stringify(review.outputJson),
        ],
        aiReviewSearch,
      )
    );
  });
  const signalRows = toServerPagedRows({
    hasNextPage: signalPage.hasNextPage,
    hasPreviousPage: signalPageIndex > 0,
    isPending: signalPagePending,
    items: signalPage.items,
    limit: signalPage.limit,
    next: () => {
      void fetchSignalPage({
        cursor: signalPage.nextCursor,
        direction: "next",
      });
    },
    page: signalPageIndex,
    previous: () => {
      const previousCursor = signalPageCursors[Math.max(signalPageIndex - 1, 0)];
      void fetchSignalPage({
        cursor: previousCursor,
        direction: "previous",
      });
    },
    total: signalPage.total,
  });
  const reportRows = usePagedRows(filteredReports);
  const frequencyRows = usePagedRows(data.frequencies);
  const aiReviewRows = usePagedRows(filteredAiReviews);
  const galaxyRows = usePagedRows(galaxyBacklog);
  const aiSignalRows = toServerPagedRows({
    hasNextPage: seedSignalPage.hasNextPage,
    hasPreviousPage: seedSignalPageIndex > 0,
    isPending: seedSignalPagePending,
    items: seedSignalPage.items,
    limit: seedSignalPage.limit,
    next: () => {
      void fetchSeedSignalPage({
        cursor: seedSignalPage.nextCursor,
        direction: "next",
      });
    },
    page: seedSignalPageIndex,
    previous: () => {
      const previousCursor = seedSignalPageCursors[Math.max(seedSignalPageIndex - 1, 0)];
      void fetchSeedSignalPage({
        cursor: previousCursor,
        direction: "previous",
      });
    },
    total: seedSignalPage.total,
  });

  const runProviderTest = async (params: {
    action: () => Promise<AdminProviderConfigTestResult>;
    draftKey: string;
    key: string;
  }) => {
    setState({ pendingKey: params.key });

    try {
      const result = await params.action();
      setProviderTestResults((currentResults) => ({
        ...currentResults,
        [params.draftKey]: result,
      }));
      setState({
        success:
          result.status === "passed"
            ? `${providerKindLabels[result.kind]} 检测通过。`
            : `${providerKindLabels[result.kind]} 检测未通过。`,
      });
    } catch (caughtError) {
      setState({ error: toErrorMessage(caughtError) });
    }
  };

  const updateSignalStatus = (signalId: string, status: SignalStatus) => {
    return apiClient.patch<{ signal: AdminSignalRecord }, AdminSignalStatusUpdate>(
      `/api/admin/signals/${signalId}/status`,
      { status },
    );
  };

  const updateFrequencyStatus = (frequencyId: string, status: AdminUserStatus) => {
    return apiClient.patch<{ frequency: AdminFrequencyRecord }, AdminUserStatusUpdate>(
      `/api/admin/frequencies/${frequencyId}/status`,
      { status },
    );
  };

  const updateReport = (reportId: string, body: AdminReportResolution) => {
    return apiClient.patch<{ report: AdminReportRecord }, AdminReportResolution>(
      `/api/admin/reports/${reportId}`,
      body,
    );
  };

  const updateProviderDraft = (draftKey: string, patch: Partial<ProviderConfigDraft>) => {
    setProviderDraftOverrides((currentDrafts) => ({
      ...currentDrafts,
      [draftKey]: {
        ...providerDrafts[draftKey],
        ...patch,
      },
    }));
  };

  const createProviderConfig = (kind: AdminProviderConfigKind) => {
    const draftKey = `new:${kind}`;
    setProviderDraftOverrides((currentDrafts) => ({
      ...currentDrafts,
      [draftKey]: currentDrafts[draftKey] ?? createEmptyProviderDraft(kind),
    }));
  };

  const saveProviderConfig = (config: AdminProviderConfigRecord) => {
    const draftKey = getProviderDraftKey(config);
    const draft = providerDrafts[draftKey] ?? createEmptyProviderDraft(config.kind);
    const payload = buildProviderPayload(config.kind, draft);

    return runMutation({
      action: () =>
        config.id === undefined
          ? apiClient
              .post<{ providerConfig: AdminProviderConfigRecord }, AdminProviderConfigUpdate>(
                `/api/admin/provider-configs/${config.kind}`,
                payload,
              )
              .then(() => undefined)
          : apiClient
              .put<{ providerConfig: AdminProviderConfigRecord }, AdminProviderConfigUpdate>(
                `/api/admin/provider-configs/${config.kind}/${config.id}`,
                payload,
              )
              .then(() => undefined),
      key: `provider:${draftKey}:save`,
      success: `${providerKindLabels[config.kind]} 配置已保存。`,
    });
  };

  const addProviderConfig = (kind: AdminProviderConfigKind) => {
    const draftKey = `new:${kind}`;
    const draft = providerDrafts[draftKey] ?? createEmptyProviderDraft(kind);

    return runMutation({
      action: async () => {
        await apiClient.post<
          { providerConfig: AdminProviderConfigRecord },
          AdminProviderConfigUpdate
        >(`/api/admin/provider-configs/${kind}`, buildProviderPayload(kind, draft));
        setProviderDraftOverrides((currentDrafts) =>
          removeProviderDraftOverride(currentDrafts, draftKey),
        );
      },
      key: `provider:${draftKey}:add`,
      success: `${providerKindLabels[kind]} 备份已添加。`,
    });
  };

  const testProviderConfig = (
    kind: AdminProviderConfigKind,
    draftKey: string,
    config?: AdminProviderConfigRecord,
  ) => {
    const draft = providerDrafts[draftKey] ?? createEmptyProviderDraft(kind);
    const searchParams = new URLSearchParams();

    if (config?.id !== undefined) {
      searchParams.set("id", config.id);
    }

    if (config?.source === "environment") {
      searchParams.set("environment", "1");
    }

    const query = searchParams.size === 0 ? "" : `?${searchParams.toString()}`;

    return runProviderTest({
      action: () =>
        apiClient
          .post<AdminProviderConfigTestResponse, AdminProviderConfigUpdate>(
            `/api/admin/provider-configs/${kind}/test${query}`,
            buildProviderPayload(kind, draft),
          )
          .then((response) => response.result),
      draftKey,
      key: `provider:${draftKey}:test`,
    });
  };

  const deleteProviderConfig = (config: AdminProviderConfigRecord) => {
    if (config.id === undefined) {
      return;
    }

    void confirmAndDeleteProviderConfig({
      confirmDelete: window.confirm,
      deleteProviderConfig: () =>
        runMutation({
          action: () =>
            apiClient
              .delete<{ providerConfig: AdminProviderConfigRecord }>(
                `/api/admin/provider-configs/${config.kind}/${config.id}`,
              )
              .then(() => undefined),
          key: `provider:${config.id}:delete`,
          success: `${providerKindLabels[config.kind]} 配置已删除。`,
        }),
      target: {
        kindLabel: providerKindLabels[config.kind],
        model: config.model,
        provider: config.provider,
      },
    });
  };

  const generateAiSignals = () => {
    return runMutation({
      action: () =>
        apiClient
          .post<AdminGenerateSignalsResponse, { count: number }>(
            "/api/admin/ai-signals/generate",
            { count: 5 },
          )
          .then(() => undefined),
      afterSuccess: () => fetchSeedSignalPage({ direction: "reset" }),
      key: "ai-signals:generate",
      success: "候选信号已生成。",
    });
  };

  const updateSignalKept = (signal: SignalDetail, isKept: boolean) => {
    return runMutation({
      action: () =>
        apiClient
          .patch<{ signal: SignalDetail }, AdminKeepSignalUpdate>(
            `/api/admin/ai-signals/${signal.id}/keep`,
            { isKept },
          )
          .then(() => undefined),
      afterSuccess: () => fetchSeedSignalPage({ direction: "reset" }),
      key: `seed:${signal.id}:keep:${isKept}`,
      success: isKept ? "候选信号已保留。" : "候选信号已取消保留。",
    });
  };

  const deleteSeedSignal = (signal: SignalDetail) => {
    return runMutation({
      action: () =>
        apiClient
          .delete<{ signal: SignalDetail }>(`/api/admin/ai-signals/${signal.id}`)
          .then(() => undefined),
      afterSuccess: () => fetchSeedSignalPage({ direction: "reset" }),
      key: `seed:${signal.id}:delete`,
      success: "候选信号已删除。",
    });
  };

  const resolveReport = (report: AdminReportRecord, resolution: string) => {
    return updateReport(report.id, {
      resolution,
      status: "RESOLVED",
    });
  };

  const rejectReport = (report: AdminReportRecord) => {
    return runMutation({
      action: () =>
        updateReport(report.id, {
          resolution: "未采纳这次举报。",
          status: "REJECTED",
        }).then(() => undefined),
      key: `report:${report.id}:reject`,
      success: "举报已驳回。",
    });
  };

  const hideReportedSignal = (report: AdminReportRecord) => {
    return runMutation({
      action: async () => {
        await updateSignalStatus(report.targetId, "HIDDEN");
        await resolveReport(report, "已隐藏目标信号。");
      },
      key: `report:${report.id}:signal-hide`,
      success: "目标信号已隐藏。",
    });
  };

  const updateReportedFrequency = (report: AdminReportRecord, status: AdminUserStatus) => {
    return runMutation({
      action: async () => {
        await updateFrequencyStatus(report.targetId, status);
        await resolveReport(report, `已将目标频率调整为${userStatusLabels[status]}。`);
      },
      key: `report:${report.id}:frequency:${status}`,
      success: `目标频率已${userStatusLabels[status]}。`,
    });
  };

  const providerBackups = data.providerConfigs.filter(
    (config) => config.source === "database",
  ).length;
  const pendingOps =
    data.overview.reports.pending +
    data.overview.signals.reviewing +
    galaxyBacklog.length;
  const adminNavigationGroups: Array<{
    items: Array<{
      id: AdminSectionId;
      label: string;
      meta: string;
    }>;
    label: string;
  }> = [
    {
      label: "概览仪表盘",
      items: [
        {
          id: "overview",
          label: "总览",
          meta: "指标与核心状态",
        },
      ],
    },
    {
      label: "信号与频率管理",
      items: [
        {
          id: "signals",
          label: "信号管理",
          meta: `${signalRows.total} 条`,
        },
        {
          id: "frequencies",
          label: "频率管理",
          meta: `${frequencyRows.total} 条`,
        },
        {
          id: "seed-library",
          label: "种子库",
          meta: `${aiSignalRows.total} 条`,
        },
      ],
    },
    {
      label: "AI & Provider",
      items: [
        {
          id: "provider-configs",
          label: "Provider 配置",
          meta: `${providerBackups} 条后台配置`,
        },
        {
          id: "ai-observability",
          label: "AI 观测",
          meta: `${data.aiReviews.length} 条`,
        },
        {
          id: "ai-evaluation",
          label: "AI 实验评估",
          meta: `${data.evaluation.sampleSize.matching} 匹配样本`,
        },
      ],
    },
    {
      label: "运维与监控",
      items: [
        {
          id: "galaxy-ops",
          label: "星图运维",
          meta: `${galaxyBacklog.length} 条异常`,
        },
      ],
    },
    {
      label: "运营与举报",
      items: [
        {
          id: "operations",
          label: "运营处理",
          meta: `${pendingOps} 个待处理项`,
        },
        {
          id: "reports",
          label: "举报队列",
          meta: `${data.reports.length} 条`,
        },
      ],
    },
  ];
  const activeNavigationItem = adminNavigationGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === activeSection);

  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="radio-surface h-fit p-3 lg:sticky lg:top-28">
        <div className="grid gap-5">
          {adminNavigationGroups.map((group) => (
            <div className="grid gap-2" key={group.label}>
              <p className="px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--radio-dim)]">
                {group.label}
              </p>
              <div className="grid gap-1">
                {group.items.map((item) => (
                  <AdminNavButton
                    isActive={activeSection === item.id}
                    key={item.id}
                    label={item.label}
                    meta={item.meta}
                    onClick={() => setActiveSection(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="grid min-w-0 gap-5">
        <section className="radio-surface flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <p className="radio-kicker">ADMIN CONSOLE</p>
            <h2 className="mt-2 text-xl font-semibold text-[color:var(--radio-text)]">
              {activeNavigationItem?.label ?? "总览"}
            </h2>
            <p className="mt-1 text-sm text-[color:var(--radio-muted)]">
              {activeNavigationItem?.meta ?? "指标与核心状态"}
            </p>
          </div>
          <div className="grid gap-1 text-right font-mono text-xs text-[color:var(--radio-muted)]">
            <span>待处理 {pendingOps}</span>
            <span>后台配置 {providerBackups}</span>
          </div>
        </section>

        {state.error ? (
          <p className="radio-alert" role="alert">
            {state.error}
          </p>
        ) : null}

        {state.success ? (
          <p className="radio-alert" role="status">
            {state.success}
          </p>
        ) : null}

        <div className="grid min-w-0 gap-5">
          {activeSection === "overview" ? (
            <>
              <section aria-label="后台概览" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <MetricTile label="信号总数" value={data.overview.signals.total} />
                <MetricTile label="待处理举报" value={data.overview.reports.pending} />
                <MetricTile label="活跃频率" value={data.overview.frequencies.active} />
                <MetricTile label="AI fallback" value={data.overview.aiOperations.chatFallbacks} />
                <MetricTile label="TTS 失败" value={data.overview.aiOperations.ttsFailures} />
                <MetricTile label="坐标缺失" value={data.overview.galaxy.missingCoordinates} />
              </section>

              <section className="grid gap-3 md:grid-cols-4" id="ai-capabilities">
                <CapabilityTile label="Chat" status={data.overview.capabilities.chat} />
                <CapabilityTile label="Embedding" status={data.overview.capabilities.embedding} />
                <CapabilityTile label="Reranker" status={data.overview.capabilities.reranker} />
                <CapabilityTile label="TTS" status={data.overview.capabilities.tts} />
              </section>

              <section aria-label="后台分类" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <CategoryTile
                  copy={`${pendingOps} 个待处理项`}
                  onClick={() => setActiveSection("operations")}
                  title="运营处理"
                />
                <CategoryTile
                  copy={`${providerBackups} 条后台配置`}
                  onClick={() => setActiveSection("provider-configs")}
                  title="模型供应商"
                />
                <CategoryTile
                  copy={`${data.aiReviews.length} 条记录`}
                  onClick={() => setActiveSection("ai-observability")}
                  title="AI 观测"
                />
              </section>
            </>
          ) : null}

          {activeSection === "provider-configs" ? (
            <CollapsibleSection
              copy="密钥只允许写入或清空，当前值不会回显。保存后 API 立即使用后台配置。"
              marker="PV"
              sectionId="provider-configs"
              title="Provider 配置"
            >
              <ProviderConfigSection
                addProviderConfig={addProviderConfig}
                createProviderConfig={createProviderConfig}
                deleteProviderConfig={deleteProviderConfig}
                pendingKey={state.pendingKey}
                providerConfigs={data.providerConfigs}
                providerDrafts={providerDrafts}
                providerTestResults={providerTestResults}
                saveProviderConfig={saveProviderConfig}
                testProviderConfig={testProviderConfig}
                updateProviderDraft={updateProviderDraft}
              />
            </CollapsibleSection>
          ) : null}

          {activeSection === "operations" ? (
            <AdminOperationsSection
              galaxyTotal={galaxyRows.total}
              reportTotal={reportRows.total}
              setActiveSection={setActiveSection}
              signalTotal={signalRows.total}
            />
          ) : null}

          {activeSection === "signals" ? (
            <AdminSignalsSection
              pendingKey={state.pendingKey}
              refreshSignals={() => fetchSignalPage({ direction: "reset" })}
              rows={signalRows}
              runMutation={runMutation}
              search={signalSearch}
              setSearch={updateSignalSearch}
              setStatusFilter={updateSignalStatusFilter}
              statusFilter={signalStatusFilter}
              updateSignalStatus={updateSignalStatus}
            />
          ) : null}

          {activeSection === "reports" ? (
            <AdminReportsSection
              hideReportedSignal={hideReportedSignal}
              pendingKey={state.pendingKey}
              rejectReport={rejectReport}
              reportTargetFilter={reportTargetFilter}
              rows={reportRows}
              search={reportSearch}
              setReportTargetFilter={setReportTargetFilter}
              setSearch={setReportSearch}
              updateReportedFrequency={updateReportedFrequency}
            />
          ) : null}

          {activeSection === "frequencies" ? (
            <AdminFrequenciesSection
              pendingKey={state.pendingKey}
              rows={frequencyRows}
              runMutation={runMutation}
              updateFrequencyStatus={updateFrequencyStatus}
            />
          ) : null}

          {activeSection === "ai-observability" ? (
            <AdminAiObservabilitySection
              rows={aiReviewRows}
              search={aiReviewSearch}
              setSearch={setAiReviewSearch}
              setStatusFilter={setAiReviewStatusFilter}
              statusFilter={aiReviewStatusFilter}
            />
          ) : null}

          {activeSection === "galaxy-ops" ? <AdminGalaxyOpsSection rows={galaxyRows} /> : null}

          {activeSection === "seed-library" ? (
            <AdminSeedLibrarySection
              deleteSeedSignal={deleteSeedSignal}
              generateAiSignals={generateAiSignals}
              pendingKey={state.pendingKey}
              rows={aiSignalRows}
              search={seedSignalSearch}
              setSearch={updateSeedSignalSearch}
              updateSignalKept={updateSignalKept}
            />
          ) : null}

          {activeSection === "ai-evaluation" ? (
            <AdminAiEvaluationSection evaluation={data.evaluation} />
          ) : null}

        </div>
      </div>
    </div>
  );
}
