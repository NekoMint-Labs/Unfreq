import { AbuseControlStopped } from "../../shared/abuse-errors.js";

/** Raised inside the admission transaction, before any signal is inserted. */
export class GenerationAdmissionDenied extends AbuseControlStopped {
  constructor() {
    super("limited", "concurrency", 1000);
    this.name = "GenerationAdmissionDenied";
  }
}
