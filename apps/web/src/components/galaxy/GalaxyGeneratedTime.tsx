"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function GalaxyGeneratedTime({ generatedAt }: { generatedAt: string }) {
  // The server cannot know the browser's time zone. Hydration reuses this
  // placeholder before React switches to the browser's local time.
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  return (
    <time dateTime={generatedAt}>
      {hydrated ? new Date(generatedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }) : "--:--"}
    </time>
  );
}
