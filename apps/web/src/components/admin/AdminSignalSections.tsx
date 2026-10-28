import type {
  AdminFrequencyRecord,
  AdminSignalRecord,
  AdminUserStatus,
} from "@unfreq/contracts/admin";
import type { SignalStatus } from "@unfreq/contracts";
import { ActionButton } from "./admin-controls";
import {
  AdminTableToolbar,
  audioStatusLabels,
  CollapsibleSection,
  EmptyRow,
  excerpt,
  formatDateTime,
  PaginationControls,
  type MutationRunner,
  type PagedRows,
  signalSourceLabels,
  signalStatusFilterOptions,
  signalStatusLabels,
  Td,
  Th,
  userStatusLabels,
} from "./admin-dashboard-shared";

export function AdminSignalsSection({
  pendingKey,
  rows,
  runMutation,
  search,
  refreshSignals,
  setSearch,
  setStatusFilter,
  statusFilter,
  updateSignalStatus,
}: {
  pendingKey?: string;
  rows: PagedRows<AdminSignalRecord>;
  runMutation: MutationRunner;
  search: string;
  refreshSignals: () => Promise<void> | void;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  statusFilter: string;
  updateSignalStatus: (
    signalId: string,
    status: SignalStatus,
  ) => Promise<{ signal: AdminSignalRecord }>;
}) {
  return (
    <CollapsibleSection
      copy={`信号、扩写和生成状态。共 ${rows.total} 条。`}
      marker="SG"
      sectionId="signals"
      title="信号管理"
    >
      <AdminTableToolbar
        filterLabel="状态"
        filterOptions={signalStatusFilterOptions}
        filterValue={statusFilter}
        onFilterChange={setStatusFilter}
        onSearchChange={setSearch}
        searchPlaceholder="搜索频率、种子、扩写或状态"
        searchValue={search}
      />
      <div className="overflow-x-auto radio-surface">
        <table className="min-w-[76rem] w-full border-collapse text-left text-sm">
          <thead className="border-b border-[color:var(--radio-border)] text-[color:var(--radio-dim)]">
            <tr>
              <Th>时间</Th>
              <Th>频率</Th>
              <Th>信号</Th>
              <Th>来源</Th>
              <Th>状态</Th>
              <Th>能力</Th>
              <Th>共鸣</Th>
              <Th>处理</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--radio-border)]">
            {rows.total > 0 ? (
              rows.items.map((signal) => (
                <tr key={signal.id}>
                  <Td>{formatDateTime(signal.createdAt)}</Td>
                  <Td>
                    <span className="font-mono text-[color:var(--radio-text)]">
                      {signal.frequencyCode ?? "-"}
                    </span>
                  </Td>
                  <Td>
                    <div className="max-w-xl leading-6">
                      <p className="text-[color:var(--radio-text)]">
                        {excerpt(signal.seedText, 72)}
                      </p>
                      <p className="mt-1 text-[color:var(--radio-dim)]">
                        {excerpt(signal.expandedText, 112)}
                      </p>
                    </div>
                  </Td>
                  <Td>{signalSourceLabels[signal.source]}</Td>
                  <Td>{signalStatusLabels[signal.status]}</Td>
                  <Td>
                    <div className="grid gap-1 text-xs">
                      <span>
                        embedding {signal.embedding.status === "ready" ? "已写入" : "缺失"}
                      </span>
                      <span>audio {audioStatusLabels[signal.audioStatus]}</span>
                      <span>
                        galaxy {signal.galaxyPositionStatus === "ready" ? "已定位" : "缺失"}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <span className="font-mono text-[color:var(--radio-text)]">
                      {signal.resonanceCount}
                    </span>
                  </Td>
                  <Td>
                    <SignalStatusActions
                      currentStatus={signal.status}
                      id={signal.id}
                      pendingKey={pendingKey}
                      runMutation={runMutation}
                      refreshSignals={refreshSignals}
                      updateSignalStatus={updateSignalStatus}
                    />
                  </Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={8} text="没有信号记录。" />
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls rows={rows} />
    </CollapsibleSection>
  );
}

export function AdminFrequenciesSection({
  pendingKey,
  rows,
  runMutation,
  updateFrequencyStatus,
}: {
  pendingKey?: string;
  rows: PagedRows<AdminFrequencyRecord>;
  runMutation: MutationRunner;
  updateFrequencyStatus: (
    frequencyId: string,
    status: AdminUserStatus,
  ) => Promise<{ frequency: AdminFrequencyRecord }>;
}) {
  return (
    <CollapsibleSection
      copy={`角色、状态和最近活跃时间。共 ${rows.total} 条。`}
      marker="FM"
      sectionId="frequencies"
      title="频率管理"
    >
      <div className="overflow-x-auto radio-surface">
        <table className="min-w-[56rem] w-full border-collapse text-left text-sm">
          <thead className="border-b border-[color:var(--radio-border)] text-[color:var(--radio-dim)]">
            <tr>
              <Th>接入时间</Th>
              <Th>频率</Th>
              <Th>角色</Th>
              <Th>最近活跃</Th>
              <Th>状态</Th>
              <Th>处理</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--radio-border)]">
            {rows.total > 0 ? (
              rows.items.map((frequency) => (
                <tr key={frequency.id}>
                  <Td>{formatDateTime(frequency.createdAt)}</Td>
                  <Td>
                    <span className="font-mono text-[color:var(--radio-text)]">
                      {frequency.code}
                    </span>
                  </Td>
                  <Td>{frequency.role === "ADMIN" ? "管理" : "普通"}</Td>
                  <Td>{frequency.lastSeenAt ? formatDateTime(frequency.lastSeenAt) : "-"}</Td>
                  <Td>{userStatusLabels[frequency.status]}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {(["ACTIVE", "MUTED", "BANNED"] as const).map((status) => (
                        <ActionButton
                          disabled={frequency.status === status || pendingKey !== undefined}
                          isPending={pendingKey === `frequency:${frequency.id}:${status}`}
                          key={status}
                          label={userStatusLabels[status]}
                          onClick={() =>
                            runMutation({
                              action: () =>
                                updateFrequencyStatus(frequency.id, status).then(
                                  () => undefined,
                                ),
                              key: `frequency:${frequency.id}:${status}`,
                              success: `频率已调整为${userStatusLabels[status]}。`,
                            })
                          }
                        />
                      ))}
                    </div>
                  </Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={6} text="没有频率记录。" />
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls rows={rows} />
    </CollapsibleSection>
  );
}

export function AdminGalaxyOpsSection({ rows }: { rows: PagedRows<AdminSignalRecord> }) {
  return (
    <CollapsibleSection
      copy={`embedding、坐标和音频异常。共 ${rows.total} 条。`}
      marker="GX"
      sectionId="galaxy-ops"
      title="星图运维"
    >
      <div className="overflow-x-auto radio-surface">
        <table className="min-w-[58rem] w-full border-collapse text-left text-sm">
          <thead className="border-b border-[color:var(--radio-border)] text-[color:var(--radio-dim)]">
            <tr>
              <Th>时间</Th>
              <Th>频率</Th>
              <Th>信号</Th>
              <Th>Embedding</Th>
              <Th>坐标</Th>
              <Th>音频</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--radio-border)]">
            {rows.total > 0 ? (
              rows.items.map((signal) => (
                <tr key={signal.id}>
                  <Td>{formatDateTime(signal.createdAt)}</Td>
                  <Td>
                    <span className="font-mono text-[color:var(--radio-text)]">
                      {signal.frequencyCode ?? "-"}
                    </span>
                  </Td>
                  <Td>{excerpt(signal.expandedText, 96)}</Td>
                  <Td>
                    {signal.embedding.status === "ready"
                      ? `${signal.embedding.provider ?? "-"} ${signal.embedding.version ?? ""}`
                      : "缺失"}
                  </Td>
                  <Td>{signal.galaxyPositionStatus === "ready" ? "已定位" : "缺失"}</Td>
                  <Td>{audioStatusLabels[signal.audioStatus]}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={6} text="没有运维待处理项。" />
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls rows={rows} />
    </CollapsibleSection>
  );
}

function SignalStatusActions({
  currentStatus,
  id,
  pendingKey,
  refreshSignals,
  runMutation,
  updateSignalStatus,
}: {
  currentStatus: SignalStatus;
  id: string;
  pendingKey?: string;
  refreshSignals: () => Promise<void> | void;
  runMutation: MutationRunner;
  updateSignalStatus: (
    signalId: string,
    status: SignalStatus,
  ) => Promise<{ signal: AdminSignalRecord }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(["PUBLISHED", "REVIEWING", "HIDDEN", "DELETED"] as const).map((status) => (
        <ActionButton
          disabled={currentStatus === status || pendingKey !== undefined}
          isPending={pendingKey === `signal:${id}:${status}`}
          key={status}
          label={signalStatusLabels[status]}
          onClick={() =>
            runMutation({
              action: () => updateSignalStatus(id, status).then(() => undefined),
              afterSuccess: refreshSignals,
              key: `signal:${id}:${status}`,
              success: `信号已调整为${signalStatusLabels[status]}。`,
            })
          }
        />
      ))}
    </div>
  );
}
