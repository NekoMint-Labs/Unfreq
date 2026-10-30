"use client";

import { Canvas } from "@react-three/fiber";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalaxyCoverage, GalaxySignalPoint, SignalPrimaryBand } from "@unfreq/contracts";
import { galaxyHref } from "@/lib/galaxy-navigation";
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
import { galaxyLegendItems } from "./galaxy-semantics";

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
  selectedTheme?: string;
  coverage?: GalaxyCoverage;
};

export function GalaxyCanvas({
  bandOptions = [],
  generatedAt,
  isUnavailable = false,
  onboardingStep,
  points,
  selectedBand,
  selectedTheme,
  coverage,
}: GalaxyCanvasProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<number | undefined>(undefined);
  const [canvasSize, setCanvasSize] = useState<GalaxyCanvasSize | undefined>();
  const [detailPoint, setDetailPoint] = useState<GalaxySignalPoint | undefined>(() => points.find((point) => point.id === coverage?.focusSignalId));
  const [isDetailVisible, setIsDetailVisible] = useState(coverage?.focusSignalId !== undefined);
  const [selectedId, setSelectedId] = useState<string | null>(coverage?.focusSignalId ?? null);
  const [listVisible, setListVisible] = useState(false);
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
  const renderPoints = getGalaxyRenderPoints(points, performanceProfile, activeSelectedId, coverage?.latestOwnSignalId);
  const latestOwn = points.find((point) => point.id === coverage?.latestOwnSignalId && point.isMine);

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
          {coverage?.focusStatus === "unavailable" ? <p role="status" className="mt-3 text-sm">指定信号当前不在可公开显示的筛选结果中。</p> : null}
          {coverage !== undefined && coverage.totalEligibleCount > 0 ? <p className="mt-3 text-sm">符合筛选 {coverage.totalEligibleCount} · 当前可读样本 0，请刷新后重试。</p> : null}
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
                当前没有可公开展示的样本。可以先完成这次调频，之后再回来阅读公开表达。
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
          {coverage === undefined ? "" : `符合筛选 ${coverage.totalEligibleCount} · `}返回样本 {points.length} · 绘制 {renderPoints.length} ·{" "}
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
        <div className="galaxy-coverage-actions">
          <button className="radio-tag min-h-11" disabled={latestOwn === undefined} onClick={() => { if (latestOwn !== undefined) showPointDetail(latestOwn); }} type="button">找到我的信号</button>
          <button aria-expanded={listVisible} aria-controls="galaxy-sample-list" className="radio-tag min-h-11" onClick={() => setListVisible((value) => !value)} type="button">{listVisible ? "收起样本列表" : "查看样本列表"}</button>
        </div>
        {coverage?.focusStatus === "unavailable" ? <p className="mt-2 text-xs" role="status">指定信号当前不在可公开显示的筛选结果中。</p> : null}
        <p className="mt-2 text-xs text-[color:var(--text-secondary)]">星图按固定预算取样；“我的信号”定位当前筛选内最新公开的一条。</p>
        <details className="galaxy-legend">
          <summary>星图图例</summary>
          <dl aria-label="星图视觉说明" tabIndex={0}>{galaxyLegendItems.map((item) => <div key={item.label}>
            <dt>{item.label}</dt><dd>{item.text}</dd>
          </div>)}</dl>
        </details>
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
              href={galaxyHref({ band: band.value, focus: coverage?.focusSignalId })}
              key={band.value}
            >
              {band.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {listVisible ? <aside aria-label="星图样本列表" aria-hidden={isFocusReading} inert={isFocusReading} className="galaxy-sample-list" id="galaxy-sample-list">
        <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">本次返回样本（{points.length}）</h2><button aria-label="关闭样本列表" className="radio-button-text min-h-11 min-w-11" onClick={() => setListVisible(false)} type="button">×</button></div>
        <p className="mt-2 text-xs text-[color:var(--text-secondary)]">列表包含未在移动星图绘制的样本。选择后可阅读，也可用固定链接定位。</p>
        <ul>{points.map((point) => <li key={point.id}>
          <button className="galaxy-sample-read" onClick={() => showPointDetail(point)} type="button">
            <span>{point.authorFreqCode ?? "Unfreq"}{point.isMine ? " · 我的信号" : ""}</span>
            <span className="block mt-2 text-sm">{point.expandedText.slice(0, 120)}{point.expandedText.length > 120 ? "…" : ""}</span>
          </button>
          <Link className="radio-button-text min-h-11 inline-flex items-center" href={galaxyHref({ band: selectedBand, theme: selectedTheme, focus: point.id })}>在星图定位</Link>
        </li>)}</ul>
      </aside> : null}

      {onboardingStep === "galaxy" ? (
        <div className="tour-panel tour-panel-galaxy" role="status">
          <p className="radio-kicker">FIRST TUNE · 03</p>
          <h1>走进信号星图</h1>
          <p>
            星点位置是艺术化排布，远近不表示语义相似度。点开一条公开表达阅读，看完后回到我的频率。
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
              sample={points}
            />,
            document.body,
          )
        : null}
    </section>
  );
}
