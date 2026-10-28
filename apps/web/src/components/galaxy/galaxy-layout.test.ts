import { describe, expect, it } from "vitest";
import type { GalaxySignalPoint, SignalPrimaryBand, SignalSubFeeling } from "@unfreq/contracts";
import {
  buildGalaxyLineBucketLayouts,
  getActiveGalaxySelection,
  getCameraFov,
  getCameraPosition,
  getGalaxyPerformanceProfile,
  getGalaxyRenderPoints,
  getSceneScale,
  getStarVisualProfile,
  toScenePosition,
} from "./galaxy-layout";

function createPoint(
  overrides: Partial<GalaxySignalPoint> & { id: string },
): GalaxySignalPoint {
  return {
    createdAt: "2026-05-22T00:00:00.000Z",
    expandedText: "星图测试信号",
    frequencyCode: "FM 78.23",
    frequencyProfile: {
      coreNeed: "被理解",
      displayText: "测试频段",
      emotionTone: "安静",
      innerConflict: "想说又停下",
      primaryBand: "self_mirror" satisfies SignalPrimaryBand,
      resonanceKeywords: ["测试"],
      subFeeling: "self_doubt" satisfies SignalSubFeeling,
    },
    isMine: false,
    matchIds: [],
    position: { x: 0, y: 0, z: 0 },
    resonanceCount: 0,
    source: "human",
    theme: "测试",
    ...overrides,
    id: overrides.id,
  };
}

describe("galaxy layout helpers", () => {
  it("uses a wider camera and smaller scene scale on narrow mobile viewports", () => {
    const mobileSize = { height: 844, width: 390 };
    const desktopSize = { height: 900, width: 1440 };

    expect(getSceneScale(mobileSize)).toBe(0.62);
    expect(getSceneScale(desktopSize)).toBe(1);
    expect(getCameraFov(mobileSize)).toBe(60);
    expect(getCameraFov(desktopSize)).toBe(54);
    expect(getCameraPosition(mobileSize)[2]).toBeGreaterThan(getCameraPosition(desktopSize)[2]);
  });

  it("keeps point positions deterministic for the same signal", () => {
    const point = createPoint({
      id: "signal-a",
      position: { x: 0.2, y: -0.4, z: 0.6 },
    });

    expect(toScenePosition(point)).toEqual(toScenePosition(point));
  });

  it("clears active selection when the selected point is outside the current result", () => {
    const points = [createPoint({ id: "signal-a" })];

    expect(getActiveGalaxySelection(points, "signal-a")).toEqual({
      selectedId: "signal-a",
      selectedPoint: points[0],
    });
    expect(getActiveGalaxySelection(points, "signal-b")).toEqual({});
    expect(getActiveGalaxySelection(points, null)).toEqual({});
  });

  it("builds one link for mirrored match ids and ignores missing matches", () => {
    const points = [
      createPoint({
        id: "signal-a",
        matchIds: ["signal-b", "missing-signal"],
        resonanceCount: 9,
      }),
      createPoint({
        id: "signal-b",
        matchIds: ["signal-a"],
        position: { x: 0.8, y: 0.2, z: 0.2 },
      }),
    ];
    const buckets = buildGalaxyLineBucketLayouts(points);
    const totalPositionValues = buckets.reduce(
      (sum, bucket) => sum + bucket.positions.length,
      0,
    );

    expect(totalPositionValues).toBe(6);
  });

  it("enlarges star visuals for mobile hit areas without changing identity", () => {
    const point = createPoint({ id: "signal-a", resonanceCount: 8 });
    const desktopProfile = getStarVisualProfile(point, false, 0);
    const mobileProfile = getStarVisualProfile(point, true, 0);

    expect(mobileProfile.coreScale).toBeGreaterThan(desktopProfile.coreScale);
    expect(mobileProfile.twinkleSeed).toBe(desktopProfile.twinkleSeed);
  });

  it("keeps desktop render budgets uncapped", () => {
    const points = Array.from({ length: 90 }, (_, index) =>
      createPoint({ id: `signal-${index}` }),
    );
    const profile = getGalaxyPerformanceProfile(points, false);

    expect(profile.usesLowDetailEffects).toBe(false);
    expect(profile.renderDepthMist).toBe(true);
    expect(getGalaxyRenderPoints(points, profile)).toHaveLength(points.length);
  });

  it("caps dense mobile render points while preserving priority and selected signals", () => {
    const points = Array.from({ length: 90 }, (_, index) =>
      createPoint({
        id: `signal-${index}`,
        isMine: index === 80,
        resonanceCount: index === 12 ? 24 : 0,
      }),
    );
    const profile = getGalaxyPerformanceProfile(points, true);
    const renderPoints = getGalaxyRenderPoints(points, profile, "signal-89");
    const renderIds = new Set(renderPoints.map((point) => point.id));

    expect(profile.maxRenderedPoints).toBe(72);
    expect(profile.renderDepthMist).toBe(false);
    expect(renderPoints).toHaveLength(72);
    expect(renderIds.has("signal-80")).toBe(true);
    expect(renderIds.has("signal-12")).toBe(true);
    expect(renderIds.has("signal-89")).toBe(true);
  });

  it("limits mobile link density by match count and total link budget", () => {
    const points = Array.from({ length: 20 }, (_, index) =>
      createPoint({
        id: `signal-${index}`,
        matchIds: Array.from({ length: 19 }, (_, matchIndex) =>
          `signal-${matchIndex < index ? matchIndex : matchIndex + 1}`,
        ),
        resonanceCount: 9,
      }),
    );
    const buckets = buildGalaxyLineBucketLayouts(points, {
      maxLinks: 12,
      maxMatchesPerPoint: 1,
    });
    const totalPositionValues = buckets.reduce(
      (sum, bucket) => sum + bucket.positions.length,
      0,
    );

    expect(totalPositionValues).toBeLessThanOrEqual(12 * 6);
  });
});
