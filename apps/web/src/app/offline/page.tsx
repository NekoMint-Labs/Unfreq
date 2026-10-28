import Link from "next/link";
import { RouteStatusPanel } from "@/components/layout/RouteStatusPanel";

export default function OfflinePage() {
  return (
    <RouteStatusPanel
      body="当前网络不可用。恢复连接后可以回到发射入口，或继续打开星图。"
      kicker="FM · OFFLINE"
      title="信号暂时断开"
    >
      <Link className="radio-button-primary" href="/">
        回到发射
      </Link>
      <Link className="radio-button-secondary" href="/galaxy">
        打开星图
      </Link>
    </RouteStatusPanel>
  );
}
