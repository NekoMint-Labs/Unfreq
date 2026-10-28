export function SignalKindBadge({ isExtended }: { isExtended: boolean }) {
  return (
    <span className="my-frequency-kind">
      {isExtended ? "延伸信号" : "普通信号"}
    </span>
  );
}
