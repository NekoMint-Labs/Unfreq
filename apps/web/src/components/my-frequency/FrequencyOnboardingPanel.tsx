import Link from "next/link";

type OnboardingStep = {
  action: string;
  detail: string;
  label: string;
  title: string;
};

const onboardingSteps: OnboardingStep[] = [
  {
    action: "点「开始第一次调频」，在星海入口落下一句 seed，再让它发射。",
    detail: "seed 不必完整。像夜里忽然亮起的一句话，只要真实，系统就能听见它的频率。",
    label: "01",
    title: "把第一句话发向星海",
  },
  {
    action: "发射后先停在结果页，读完扩写信号，再向下看同频的回声。",
    detail: "那些相近的 FM 不是答案，只是远处也有人在同一段静电里停过。",
    label: "02",
    title: "读回声里的自己",
  },
  {
    action: "点结果页里的星图入口，或从这里直接进入星图。",
    detail: "星图不排序，也不评判。它只把相近的信号放得更近。",
    label: "03",
    title: "走进信号星图",
  },
  {
    action: "回到我的频率，看这次发射被写进航行日志。",
    detail: "之后的共鸣、收藏和月度回顾，都会慢慢沉到这里。",
    label: "04",
    title: "让它沉入你的频段",
  },
];

export function FrequencyOnboardingPanel({
  frequencyCode,
  mode,
  signalCount,
}: {
  frequencyCode: string;
  mode: "complete" | "login" | "registered";
  signalCount: number;
}) {
  const isComplete = mode === "complete";
  const title = isComplete
    ? "第一轮信号已经落定"
    : mode === "registered" ? "你的 FM 已接入星海" : "继续完成第一轮信号发射";
  const body =
    isComplete
      ? "你已经走过第一次发射、回声、星图和归档。之后可以继续写 seed，也可以在这里等共鸣慢慢返回。"
      : mode === "registered"
      ? "先保存这组 FM 和密码。之后登录只靠它们。下面这条路径会带你穿过第一次发射、同频回声、星图，再回到自己的频段。"
      : signalCount === 0
        ? "这个频率还没有留下信号。先写一粒 seed，让它被扩写、被看见，再回到这里成为你的第一条航行记录。"
        : "这个频率已经有信号。可以继续发射，也可以打开星图，看它们和其他频率之间的距离。";

  return (
    <section className="my-frequency-section my-frequency-onboarding grid gap-7 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="grid gap-3">
          <p className="radio-kicker">FIRST TUNE</p>
          <h2 className="my-frequency-onboarding-title">{title}</h2>
          <p className="max-w-2xl text-sm leading-7 text-[color:var(--text-secondary)]">
            {body}
          </p>
        </div>
        <div className="my-frequency-onboarding-code" aria-label={`当前频率 ${frequencyCode}`}>
          {frequencyCode}
        </div>
      </div>

      <div className="my-frequency-onboarding-steps" aria-label="使用路径">
        {onboardingSteps.map((step) => (
          <div key={step.label}>
            <span className="my-frequency-en-cue">{step.label}</span>
            <p>{step.title}</p>
            <small>{step.action}</small>
          </div>
        ))}
      </div>

      <div className="my-frequency-demo" aria-label="发射演示">
        <div>
          <p className="my-frequency-demo-label">DEMO SEED</p>
          <p className="my-frequency-demo-seed">
            今天明明什么都没发生，但我一直觉得自己慢了一拍。
          </p>
        </div>
        <div className="my-frequency-demo-arrow" aria-hidden="true">
          →
        </div>
        <div>
          <p className="my-frequency-demo-label">RESULT PAGE</p>
          <p className="my-frequency-demo-body">
            系统会把 seed 扩写成一段信号，也会在同一页放出相近的 FM。读完后，可以留下共鸣、收藏，或进入星图继续看距离。
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {isComplete ? (
          <Link className="radio-button-primary" href="/">
            继续发射 seed
          </Link>
        ) : (
          <Link className="radio-button-primary" href="/?onboarding=seed">
            开始第一次调频
          </Link>
        )}
        <Link className="radio-button-secondary" href="/galaxy">
          进入星图
        </Link>
        <Link className="radio-button-secondary" href="/me">
          留在我的频率
        </Link>
      </div>

      <div className="my-frequency-onboarding-note">
        {onboardingSteps.map((step) => (
          <p key={step.label}>
            <span>{step.label}</span>
            {step.detail}
          </p>
        ))}
      </div>
    </section>
  );
}
