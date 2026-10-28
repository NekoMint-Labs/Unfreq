import type { AdminReportRecord, AdminUserStatus } from "@unfreq/contracts/admin";
import { ActionButton } from "./admin-controls";
import {
  AdminTableToolbar,
  CategoryTile,
  CollapsibleSection,
  EmptyRow,
  excerpt,
  formatDateTime,
  type AdminSectionId,
  type PagedRows,
  PaginationControls,
  reportStatusLabels,
  reportTargetFilterOptions,
  shortId,
  targetTypeLabels,
  Td,
  Th,
} from "./admin-dashboard-shared";

export function AdminOperationsSection({
  galaxyTotal,
  reportTotal,
  setActiveSection,
  signalTotal,
}: {
  galaxyTotal: number;
  reportTotal: number;
  setActiveSection: (section: AdminSectionId) => void;
  signalTotal: number;
}) {
  return (
    <CollapsibleSection
      copy={`信号、扩写和生成状态。共 ${signalTotal} 条。`}
      marker="SG"
      sectionId="operations"
      title="运营处理"
    >
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[color:var(--radio-muted)]">
          举报、信号状态和星图异常集中在这里处理。左侧导航可以进入具体队列。
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <CategoryTile
            copy={`${reportTotal} 条待处理举报`}
            onClick={() => setActiveSection("reports")}
            title="处理举报"
          />
          <CategoryTile
            copy={`${signalTotal} 条信号记录`}
            onClick={() => setActiveSection("signals")}
            title="审查信号"
          />
          <CategoryTile
            copy={`${galaxyTotal} 条运维异常`}
            onClick={() => setActiveSection("galaxy-ops")}
            title="查看星图运维"
          />
        </div>
      </div>
    </CollapsibleSection>
  );
}

export function AdminReportsSection({
  hideReportedSignal,
  pendingKey,
  rejectReport,
  reportTargetFilter,
  rows,
  search,
  setReportTargetFilter,
  setSearch,
  updateReportedFrequency,
}: {
  hideReportedSignal: (report: AdminReportRecord) => Promise<void>;
  pendingKey?: string;
  rejectReport: (report: AdminReportRecord) => Promise<void>;
  reportTargetFilter: string;
  rows: PagedRows<AdminReportRecord>;
  search: string;
  setReportTargetFilter: (value: string) => void;
  setSearch: (value: string) => void;
  updateReportedFrequency: (
    report: AdminReportRecord,
    status: AdminUserStatus,
  ) => Promise<void>;
}) {
  return (
    <CollapsibleSection
      copy={`优先处理 SIGNAL 和频率目标。共 ${rows.total} 条。`}
      defaultOpen={rows.total > 0}
      marker="RP"
      sectionId="reports"
      title="举报队列"
    >
      <AdminTableToolbar
        filterLabel="目标"
        filterOptions={reportTargetFilterOptions}
        filterValue={reportTargetFilter}
        onFilterChange={setReportTargetFilter}
        onSearchChange={setSearch}
        searchPlaceholder="搜索来源、目标、原因或说明"
        searchValue={search}
      />
      <div className="overflow-x-auto radio-surface">
        <table className="min-w-[58rem] w-full border-collapse text-left text-sm">
          <thead className="border-b border-[color:var(--radio-border)] text-[color:var(--radio-dim)]">
            <tr>
              <Th>时间</Th>
              <Th>来源</Th>
              <Th>目标</Th>
              <Th>原因</Th>
              <Th>状态</Th>
              <Th>处理</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--radio-border)]">
            {rows.total > 0 ? (
              rows.items.map((report) => (
                <tr key={report.id}>
                  <Td>{formatDateTime(report.createdAt)}</Td>
                  <Td>
                    <span className="font-mono text-[color:var(--radio-text)]">
                      {report.reporterFreqCode}
                    </span>
                  </Td>
                  <Td>
                    <div className="grid gap-1">
                      <span>{targetTypeLabels[report.targetType]}</span>
                      <span className="font-mono text-xs text-[color:var(--radio-dim)]">
                        {shortId(report.targetId)}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <div className="max-w-xs leading-6">
                      <p>{report.reason}</p>
                      {report.note ? (
                        <p className="mt-1 text-[color:var(--radio-dim)]">
                          {excerpt(report.note, 48)}
                        </p>
                      ) : null}
                    </div>
                  </Td>
                  <Td>{reportStatusLabels[report.status]}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        disabled={pendingKey !== undefined}
                        isPending={pendingKey === `report:${report.id}:reject`}
                        label="驳回"
                        onClick={() => rejectReport(report)}
                      />
                      <ActionButton
                        disabled={report.targetType !== "SIGNAL" || pendingKey !== undefined}
                        isPending={pendingKey === `report:${report.id}:signal-hide`}
                        label="隐藏信号"
                        onClick={() => hideReportedSignal(report)}
                      />
                      <ActionButton
                        disabled={report.targetType !== "USER" || pendingKey !== undefined}
                        isPending={pendingKey === `report:${report.id}:frequency:MUTED`}
                        label="静音频率"
                        onClick={() => updateReportedFrequency(report, "MUTED")}
                      />
                      <ActionButton
                        disabled={report.targetType !== "USER" || pendingKey !== undefined}
                        isPending={pendingKey === `report:${report.id}:frequency:BANNED`}
                        label="封禁频率"
                        onClick={() => updateReportedFrequency(report, "BANNED")}
                      />
                    </div>
                  </Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={6} text="没有待处理举报。" />
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls rows={rows} />
    </CollapsibleSection>
  );
}
