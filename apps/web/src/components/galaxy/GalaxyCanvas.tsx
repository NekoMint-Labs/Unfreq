"use client";

import { Canvas } from "@react-three/fiber";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalaxySignalPoint, SignalPrimaryBand } from "@unfreq/contracts";
import { GalaxyScene } from "./GalaxyScene";
import { GalaxySignalSheet } from "./GalaxySignalSheet";
import { GalaxyViewportSync } from "./GalaxyViewportSync";
import {
  getActiveGalaxySelection,
  getCameraDistance,
  getCameraFov,
  getCameraPosition,
  getGalaxyPerformanceProfile,
  getGalaxyRenderPoints,
  getSceneScale,
  type GalaxyCanvasSize,
  type ScenePosition,
} from "./galaxy-layout";
import { detailFadeExitMs, fallbackBandLabels } from "./galaxy-scene-constants";

type GalaxyCanvasProps = {
  bandOptions?: Array<{
    label: string;
    value: SignalPrimaryBand;
  }>;
  generatedAt: string;
  isUnavailable?: boolean;
  onboardingStep?: "galaxy";
  points: GalaxySignalPoint[];
  selectedBand?: SignalPrimaryBand;
};

export function GalaxyCanvas({
  bandOptions = [],
  generatedAt,
  isUnavailable = false,
  onboardingStep,
  points,
  selectedBand,
}: GalaxyCanvasProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<number | undefined>(undefined);
  const [canvasSize, setCanvasSize] = useState<GalaxyCanvasSize | undefined>();
  const [detailPoint, setDetailPoint] = useState<GalaxySignalPoint | undefined>();
  const [isDetailVisible, setIsDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { selectedId: activeSelectedId, selectedPoint } = getActiveGalaxySelection(
    points,
    selectedId,
  );
  const sceneScale = canvasSize === undefined ? 1 : getSceneScale(canvasSize);
  const cameraDistance = canvasSize === undefined ? 9 : getCameraDistance(canvasSize);
  const cameraPosition = canvasSize === undefined
    ? ([0, 1.6, cameraDistance] satisfies ScenePosition)
    : getCameraPosition(canvasSize);
  const isMobileHitArea = canvasSize !== undefined && canvasSize.width < 768;
  const cameraFov = canvasSize === undefined ? 52 : getCameraFov(canvasSize);
  const isFocusReading = isDetailVisible;
  const selectedBandLabel =
    selectedBand === undefined
      ? undefined
      : bandOptions.find((option) => option.value === selectedBand)?.label ??
        fallbackBandLabels[selectedBand];
  const performanceProfile = getGalaxyPerformanceProfile(points, isMobileHitArea);
  const renderPoints = getGalaxyRenderPoints(points, performanceProfile, activeSelectedId);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current === undefined) {
      return;
    }

    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = undefined;
  }, []);

  const showPointDetail = useCallback((point: GalaxySignalPoint) => {
    clearCloseTimeout();
    setDetailPoint(point);
    setSelectedId(point.id);
    setIsDetailVisible(true);
  }, [clearCloseTimeout]);

  const hidePointDetail = useCallback(() => {
    clearCloseTimeout();
    setIsDetailVisible(false);
    setSelectedId(null);
    closeTimeoutRef.current = window.setTimeout(() => {
      setDetailPoint(undefined);
      closeTimeoutRef.current = undefined;
    }, detailFadeExitMs);
  }, [clearCloseTimeout]);

  useEffect(() => {
    const host = canvasHostRef.current;

    if (host === null) {
      return;
    }

    const syncCanvasSize = () => {
      const rect = host.getBoundingClientRect();
      const nextSize = {
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      };

      if (nextSize.width <= 0 || nextSize.height <= 0) {
        return;
      }

      setCanvasSize((previousSize) => {
        if (
          previousSize?.height === nextSize.height &&
          previousSize?.width === nextSize.width
        ) {
          return previousSize;
        }

        return nextSize;
      });
    };
    const observer = new ResizeObserver(syncCanvasSize);

    syncCanvasSize();
    observer.observe(host);
    window.addEventListener("resize", syncCanvasSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncCanvasSize);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearCloseTimeout();
    };
  }, [clearCloseTimeout]);

  useEffect(() => {
    if (detailPoint === undefined) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".galaxy-detail-content")) {
        return;
      }

      hidePointDetail();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hidePointDetail();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailPoint, hidePointDetail]);

  if (points.length === 0) {
    return (
      <section className="quiet-dot-field grid min-h-[calc(100dvh-11rem)] place-items-center px-4">
        <div className="empty-state max-w-md">
          <p className="radio-kicker">
            {isUnavailable ? "GALAXY · UNAVAILABLE" : "GALAXY · EMPTY"}
          </p>
          <h1 className="empty-state-title mt-4">
            {isUnavailable ? "星图暂时没有接入" : "星图还没有信号"}
          </h1>
          <p className="mt-4 leading-7 text-[color:var(--text-secondary)]">
            {isUnavailable
              ? "星图暂时没有响应。稍后可以重新打开，或先回到发射入口。"
              : selectedBandLabel
                ? `${selectedBandLabel} 暂时没有可公开展示的信号。可以换一个频段，或回到全部星图。`
                : "当前没有可公开展示的信号。先写下一句种子，或先回到我的频率。"}
          </p>
          {selectedBandLabel !== undefined ? (
            <p className="mt-3 font-mono text-xs tracking-[0.16em] text-[color:var(--text-tertiary)]">
              FILTER · {selectedBandLabel}
            </p>
          ) : null}
          {onboardingStep === "galaxy" ? (
            <div className="tour-panel tour-panel-galaxy-empty mt-6" role="status">
              <p className="radio-kicker">FIRST TUNE · 03</p>
              <h2>星图还在等待更多亮点</h2>
              <p>
                当前星海里还没有足够多的公开信号。可以先完成这次调频，之后信号变多时，再回来读它们之间的距离。
              </p>
              <Link className="radio-button-primary" href="/me?onboarding=complete">
                回到我的频率
              </Link>
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link className="radio-button-primary" href="/">
              发射种子
            </Link>
            {selectedBand !== undefined ? (
              <Link className="radio-button-secondary" href="/galaxy">
                查看全部
              </Link>
            ) : null}
            <Link className="radio-button-secondary" href="/me">
              回到我的频率
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`galaxy-full-bleed quiet-dot-field galaxy-stage ${isFocusReading ? "galaxy-stage-focus" : ""}`}
    >
      <div
        aria-hidden={isFocusReading}
        className="galaxy-panel galaxy-hud-panel"
        inert={isFocusReading}
      >
        <p className="radio-kicker">RADAR · SIGNAL GALAXY</p>
        <h1 className="mt-2 text-base font-semibold text-[color:var(--text-primary)] md:text-lg">
          共振星图
        </h1>
        <p className="mt-1 font-mono text-xs text-[color:var(--text-secondary)]">
          SIGNALS {points.length.toString().padStart(3, "0")} ·{" "}
          {new Date(generatedAt).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        {selectedBand !== undefined ? (
          <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
            {selectedBandLabel}
          </p>
        ) : null}
        <p className="galaxy-zoom-readout">
          拖拽旋转 · 双指缩放 · 滑动视角
        </p>
        <p className="galaxy-select-cue">
          点击亮点 · 打开阅读层
        </p>
      </div>

      {bandOptions.length > 0 ? (
        <nav
          aria-hidden={isFocusReading}
          aria-label="星图主频段筛选"
          className="galaxy-filter-row"
          inert={isFocusReading}
        >
          <Link className="radio-tag" href="/galaxy">
            全部
          </Link>
          {bandOptions.map((band) => (
            <Link
              className={`radio-tag ${band.value === selectedBand ? "radio-tag-active" : ""}`}
              href={`/galaxy?band=${encodeURIComponent(band.value)}`}
              key={band.value}
            >
              {band.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {onboardingStep === "galaxy" ? (
        <div className="tour-panel tour-panel-galaxy" role="status">
          <p className="radio-kicker">FIRST TUNE · 03</p>
          <h1>走进信号星图</h1>
          <p>
            这里没有排行榜，只有距离。点一个亮点，读一段陌生频率留下的信号。看完后回到我的频率，让这次发射归档。
          </p>
          <Link className="radio-button-primary" href="/me?onboarding=complete">
            回到我的频率
          </Link>
        </div>
      ) : null}

      <div
        className="galaxy-canvas-host"
        ref={canvasHostRef}
        style={{ inset: 0, overflow: "hidden", position: "absolute" }}
      >
        {canvasSize !== undefined ? (
          <Canvas
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true }}
            key={isMobileHitArea ? "mobile" : "desktop"}
            onPointerMissed={hidePointDetail}
            style={{ height: canvasSize.height, width: canvasSize.width }}
          >
            <GalaxyViewportSync />
            <color args={["#0a0a12"]} attach="background" />
            <ambientLight intensity={0.75} />
            <GalaxyScene
              cameraFov={cameraFov}
              cameraPosition={cameraPosition}
              detailPoint={detailPoint}
              isMobileHitArea={isMobileHitArea}
              onSelect={showPointDetail}
              performanceProfile={performanceProfile}
              points={renderPoints}
              sceneScale={sceneScale}
              selectedId={activeSelectedId}
              selectedPoint={selectedPoint}
            />
          </Canvas>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(10,10,18,0.12)_58%,rgba(10,10,18,0.76)_100%)]" />
      <span aria-hidden="true" className="galaxy-reading-focus-mask" />
      <span aria-hidden="true" className="galaxy-top-fade-mask" />

      {detailPoint !== undefined && typeof document !== "undefined"
        ? createPortal(
            <GalaxySignalSheet
              isVisible={isDetailVisible}
              key={detailPoint.id}
              onClose={hidePointDetail}
              point={detailPoint}
            />,
            document.body,
          )
        : null}
    </section>
  );
}
