import { RouteStatusPanel } from "@/components/layout/RouteStatusPanel";

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <RouteStatusPanel
        body="正在连接频率和信号数据。"
        kicker="正在调频"
        title="正在接收这一页。"
      >
        <div className="grid w-full gap-3 sm:grid-cols-3">
          <span className="h-11 animate-pulse rounded-[8px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated-2)]" />
          <span className="h-11 animate-pulse rounded-[8px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] sm:col-span-2" />
        </div>
      </RouteStatusPanel>
    </div>
  );
}
