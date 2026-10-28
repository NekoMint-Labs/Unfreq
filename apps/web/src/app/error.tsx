"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RouteStatusPanel } from "@/components/layout/RouteStatusPanel";
import { reportFrontendError } from "@/lib/frontend-diagnostics";

type RouteErrorProps = {
  error: Error & {
    digest?: string;
  };
  reset: () => void;
};

export default function RouteError({ error, reset }: RouteErrorProps) {
  useEffect(() => {
    void reportFrontendError("route-error", error, {
      digest: error.digest,
    });
  }, [error]);

  return (
    <RouteStatusPanel
      body="刚才的页面没有完整加载。可以重新尝试，或先回到发射入口。"
      kicker="信号中断"
      title="这一页暂时没有接上。"
    >
      <button className="radio-button-primary" onClick={reset} type="button">
        重新尝试
      </button>
      <Link className="radio-button-secondary" href="/">
        回到发射
      </Link>
    </RouteStatusPanel>
  );
}
