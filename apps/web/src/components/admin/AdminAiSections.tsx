import type { AdminAiReviewRecord, AdminDashboardData } from "@unfreq/contracts/admin";
import type { SignalDetail } from "@unfreq/contracts";
import { ActionButton } from "./admin-controls";
import {
  AdminTableToolbar,
  aiReviewStatusFilterOptions,
  CollapsibleSection,
  EmptyRow,
  EvaluationGroupCard,
  excerpt,
  formatDateTime,
  PaginationControls,
  type PagedRows,
  shortId,
  signalSourceLabels,
  Td,
  Th,
} from "./admin-dashboard-shared";

export function AdminAiObservabilitySection({
  rows,
  search,
  setSearch,
  setStatusFilter,
  statusFilter,
}: {
  rows: PagedRows<AdminAiReviewRecord>;
  search: string;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  statusFilter: string;
}) {
  const reviewJson = (review: AdminAiReviewRecord): string => {
    return excerpt(JSON.stringify(review.outputJson), 96);
  };

  return (
    <CollapsibleSection
      copy={`provider、model 和最近记录。共 ${rows.total} 条。`}
      marker="AI"
      sectionId="ai-observability"
      title="AI 观测"
    >
      <AdminTableToolbar
        filterLabel="状态"
        filterOptions={aiReviewStatusFilterOptions}
        filterValue={statusFilter}
        onFilterChange={setStatusFilter}
        onSearchChange={setSearch}
        searchPlaceholder="搜索 provider、model、类型或目标"
        searchValue={search}
      />
      <div className="overflow-x-auto radio-surface">
        <table className="min-w-[58rem] w-full border-collapse text-left text-sm">
          <thead className="border-b border-[color:var(--radio-border)] text-[color:var(--radio-dim)]">
            <tr>
              <Th>时间</Th>
              <Th>类型</Th>
              <Th>状态</Th>
              <Th>模型</Th>
              <Th>目标</Th>
              <Th>结果</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--radio-border)]">
            {rows.total > 0 ? (
              rows.items.map((review) => (
                <tr key={review.id}>
                  <Td>{formatDateTime(review.createdAt)}</Td>
                  <Td>{review.reviewType}</Td>
                  <Td>{review.status}</Td>
                  <Td>
                    <span className="font-mono text-xs text-[color:var(--radio-muted)]">
                      {review.provider}/{review.model}
                    </span>
                  </Td>
                  <Td>
                    {review.targetType && review.targetId ? (
                      <span className="font-mono text-xs text-[color:var(--radio-muted)]">
                        {review.targetType}:{shortId(review.targetId)}
                      </span>
                    ) : (
                      <span className="text-[color:var(--radio-dim)]">未绑定</span>
                    )}
                  </Td>
                  <Td>
                    <span className="block max-w-md leading-6 text-[color:var(--radio-muted)]">
                      {reviewJson(review)}
                    </span>
                  </Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={6} text="没有 AI 观测记录。" />
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls rows={rows} />
    </CollapsibleSection>
  );
}

export function AdminSeedLibrarySection({
  deleteSeedSignal,
  generateAiSignals,
  pendingKey,
  rows,
  search,
  setSearch,
  updateSignalKept,
}: {
  deleteSeedSignal: (signal: SignalDetail) => Promise<void>;
  generateAiSignals: () => Promise<void>;
  pendingKey?: string;
  rows: PagedRows<SignalDetail>;
  search: string;
  setSearch: (value: string) => void;
  updateSignalKept: (signal: SignalDetail, isKept: boolean) => Promise<void>;
}) {
  return (
    <CollapsibleSection
      action={
        <ActionButton
          disabled={pendingKey !== undefined}
          isPending={pendingKey === "ai-signals:generate"}
          label="生成 5 条"
          onClick={generateAiSignals}
        />
      }
      copy={`候选、质量分和保留状态。共 ${rows.total} 条。`}
      marker="SD"
      sectionId="seed-library"
      title="种子库"
    >
      <div className="radio-surface grid gap-3 p-3">
        <label className="grid gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--radio-dim)]">
            SEARCH
          </span>
          <input
            className="radio-field min-h-11"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索种子、扩写或频率"
            value={search}
          />
        </label>
      </div>
      <div className="overflow-x-auto radio-surface">
        <table className="min-w-[68rem] w-full border-collapse text-left text-sm">
          <thead className="border-b border-[color:var(--radio-border)] text-[color:var(--radio-dim)]">
            <tr>
              <Th>时间</Th>
              <Th>来源</Th>
              <Th>频率</Th>
              <Th>候选</Th>
              <Th>质量</Th>
              <Th>互动</Th>
              <Th>处理</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--radio-border)]">
            {rows.total > 0 ? (
              rows.items.map((signal) => (
                <tr key={signal.id}>
                  <Td>{formatDateTime(signal.createdAt)}</Td>
                  <Td>{signalSourceLabels[signal.source]}</Td>
                  <Td>
                    <span className="font-mono text-[color:var(--radio-text)]">
                      {signal.fingerprint.frequency}
                    </span>
                  </Td>
                  <Td>
                    <div className="max-w-md leading-6">
                      <p>{excerpt(signal.seedText, 84)}</p>
                      <p className="mt-1 text-[color:var(--radio-dim)]">
                        {excerpt(signal.expandedText, 84)}
                      </p>
                    </div>
                  </Td>
                  <Td>
                    <div className="grid gap-1">
                      <span>{signal.qualityScore ?? "-"}/5</span>
                      {signal.qualityReason ? (
                        <span className="max-w-xs text-xs leading-5 text-[color:var(--radio-dim)]">
                          {excerpt(signal.qualityReason, 42)}
                        </span>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-[color:var(--radio-dim)]">
                      共鸣 {signal.resonanceCount} · 回响 {signal.echoCount}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        disabled={pendingKey !== undefined}
                        isPending={pendingKey === `seed:${signal.id}:keep:${!signal.isKept}`}
                        label={signal.isKept ? "取消保留" : "保留"}
                        onClick={() => updateSignalKept(signal, !signal.isKept)}
                      />
                      <ActionButton
                        disabled={pendingKey !== undefined || signal.status === "DELETED"}
                        isPending={pendingKey === `seed:${signal.id}:delete`}
                        label="删除"
                        onClick={() => deleteSeedSignal(signal)}
                      />
                    </div>
                  </Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7} text="没有候选信号。" />
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls rows={rows} />
    </CollapsibleSection>
  );
}

export function AdminAiEvaluationSection({
  evaluation,
}: {
  evaluation: AdminDashboardData["evaluation"];
}) {
  return (
    <CollapsibleSection
      copy={`样本：分类 ${evaluation.sampleSize.classification}，标签 ${evaluation.sampleSize.tags}，审核 ${evaluation.sampleSize.moderation}，匹配 ${evaluation.sampleSize.matching}。`}
      marker="EV"
      sectionId="ai-evaluation"
      title="AI 实验评估"
    >
      <div className="grid gap-3 lg:grid-cols-3">
        {evaluation.groups.map((group) => (
          <EvaluationGroupCard group={group} key={group.method} />
        ))}
      </div>
    </CollapsibleSection>
  );
}
