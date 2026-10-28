import Link from "next/link";

export function MySignalsUnavailableNotice() {
  return (
    <section className="my-frequency-section my-frequency-notice grid gap-3 p-5">
      <p className="radio-kicker">SIGNALS · SYNC PENDING</p>
      <h2 className="my-frequency-section-title">信号日志暂时没有同步</h2>
      <p className="text-sm leading-7 text-[color:var(--text-secondary)]">
        当前 FM 频率已经接入，但信号列表没有及时返回。可以先继续发射 seed，稍后再回到这里刷新日志。
      </p>
      <div>
        <Link className="my-frequency-init-link" href="/">
          [ INIT NEW SIGNAL ]
        </Link>
      </div>
    </section>
  );
}
