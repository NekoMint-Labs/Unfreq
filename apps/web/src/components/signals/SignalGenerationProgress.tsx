import { getSignalGenerationProgressSteps } from "./signal-generation-progress-state";

type SignalGenerationProgressProps = {
  isActive: boolean;
};

export function SignalGenerationProgress({ isActive }: SignalGenerationProgressProps) {
  const steps = getSignalGenerationProgressSteps(isActive);

  if (steps.length === 0) {
    return null;
  }

  return (
    <div
      aria-busy="true"
      aria-label="seed 正在调频"
      className="home-generation-progress"
      role="status"
    >
      <p className="home-generation-progress-label">SIGNAL IN TRANSIT</p>
      <ol className="home-generation-progress-steps">
        {steps.map((step, index) => (
          <li className="home-generation-progress-step" key={step}>
            <span className="home-generation-progress-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="home-generation-progress-copy">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
