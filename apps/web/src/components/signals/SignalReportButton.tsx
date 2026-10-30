"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ReportReceipt } from "@unfreq/contracts";
import { ApiClientError } from "@/lib/api-client";
import { createSignalReport, getOwnSignalReport } from "@/lib/signal-reports";

const reasons = ["骚扰或攻击", "垃圾信息或广告", "涉及隐私", "其他"];
const statusLabels = { PENDING: "待审核", RESOLVED: "已处理", REJECTED: "未予处理" };

function reportError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "接入频率后才能举报和查看处理状态。";
    if (error.status === 403) return "当前频率暂时不能提交举报。";
    if (error.status === 404) return "这条信号已不再公开，无法提交举报。";
    if (error.status === 429) return "操作过于频繁，请稍后再试。";
  }
  return "暂时无法确认结果，请稍后查看处理状态。";
}

function ReportAction({ signalId, buttonClassName }: { signalId: string; buttonClassName?: string }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const [receipt, setReceipt] = useState<ReportReceipt>();
  const [reason, setReason] = useState(reasons[0]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [loginRequired, setLoginRequired] = useState(false);

  useEffect(() => () => controller.current?.abort(), []);

  const perform = async (submit: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setError(undefined);
    setLoginRequired(false);
    try {
      const current = submit ? await createSignalReport(signalId, reason, note, abort.signal) : await getOwnSignalReport(signalId, abort.signal);
      if (!abort.signal.aborted) {
        setReceipt(current);
        if (submit) setNote("");
      }
    } catch (caught) {
      if (!abort.signal.aborted) {
        setError(reportError(caught));
        setLoginRequired(caught instanceof ApiClientError && caught.status === 401);
      }
    } finally {
      busy.current = false;
      if (!abort.signal.aborted) setPending(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void perform(true);
  };

  return <div>
    <button className={buttonClassName ?? "signal-next-secondary"} type="button" onClick={() => {
      dialog.current?.showModal();
      void perform(false);
    }}>举报</button>
    <dialog aria-labelledby={titleId} className="signal-report-dialog" ref={dialog}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button,a[href],input,select,textarea,[tabindex]"))
          .filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (first === undefined || last === undefined) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }} onCancel={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl" id={titleId}>举报这条信号</h2>
        <button aria-label="关闭举报" className="radio-button-text min-h-11 min-w-11" onClick={() => dialog.current?.close()} type="button">×</button>
      </div>
      <p className="my-4 text-sm leading-6">原因和说明仅供后台审核，不向被举报方展示。提交举报不会自动隐藏信号。</p>
      {pending ? <p role="status">正在处理…</p> : null}
      {error ? <p className="my-3" role="alert">{error}</p> : null}
      {loginRequired ? <a className="radio-button-secondary" href={`/login?returnTo=${encodeURIComponent(`/result/${encodeURIComponent(signalId)}`)}`}>接入频率</a> : <>
        {receipt ? <div className="my-4" role="status">
          <p>举报状态：{statusLabels[receipt.status]}</p>
          <p className="mt-1 text-xs break-all">回执 {receipt.id}</p>
          <button className="radio-button-text min-h-11" disabled={pending} onClick={() => { void perform(false); }} type="button">刷新处理状态</button>
        </div> : null}
        {receipt?.status !== "PENDING" ? <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-2">举报原因
            <select className="radio-input min-h-11" disabled={pending} onChange={(event) => setReason(event.target.value)} value={reason}>
              {reasons.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="grid gap-2">补充说明（可选，最多 500 字）
            <textarea className="radio-input min-h-28" disabled={pending} maxLength={500} onChange={(event) => setNote(event.target.value)} rows={4} value={note} />
          </label>
          <button className="radio-button-secondary min-h-11" disabled={pending} type="submit">{pending ? "提交中" : "提交举报"}</button>
        </form> : <p className="text-sm">已收到举报，请等待审核。你可以稍后在这里查看状态。</p>}
      </>}
    </dialog>
  </div>;
}

export function SignalReportButton(props: { signalId: string; buttonClassName?: string }) {
  return <ReportAction key={props.signalId} {...props} />;
}
