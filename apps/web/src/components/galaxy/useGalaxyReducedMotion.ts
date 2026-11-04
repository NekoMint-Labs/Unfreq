"use client";

import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const snapshot = () => window.matchMedia(query).matches;
// Keep the server and first hydration frame still until the preference is known.
export function useGalaxyReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
