import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  RingGeometry,
  SphereGeometry,
} from "three";
import type { GalaxySignalPoint, SignalPrimaryBand } from "@unfreq/contracts";

export type GalaxyNodeGeometries = {
  burstHorizontal: BufferGeometry;
  burstVertical: BufferGeometry;
  hitDesktop: SphereGeometry;
  hitDesktopMine: SphereGeometry;
  hitMobile: SphereGeometry;
  hitMobileMine: SphereGeometry;
  selected: RingGeometry;
  selectedMine: RingGeometry;
};

export const selfColor = new Color("#f5fffb");
export const starCoreWhite = new Color("#ffffff");
export const fallbackBandLabels: Record<SignalPrimaryBand, string> = {
  emotional_undercurrent: "情绪暗流",
  era_cluster: "时代星群",
  meaning_deep_space: "意义深空",
  relationship_nebula: "关系星云",
  self_mirror: "自我镜像",
  stagnant_orbit: "停滞轨道",
  time_ring: "时间星环",
};
export const detailFadeDurationSeconds = 0.42;
export const detailFadeExitMs = detailFadeDurationSeconds * 1000;
export const galaxyBaseTiltX = 0.14;
export const galaxyBaseTiltY = -0.32;
export const galaxyBaseTiltZ = -0.06;
export const minCameraDistance = 2.8;
export const maxCameraDistance = 22;
export const nodeCoreRadius = 1;
export const selfVisibleRadius = 0.09;
export const signalVisibleRadius = 0.066;

const bandColors: Record<SignalPrimaryBand, Color> = {
  emotional_undercurrent: new Color("#8dd7ff"),
  era_cluster: new Color("#f5c978"),
  meaning_deep_space: new Color("#b7a7ff"),
  relationship_nebula: new Color("#f6a7bf"),
  self_mirror: new Color("#f4f1de"),
  stagnant_orbit: new Color("#9be7c2"),
  time_ring: new Color("#d8dee9"),
};
const mutedColor = new Color("#6b6b7a");
const desktopHitRadius = signalVisibleRadius * 1.8;
const desktopMineHitRadius = selfVisibleRadius * 1.8;
const mobileHitRadius = Math.max(signalVisibleRadius * 6.4, 0.58);
const mobileMineHitRadius = Math.max(selfVisibleRadius * 6.4, 0.58);

export function createGalaxyNodeGeometries(): GalaxyNodeGeometries {
  const burstHorizontal = new BufferGeometry();
  burstHorizontal.setAttribute(
    "position",
    new Float32BufferAttribute([-1, 0, 0, 1, 0, 0], 3),
  );

  const burstVertical = new BufferGeometry();
  burstVertical.setAttribute(
    "position",
    new Float32BufferAttribute([0, -1, 0, 0, 1, 0], 3),
  );

  return {
    burstHorizontal,
    burstVertical,
    hitDesktop: new SphereGeometry(desktopHitRadius, 18, 18),
    hitDesktopMine: new SphereGeometry(desktopMineHitRadius, 18, 18),
    hitMobile: new SphereGeometry(mobileHitRadius, 18, 18),
    hitMobileMine: new SphereGeometry(mobileMineHitRadius, 18, 18),
    selected: new RingGeometry(0.23, 0.255, 48),
    selectedMine: new RingGeometry(0.29, 0.315, 48),
  };
}

export function getPointColor(point: GalaxySignalPoint): Color {
  if (point.isMine) {
    return selfColor;
  }

  return bandColors[point.frequencyProfile.primaryBand] ?? mutedColor;
}
