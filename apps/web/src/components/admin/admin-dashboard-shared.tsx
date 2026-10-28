import type { ReactNode } from "react";
import { useState } from "react";
import type {
  AdminAiEvaluationGroup,
  AdminCapabilityStatus,
  AdminReportRecord,
  AdminReportStatus,
  AdminSignalRecord,
  AdminUserStatus,
} from "@unfreq/contracts/admin";
import type { SignalDetail, SignalStatus } from "@unfreq/contracts";
import { ActionButton } from "./admin-controls";

export type AdminSectionId =
  | "overview"
  | "provider-configs"
  | "operations"
  | "signals"
  | "reports"
  | "frequencies"
  | "ai-observability"
  | "galaxy-ops"
  | "seed-library"
  | "ai-evaluation";

export type MutationState = {
  error?: string;
  pendingKey?: string;
  success?: string;
};

export type MutationRunner = (params: {
  action: () => Promise<void>;
  afterSuccess?: () => Promise<void> | void;
  key: string;
  success: string;
}) => Promise<void>;

export type FilterOption = {
  label: string;
  value: string;
};

export type PagedRows<T> = {
  canNext: boolean;
  canPrevious: boolean;
  end: number;
  items: T[];
  next: () => void;
  page: number;
  pageCount: number;
  previous: () => void;
  start: number;
  total: number;
};

export const adminTablePageSize = 8;

export const signalStatusLabels: Record<SignalStatus, string> = {
  DELETED: "已删除",
  DRAFT: "草稿",
  HIDDEN: "已隐藏",
  PUBLISHED: "公开",
  REVIEWING: "待审核",
};

export const userStatusLabels: Record<AdminUserStatus, string> = {
  ACTIVE: "正常",
  BANNED: "封禁",
  MUTED: "静音",
};

export const reportStatusLabels: Record<AdminReportStatus, string> = {
  PENDING: "待处理",
  REJECTED: "已驳回",
  RESOLVED: "已处理",
};

export const targetTypeLabels: Record<AdminReportRecord["targetType"], string> = {
  SIGNAL: "信号",
  USER: "频率",
};

export const signalSourceLabels: Record<SignalDetail["source"], string> = {
  ai_generated: "AI 生成",
  human: "真人",
  seed: "种子",
};

export const audioStatusLabels: Record<AdminSignalRecord["audioStatus"], string> = {
  FAILED: "失败",
  NOT_REQUESTED: "未请求",
  PENDING: "生成中",
  READY: "已就绪",
};

export const capabilityLabels: Record<AdminCapabilityStatus, string> = {
  configured: "可用",
  degraded: "降级",
  disabled: "关闭",
};

export const signalStatusFilterOptions: FilterOption[] = [
  { label: "全部状态", value: "all" },
  { label: signalStatusLabels.PUBLISHED, value: "PUBLISHED" },
  { label: signalStatusLabels.REVIEWING, value: "REVIEWING" },
  { label: signalStatusLabels.HIDDEN, value: "HIDDEN" },
  { label: signalStatusLabels.DELETED, value: "DELETED" },
  { label: signalStatusLabels.DRAFT, value: "DRAFT" },
];

export const reportTargetFilterOptions: FilterOption[] = [
  { label: "全部目标", value: "all" },
  { label: targetTypeLabels.SIGNAL, value: "SIGNAL" },
  { label: targetTypeLabels.USER, value: "USER" },
];

export const aiReviewStatusFilterOptions: FilterOption[] = [
  { label: "全部状态", value: "all" },
  { label: "SUCCEEDED", value: "SUCCEEDED" },
  { label: "FALLBACK", value: "FALLBACK" },
];

export const formatDateTime = (value: string): string => {
  return new Date(value).toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
};

export const shortId = (value: string): string => value.slice(0, 8);

export const excerpt = (value: string, maxLength = 72): string => {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

export const matchesSearch = (
  values: Array<number | string | null | undefined>,
  query: string,
): boolean => {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return true;
  }

  return values.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
};

export function usePagedRows<T>(items: T[], pageSize = adminTablePageSize): PagedRows<T> {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Math.min(page, pageCount - 1);
  const start = normalizedPage * pageSize;
  const end = Math.min(start + pageSize, items.length);

  return {
    canNext: normalizedPage < pageCount - 1,
    canPrevious: normalizedPage > 0,
    end,
    items: items.slice(start, end),
    next: () => setPage(Math.min(normalizedPage + 1, pageCount - 1)),
    page: normalizedPage,
    pageCount,
    previous: () => setPage(Math.max(normalizedPage - 1, 0)),
    start: items.length === 0 ? 0 : start + 1,
    total: items.length,
  };
}

export function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="radio-surface p-4">
      <p className="text-sm text-[color:var(--radio-dim)]">{label}</p>
      <p className="mt-2 font-mono text-2xl text-[color:var(--radio-text)]">{value}</p>
    </div>
  );
}

export function CapabilityTile({
  label,
  status,
}: {
  label: string;
  status: AdminCapabilityStatus;
}) {
  return (
    <div className="radio-surface flex items-center justify-between gap-3 p-4">
      <span className="text-sm text-[color:var(--radio-muted)]">{label}</span>
      <span className="rounded-[8px] border border-[color:var(--radio-border)] px-2 py-1 text-xs text-[color:var(--radio-text)]">
        {capabilityLabels[status]}
      </span>
    </div>
  );
}

export function CategoryTile({
  copy,
  onClick,
  title,
}: {
  copy: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className="radio-surface grid gap-2 p-4 text-left transition hover:border-white/25 hover:bg-white/[0.04]"
      onClick={onClick}
      type="button"
    >
      <span className="text-sm font-semibold text-[color:var(--radio-text)]">{title}</span>
      <span className="text-sm text-[color:var(--radio-muted)]">{copy}</span>
    </button>
  );
}

export function AdminNavButton({
  isActive,
  label,
  meta,
  onClick,
}: {
  isActive: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={isActive ? "page" : undefined}
      className={`grid gap-1 rounded-[6px] border px-3 py-2 text-left transition ${
        isActive
          ? "border-white/18 bg-white/[0.07] text-[color:var(--radio-text)]"
          : "border-transparent text-[color:var(--radio-muted)] hover:border-white/10 hover:bg-white/[0.035] hover:text-[color:var(--radio-text)]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--radio-dim)]">
        {meta}
      </span>
    </button>
  );
}

export function AdminTableToolbar({
  filterLabel,
  filterOptions,
  filterValue,
  onFilterChange,
  onSearchChange,
  searchPlaceholder,
  searchValue,
}: {
  filterLabel: string;
  filterOptions: FilterOption[];
  filterValue: string;
  onFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchValue: string;
}) {
  return (
    <div className="radio-surface grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_13rem]">
      <label className="grid gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--radio-dim)]">
          SEARCH
        </span>
        <input
          className="radio-field min-h-11"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          value={searchValue}
        />
      </label>
      <label className="grid gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--radio-dim)]">
          {filterLabel}
        </span>
        <select
          className="radio-field min-h-11"
          onChange={(event) => onFilterChange(event.target.value)}
          value={filterValue}
        >
          {filterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function EvaluationGroupCard({ group }: { group: AdminAiEvaluationGroup }) {
  return (
    <div className="radio-surface p-4">
      <p className="text-sm font-semibold text-[color:var(--radio-text)]">{group.label}</p>
      <dl className="mt-4 grid gap-3">
        {group.metrics.map((metric) => (
          <div className="grid gap-1" key={metric.key}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-[color:var(--radio-muted)]">{metric.label}</dt>
              <dd className="font-mono text-lg text-[color:var(--radio-text)]">
                {metric.value.toFixed(1)}%
              </dd>
            </div>
            <p className="text-xs leading-5 text-[color:var(--radio-dim)]">
              {metric.description}
            </p>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CollapsibleSection({
  action,
  children,
  copy,
  marker,
  sectionId,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  copy: string;
  defaultOpen?: boolean;
  marker: string;
  sectionId: string;
  title: string;
}) {
  return (
    <section className="radio-surface grid gap-4 p-4 sm:p-5" id={sectionId}>
      <SectionHeader action={action} copy={copy} marker={marker} title={title} />
      {children}
    </section>
  );
}

export function SectionHeader({
  action,
  copy,
  marker,
  title,
}: {
  action?: ReactNode;
  copy: string;
  marker: string;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="radio-kicker">{marker}</p>
        <h2 className="mt-2 text-xl font-semibold">{title}</h2>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="max-w-md text-sm leading-6 text-[color:var(--radio-muted)]">{copy}</p>
        {action}
      </div>
    </div>
  );
}

export function PaginationControls<T>({ rows }: { rows: PagedRows<T> }) {
  if (rows.pageCount <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[color:var(--radio-muted)]">
      <span className="font-mono">
        {rows.start}-{rows.end} / {rows.total}
      </span>
      <div className="flex gap-2">
        <ActionButton
          disabled={!rows.canPrevious}
          isPending={false}
          label="上一页"
          onClick={rows.previous}
        />
        <span className="inline-flex min-h-9 items-center px-2 font-mono text-[color:var(--radio-dim)]">
          {rows.page + 1} / {rows.pageCount}
        </span>
        <ActionButton
          disabled={!rows.canNext}
          isPending={false}
          label="下一页"
          onClick={rows.next}
        />
      </div>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>;
}

export function Td({ children }: { children: ReactNode }) {
  return <td className="align-top px-4 py-4 text-[color:var(--radio-muted)]">{children}</td>;
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td className="px-4 py-6 text-sm text-[color:var(--radio-muted)]" colSpan={colSpan}>
        {text}
      </td>
    </tr>
  );
}
