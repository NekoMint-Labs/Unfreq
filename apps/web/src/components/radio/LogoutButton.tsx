"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClient } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);

  const logout = async () => {
    setIsPending(true);
    setErrorMessage(undefined);

    try {
      await apiClient.post<{ ok: boolean }, Record<string, never>>("/api/auth/logout", {});
      router.refresh();
      router.push("/login");
    } catch {
      setErrorMessage("退出失败。当前频率仍保持接入。");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <span className="logout-control">
      <button
        className="radio-button-secondary"
        disabled={isPending}
        onClick={logout}
        type="button"
      >
        {isPending ? "退出中" : "退出登录"}
      </button>
      {errorMessage !== undefined ? (
        <span className="logout-error" role="status">
          {errorMessage}
        </span>
      ) : null}
    </span>
  );
}
