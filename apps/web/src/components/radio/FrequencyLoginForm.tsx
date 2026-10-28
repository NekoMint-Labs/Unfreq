"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import { apiClient } from "@/lib/api-client";
import { getAuthSuccessPath, sanitizeAuthReturnPath } from "@/lib/auth-return-path";
import type { LoginResponse } from "@unfreq/contracts";
import {
  type FrequencyCopyStatus,
  type FrequencyLoginErrorState,
  getFrequencyCopyStatusMessage,
  isFrequencyClipboardAvailable,
  toFrequencyLoginErrorMessage,
} from "./frequency-login-state";

const subscribeToClipboardAvailability = () => {
  return () => {};
};

const getClipboardAvailability = () => {
  return (
    typeof navigator !== "undefined" && isFrequencyClipboardAvailable(navigator.clipboard)
  );
};

const getServerClipboardAvailability = () => false;

type FrequencyLoginFormProps = {
  returnPath?: string;
};

export function FrequencyLoginForm({ returnPath }: FrequencyLoginFormProps) {
  const router = useRouter();
  const safeReturnPath = sanitizeAuthReturnPath(returnPath);
  const loginSuccessPath = getAuthSuccessPath(safeReturnPath, "login");
  const registrationSuccessPath = getAuthSuccessPath(safeReturnPath, "registration");
  const [error, setError] = useState<FrequencyLoginErrorState | undefined>();
  const [registeredFrequencyCode, setRegisteredFrequencyCode] = useState<
    string | undefined
  >();
  const [copyStatus, setCopyStatus] = useState<FrequencyCopyStatus>("idle");
  const [loginFrequencyCode, setLoginFrequencyCode] = useState("");
  const [isLoginPending, setIsLoginPending] = useState(false);
  const [isRegisterPending, setIsRegisterPending] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const copyStatusMessage = getFrequencyCopyStatusMessage(copyStatus);
  const canCopyFrequency = useSyncExternalStore(
    subscribeToClipboardAvailability,
    getClipboardAvailability,
    getServerClipboardAvailability,
  );

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setRegisteredFrequencyCode(undefined);
    setCopyStatus("idle");
    setIsRegisterPending(true);

    try {
      const result = await apiClient.post<LoginResponse, { password: string }>(
        "/api/auth/register",
        { password: registerPassword },
      );

      setRegisteredFrequencyCode(result.frequency.freqCode);
      setRegisterPassword("");
    } catch (caughtError) {
      setError({
        message: toFrequencyLoginErrorMessage(caughtError),
        source: "register",
      });
    } finally {
      setIsRegisterPending(false);
    }
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setRegisteredFrequencyCode(undefined);
    setIsLoginPending(true);

    try {
      await apiClient.post<LoginResponse, { frequencyCode: string; password: string }>(
        "/api/auth/frequency/login",
        {
          frequencyCode: loginFrequencyCode,
          password: loginPassword,
        },
      );

      router.refresh();
      router.push(loginSuccessPath);
    } catch (caughtError) {
      setError({
        message: toFrequencyLoginErrorMessage(caughtError),
        source: "login",
      });
    } finally {
      setIsLoginPending(false);
    }
  };

  const copyAssignedFrequency = async () => {
    if (registeredFrequencyCode === undefined) {
      return;
    }

    if (!isFrequencyClipboardAvailable(navigator.clipboard)) {
      setCopyStatus("unavailable");
      return;
    }

    try {
      await navigator.clipboard.writeText(registeredFrequencyCode);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  const continueAfterRegistration = () => {
    router.push(registrationSuccessPath);
    router.refresh();
  };

  return (
    <div className="login-form-stack">
      <form className="login-pane login-pane-primary grid gap-5 p-5 sm:p-6" onSubmit={register}>
        <div>
          <p className="radio-kicker">NEW FREQUENCY</p>
          <h2 className="mt-3 text-xl font-semibold text-[color:var(--text-primary)]">
            创建我的 FM 频率
          </h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
            先设置密码。系统会随机分配一个 FM。请立刻保存 FM 和密码。
          </p>
        </div>

        <label className="grid gap-2 text-sm font-medium" htmlFor="registerPassword">
          设置密码
          <input
            autoComplete="new-password"
            className="radio-field"
            id="registerPassword"
            minLength={8}
            name="registerPassword"
            onChange={(event) => {
              setRegisterPassword(event.target.value);
              setError(undefined);
              setCopyStatus("idle");
            }}
            placeholder="至少 8 位"
            required
            type="password"
            value={registerPassword}
          />
        </label>

        {registeredFrequencyCode === undefined ? (
          <button
            className="radio-button-primary login-primary-action min-h-12 w-full text-sm"
            disabled={isRegisterPending}
            type="submit"
          >
            {isRegisterPending ? "正在创建" : "创建我的 FM 频率"}
          </button>
        ) : null}

        {error?.source === "register" ? (
          <p className="radio-alert" role="alert">
            {error.message}
          </p>
        ) : null}

        {registeredFrequencyCode ? (
          <div className="login-frequency-result" role="status">
            <p className="radio-kicker">ASSIGNED FREQUENCY</p>
            <p className="login-frequency-code">{registeredFrequencyCode}</p>
            <p className="text-sm leading-6 text-[color:var(--text-secondary)]">
              这就是你的唯一 FM。先保存它和刚才设置的密码，再进入频率引导。
            </p>
            <div className="flex flex-wrap gap-3">
              {canCopyFrequency ? (
                <button
                  className="radio-button-secondary"
                  onClick={copyAssignedFrequency}
                  type="button"
                >
                  复制 FM
                </button>
              ) : null}
              <button
                className="radio-button-primary"
                onClick={continueAfterRegistration}
                type="button"
              >
                {safeReturnPath === undefined ? "进入我的频率" : "继续原来的操作"}
              </button>
            </div>
            {copyStatusMessage ? (
              <p
                className="text-sm leading-6 text-[color:var(--text-secondary)]"
                role={copyStatus === "failed" ? "alert" : "status"}
              >
                {copyStatusMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </form>

      <form className="login-pane login-pane-form grid gap-5 p-5 sm:p-6" onSubmit={login}>
        <div>
          <p className="radio-kicker">RETURNING FREQUENCY</p>
          <h2 className="mt-3 text-lg font-semibold text-[color:var(--text-primary)]">
            已有 FM，直接登录
          </h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
            输入你的 FM 和密码。格式示例：FM 10.01。
          </p>
        </div>

        <label className="grid gap-2 text-sm font-medium" htmlFor="frequencyCode">
          FM
          <input
            autoComplete="username"
            className="radio-field"
            id="frequencyCode"
            name="frequencyCode"
            onChange={(event) => {
              setLoginFrequencyCode(event.target.value);
              setError(undefined);
            }}
            pattern="FM[ -]?[0-9]{2}\\.[0-9]{2}"
            placeholder="FM 10.01"
            required
            type="text"
            value={loginFrequencyCode}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium" htmlFor="password">
          密码
          <input
            autoComplete="current-password"
            className="radio-field"
            id="password"
            minLength={8}
            name="password"
            onChange={(event) => {
              setLoginPassword(event.target.value);
              setError(undefined);
            }}
            placeholder="至少 8 位"
            required
            type="password"
            value={loginPassword}
          />
        </label>

        <p className="text-sm leading-6 text-[color:var(--text-secondary)]">
          当前版本没有密码找回。丢失 FM 或密码后无法恢复。
        </p>

        {error?.source === "login" ? (
          <p className="radio-alert" role="alert">
            {error.message}
          </p>
        ) : null}

        <button
          className="radio-button-primary w-fit"
          disabled={isLoginPending}
          type="submit"
        >
          {isLoginPending ? "接入中" : "FM 登录"}
        </button>
      </form>
    </div>
  );
}
