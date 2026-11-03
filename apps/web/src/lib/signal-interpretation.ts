import type { SignalInterpretation } from "@unfreq/contracts";

/** No current interpretation state has been validated for psychological display. */
export function canDisplaySignalInterpretation(interpretation?: SignalInterpretation): false {
  void interpretation;
  return false;
}
