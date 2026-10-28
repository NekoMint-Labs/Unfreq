import Link from "next/link";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { ApiClientError } from "@/lib/api-client";
import { getAdminDashboardData } from "@/lib/admin-data";
import { getCurrentFrequency } from "@/lib/current-frequency";
import type { AdminDashboardData } from "@unfreq/contracts/admin";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminPageContent />;
}

async function AdminPageContent() {
  const frequency = await getCurrentFrequency();

  if (frequency === undefined) {
    return (
      <section className="max-w-2xl">
        <p className="radio-kicker">管理后台</p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
          先调频，再进入后台。
        </h1>
        <p className="mt-4 leading-7 text-[color:var(--radio-muted)]">
          只有管理频率能处理举报、信号状态和频率状态。
        </p>
        <Link className="radio-button-primary mt-8" href="/login">
          去调频
        </Link>
      </section>
    );
  }

  if (frequency.role !== "ADMIN") {
    return (
      <section className="max-w-2xl">
        <p className="radio-kicker">管理后台</p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
          当前频率不能使用后台。
        </h1>
        <p className="mt-4 leading-7 text-[color:var(--radio-muted)]">
          后台入口只对管理频率开放。
        </p>
      </section>
    );
  }

  let data: AdminDashboardData | undefined;
  let apiRejected = false;

  try {
    data = await getAdminDashboardData();
  } catch (caughtError) {
    if (
      caughtError instanceof ApiClientError &&
      (caughtError.status === 401 || caughtError.status === 403)
    ) {
      apiRejected = true;
    } else {
      throw caughtError;
    }
  }

  if (apiRejected || data === undefined) {
    return (
      <section className="max-w-2xl">
        <p className="radio-kicker">管理后台</p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
          当前频率不能使用后台。
        </h1>
        <p className="mt-4 leading-7 text-[color:var(--radio-muted)]">
          后台接口拒绝了这次访问。
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="radio-kicker">管理后台</p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
            治理控制台
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[color:var(--radio-muted)]">
            处理举报、信号状态、频率状态和 AI 审核记录。
          </p>
        </div>
        <span className="radio-surface inline-flex min-h-10 items-center px-3 py-2 font-mono text-sm tracking-[0.16em] text-[color:var(--radio-text)]">
          {frequency.freqCode}
        </span>
      </div>
      <AdminDashboard data={data} />
    </section>
  );
}
