import Link from "next/link";
import { FrequencyLoginForm } from "@/components/radio/FrequencyLoginForm";
import { LogoutButton } from "@/components/radio/LogoutButton";
import { isApiUnavailableError } from "@/lib/api-client";
import { sanitizeAuthReturnPath } from "@/lib/auth-return-path";
import { getFrequencyCode } from "@/lib/frequency-data";
import { getCurrentFrequency } from "@/lib/current-frequency";
import type { FrequencyIdentity } from "@unfreq/contracts";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    returnTo?: string | string[];
  }>;
};

function LoggedInFrequencyPanel({ frequency }: { frequency: FrequencyIdentity }) {
  return (
    <section className="login-pane login-pane-primary grid gap-6 p-5 sm:p-6">
      <div className="grid gap-3">
        <p className="radio-kicker">CURRENT FREQUENCY</p>
        <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
          已接入你的 FM 频率
        </h1>
        <p className="text-sm leading-7 text-[color:var(--text-secondary)]">
          现在访问调频入口会保留当前频率。需要换一组 FM 时，先退出登录。
        </p>
      </div>

      <div>
        <p className="login-frequency-code">{getFrequencyCode(frequency)}</p>
        <p className="mt-3 font-mono text-xs text-[color:var(--text-tertiary)]">
          {frequency.role === "ADMIN" ? "ADMIN" : "USER"} · {frequency.status}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link className="radio-button-primary" href="/me">
          打开我的频率
        </Link>
        <Link className="radio-button-secondary" href="/">
          去发射 seed
        </Link>
        <LogoutButton />
      </div>
    </section>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnPath = sanitizeAuthReturnPath(params.returnTo);
  let frequency: FrequencyIdentity | undefined;
  let isApiUnavailable = false;

  try {
    frequency = await getCurrentFrequency();
  } catch (caughtError) {
    if (!isApiUnavailableError(caughtError)) {
      throw caughtError;
    }

    isApiUnavailable = true;
  }

  if (frequency !== undefined) {
    return (
      <section className="login-page">
        <LoggedInFrequencyPanel frequency={frequency} />
      </section>
    );
  }

  return (
    <section className="login-page">
      <p className="radio-kicker">调频登录</p>
      <h1 className="mt-4 text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
        接入你的 FM 频率
      </h1>
      <p className="mt-4 leading-7 text-[color:var(--text-secondary)]">
        新频率由系统随机分配。请保存你的 FM 和密码，它们是唯一登录凭据。
      </p>
      {isApiUnavailable ? (
        <p className="radio-alert mt-5" role="status">
          当前 API 没有响应。可以先留在这里，服务恢复后再接入 FM。
        </p>
      ) : null}
      <FrequencyLoginForm returnPath={returnPath} />
    </section>
  );
}
