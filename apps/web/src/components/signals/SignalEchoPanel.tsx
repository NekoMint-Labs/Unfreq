"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { createSignalEcho } from "@/lib/signal-data";
import type { SignalEchoDetail } from "@unfreq/contracts";

type SignalEchoPanelProps = {
  echoes: SignalEchoDetail[];
  signalId: string;
};

export function SignalEchoPanel({ echoes, signalId }: SignalEchoPanelProps) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setIsPending(true);

    try {
      await createSignalEcho(signalId, {
        content,
      });
      setContent("");
      router.refresh();
    } catch (caughtError) {
      if (caughtError instanceof ApiClientError && caughtError.status === 404) {
        setError("这段公开信号已经无法接收共振回应。");
      } else {
        setError("共振回应暂时没有送出。");
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">共振回应</h2>

      {echoes.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {echoes.map((echo) => (
            <article className="radio-surface p-4" key={echo.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="font-mono tracking-[0.16em] text-[color:var(--radio-text)]">
                  {echo.authorFreqCode ?? "GUEST"}
                </span>
                <time className="text-[color:var(--radio-dim)]" dateTime={echo.createdAt}>
                  {new Date(echo.createdAt).toLocaleString("zh-CN")}
                </time>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--radio-muted)]">
                {echo.content}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[color:var(--radio-muted)]">
          这段信号还没有收到共振回应。
        </p>
      )}

      <form className="mt-5 grid gap-3" onSubmit={submit}>
        <label className="grid gap-2 text-sm font-medium" htmlFor="signal-echo">
          留下一段共振回应
          <textarea
            className="radio-textarea min-h-28"
            disabled={isPending}
            id="signal-echo"
            maxLength={500}
            name="signal-echo"
            onChange={(event) => setContent(event.target.value)}
            placeholder="把读完后的共振回应留在这里。"
            required
            value={content}
          />
        </label>
        {error ? (
          <p className="radio-alert" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="radio-button-primary w-fit"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "送出中" : "送出共振回应"}
        </button>
      </form>
    </section>
  );
}
