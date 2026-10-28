"use client";

import { useEffect } from "react";
import { reportFrontendError } from "@/lib/frontend-diagnostics";

export function FrontendErrorReporter() {
  useEffect(() => {
    const handleRuntimeError = (event: ErrorEvent) => {
      void reportFrontendError("client-runtime", event.error ?? event.message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      void reportFrontendError("unhandled-rejection", event.reason);
    };

    window.addEventListener("error", handleRuntimeError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleRuntimeError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
