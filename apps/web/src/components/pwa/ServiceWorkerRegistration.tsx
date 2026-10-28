"use client";

import { useEffect } from "react";
import { reportFrontendError } from "@/lib/frontend-diagnostics";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });

        await registration.update();
      } catch (error) {
        void reportFrontendError("service-worker-registration", error);
        // Service worker is progressive enhancement. UI remains usable if it fails.
      }
    };

    void register();
  }, []);

  return null;
}
