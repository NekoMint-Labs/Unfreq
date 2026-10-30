"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveContinuation } from "@/lib/signal-continuation";

export function ContinueSignalButton({ parentSignalId, seedText = "" }: { parentSignalId: string; seedText?: string }) {
  const router = useRouter(); const [error, setError] = useState<string>();
  return <div><button className="signal-next-secondary" type="button" onClick={() => {
    try { saveContinuation({ parentSignalId, seedText }); router.push("/?continue=1"); }
    catch { setError("暂时无法保存续写内容，请复制后再回到首页。"); }
  }}>继续写 seed</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
