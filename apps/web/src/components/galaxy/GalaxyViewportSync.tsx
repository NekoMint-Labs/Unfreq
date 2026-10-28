"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

export function GalaxyViewportSync() {
  const gl = useThree((state) => state.gl);
  const setSize = useThree((state) => state.setSize);

  useEffect(() => {
    const container = gl.domElement.parentElement;

    if (container === null) {
      return;
    }

    const syncViewport = () => {
      const rect = container.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      setSize(rect.width, rect.height, rect.top, rect.left);
      gl.setSize(rect.width, rect.height, true);
    };
    const observer = new ResizeObserver(syncViewport);

    syncViewport();
    observer.observe(container);
    window.addEventListener("resize", syncViewport);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncViewport);
    };
  }, [gl, setSize]);

  return null;
}
