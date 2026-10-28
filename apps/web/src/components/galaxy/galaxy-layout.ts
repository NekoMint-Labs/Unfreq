import type { GalaxySignalPoint } from "@unfreq/contracts";

export type GalaxyCanvasSize = {
  height: number;
  width: number;
};

export type ScenePosition = [number, number, number];

export type StarVisualProfile = {
  burstOpacity: number;
  burstScale: number;
  coreOpacity: number;
  coreScale: number;
  haloOpacity: number;
  haloScale: number;
  innerHaloOpacity: number;
  innerHaloScale: number;
  isMajorStar: boolean;
  twinkleSeed: number;
};

export type GalaxySelection = {
  selectedId?: string;
  selectedPoint?: GalaxySignalPoint;
};

export type GalaxyLineBucketLayout = {
  color: string;
  id: string;
  lineWidth: number;
  opacity: number;
  positions: number[];
};

export type GalaxyLineBudget = {
  maxLinks?: number;
  maxMatchesPerPoint?: number;
};

export type GalaxyPerformanceProfile = {
  distantStarCount: number;
  dustCount: number;
  isMobile: boolean;
  maxLinks?: number;
  maxMatchesPerPoint?: number;
  maxRenderedPoints: number;
  renderDepthMist: boolean;
  usesLowDetailEffects: boolean;
};

const galaxyXYScale = 5.55;
const galaxyYScale = 4.9;
const galaxyZScale = 7.25;
const galaxyDepthSpan = galaxyZScale * 3.45;
const mobileRenderedPointLimit = 72;
const constellationAnchors: Array<[number, number, number]> = [
  [-1.22, 0.78, -0.18],
  [1.12, 0.68, 0.14],
  [-1.05, -0.62, 0.22],
  [1.02, -0.72, -0.2],
  [0.02, 0.08, 0.34],
  [-0.16, 1.18, -0.34],
  [0.24, -1.12, 0.3],
];

const galaxyLineBucketConfigs: Array<Omit<GalaxyLineBucketLayout, "positions">> = [
  {
    color: "#d7dce6",
    id: "near-primary",
    lineWidth: 1.35,
    opacity: 0.068,
  },
  {
    color: "#aebbd0",
    id: "near-secondary",
    lineWidth: 1.08,
    opacity: 0.034,
  },
  {
    color: "#b8c3d3",
    id: "mid-primary",
    lineWidth: 1,
    opacity: 0.044,
  },
  {
    color: "#8996aa",
    id: "mid-secondary",
    lineWidth: 0.86,
    opacity: 0.02,
  },
  {
    color: "#8c98aa",
    id: "far-primary",
    lineWidth: 0.78,
    opacity: 0.023,
  },
  {
    color: "#6f7b8f",
    id: "far-secondary",
    lineWidth: 0.68,
    opacity: 0.009,
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(value: number, min: number, max: number): number {
  const normalizedValue = clamp((value - min) / (max - min), 0, 1);

  return normalizedValue * normalizedValue * (3 - 2 * normalizedValue);
}

export function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;

  return value - Math.floor(value);
}

export function getPointSeed(value: string): number {
  return value.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function getMobileRenderPriority(point: GalaxySignalPoint): number {
  const seed = getPointSeed(point.id);
  const resonanceScore = clamp(point.resonanceCount, 0, 24) * 16;
  const matchScore = clamp(point.matchIds.length, 0, 8) * 5;
  const ownershipScore = point.isMine ? 1_000 : 0;

  return ownershipScore + resonanceScore + matchScore + pseudoRandom(seed + 701);
}

export function getGalaxyPerformanceProfile(
  points: GalaxySignalPoint[],
  isMobile: boolean,
): GalaxyPerformanceProfile {
  if (!isMobile) {
    return {
      distantStarCount: Math.max(500, points.length * 26),
      dustCount: Math.max(220, points.length * 14),
      isMobile: false,
      maxRenderedPoints: points.length,
      renderDepthMist: true,
      usesLowDetailEffects: false,
    };
  }

  const renderedPointCount = Math.min(points.length, mobileRenderedPointLimit);
  const isDenseMobileGalaxy = points.length > mobileRenderedPointLimit;

  return {
    distantStarCount: Math.round(
      clamp(renderedPointCount * (isDenseMobileGalaxy ? 4.5 : 6), 180, 520),
    ),
    dustCount: Math.round(
      clamp(renderedPointCount * (isDenseMobileGalaxy ? 1.8 : 2.4), 96, 180),
    ),
    isMobile: true,
    maxLinks: Math.round(clamp(renderedPointCount * 1.15, 28, 96)),
    maxMatchesPerPoint: isDenseMobileGalaxy ? 1 : 2,
    maxRenderedPoints: mobileRenderedPointLimit,
    renderDepthMist: false,
    usesLowDetailEffects: true,
  };
}

export function getGalaxyRenderPoints(
  points: GalaxySignalPoint[],
  profile: GalaxyPerformanceProfile,
  selectedId?: string,
): GalaxySignalPoint[] {
  if (!profile.isMobile || points.length <= profile.maxRenderedPoints) {
    return points;
  }

  const visiblePointIds = new Set(
    points
      .map((point, index) => ({
        index,
        point,
        priority:
          point.id === selectedId
            ? getMobileRenderPriority(point) + 2_000
            : getMobileRenderPriority(point),
      }))
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
      .slice(0, profile.maxRenderedPoints)
      .map(({ point }) => point.id),
  );

  return points.filter((point) => visiblePointIds.has(point.id));
}

export function getViewportAspect(size: GalaxyCanvasSize): number {
  return size.width / Math.max(size.height, 1);
}

export function getSceneScale(size: GalaxyCanvasSize): number {
  const aspect = getViewportAspect(size);

  if (aspect < 0.56) {
    return 0.62;
  }

  if (aspect < 0.72) {
    return 0.74;
  }

  if (aspect < 1) {
    return 0.86;
  }

  return 1;
}

export function getCameraDistance(size: GalaxyCanvasSize): number {
  const aspect = getViewportAspect(size);

  if (aspect < 0.56) {
    return 15.4;
  }

  if (aspect < 0.72) {
    return 14.2;
  }

  if (aspect < 1) {
    return 12.8;
  }

  return 11.6;
}

export function getCameraPosition(size: GalaxyCanvasSize): ScenePosition {
  const aspect = getViewportAspect(size);
  const distance = getCameraDistance(size);

  if (aspect < 0.56) {
    return [0.48, 1.18, distance];
  }

  if (aspect < 0.72) {
    return [0.62, 1.34, distance];
  }

  if (aspect < 1) {
    return [0.72, 1.52, distance];
  }

  return [0.96, 1.8, distance];
}

export function getCameraFov(size: GalaxyCanvasSize): number {
  const aspect = getViewportAspect(size);

  if (aspect < 0.56) {
    return 60;
  }

  if (aspect < 0.72) {
    return 58;
  }

  return 54;
}

export function toScenePosition(point: GalaxySignalPoint): ScenePosition {
  const pointSeed = getPointSeed(point.id);
  const anchor = constellationAnchors[pointSeed % constellationAnchors.length];
  const orbit = pseudoRandom(pointSeed + 41) * Math.PI * 2;
  const orbitRadius = 0.24 + pseudoRandom(pointSeed + 67) * 0.52;
  const sourceX = point.position.x * 0.66 + anchor[0] * 0.54;
  const sourceY = point.position.y * 0.64 + anchor[1] * 0.52;
  const sourceZ = point.position.z * 1.08 + anchor[2] * 0.72;
  const depthOffset = (pseudoRandom(pointSeed + 29) - 0.5) * 1.85;
  const depthShearX = sourceZ * 0.28;
  const depthShearY = sourceZ * 0.2;

  return [
    (sourceX + Math.cos(orbit) * orbitRadius + depthShearX) * galaxyXYScale,
    (sourceY + Math.sin(orbit) * orbitRadius * 0.68 + depthShearY) * galaxyYScale,
    sourceZ * galaxyZScale + depthOffset,
  ];
}

export function getDepthFactor(z: number): number {
  return clamp((z + galaxyDepthSpan * 0.5) / galaxyDepthSpan, 0, 1);
}

export function getNearDepthFactor(z: number): number {
  return Math.pow(getDepthFactor(z), 0.78);
}

export function getStarVisualProfile(
  point: GalaxySignalPoint,
  isMobileHitArea: boolean,
  sceneZ: number,
): StarVisualProfile {
  const seed = getPointSeed(point.id);
  const rareBright = pseudoRandom(seed + 211) > 0.955;
  const tier = point.isMine
    ? 3
    : point.resonanceCount >= 8
      ? 3
      : point.resonanceCount >= 3
        ? 2
        : point.resonanceCount >= 1
          ? 1
          : rareBright
            ? 2
            : 0;
  const nearDepth = getNearDepthFactor(sceneZ);
  const foregroundLift = smoothstep(nearDepth, 0.46, 1);
  const mobileScale = isMobileHitArea ? 1.42 : 1;
  const jitter = 0.86 + pseudoRandom(seed + 13) * 0.28;
  const haloJitter = 0.86 + pseudoRandom(seed + 41) * 0.34;
  const importanceLift = point.isMine ? 0.22 : tier >= 3 ? 0.18 : tier >= 2 ? 0.1 : 0;
  const depthScale = (isMobileHitArea ? 0.82 : 0.58) + nearDepth * 0.92;
  const opacityScale = 0.56 + nearDepth * 0.5 + importanceLift;
  const haloDepthScale = 0.44 + foregroundLift * 1.02 + importanceLift;
  const isMajorStar =
    point.isMine || tier >= 3 || (tier === 2 && pseudoRandom(seed + 337) > 0.62);
  const coreScaleByTier = [0.086, 0.106, 0.136, 0.166];
  const innerHaloScaleByTier = [0.19, 0.27, 0.38, 0.5];
  const haloScaleByTier = [0.34, 0.5, 0.72, 0.98];
  const coreOpacityByTier = [0.7, 0.8, 0.92, 1];
  const innerHaloOpacityByTier = [0.17, 0.24, 0.34, 0.48];
  const haloOpacityByTier = [0.038, 0.066, 0.098, 0.15];

  return {
    burstOpacity: isMajorStar
      ? (point.isMine ? 0.34 : tier >= 3 ? 0.27 : 0.18) * (0.82 + nearDepth * 0.36)
      : 0,
    burstScale:
      (point.isMine ? 0.5 : tier >= 3 ? 0.4 : 0.3) *
      mobileScale *
      jitter *
      (0.82 + nearDepth * 0.42),
    coreOpacity: clamp(
      coreOpacityByTier[tier] * opacityScale,
      isMobileHitArea ? 0.54 : 0.38,
      1,
    ),
    coreScale: coreScaleByTier[tier] * mobileScale * jitter * depthScale,
    haloOpacity: clamp(haloOpacityByTier[tier] * haloDepthScale, 0.012, 0.26),
    haloScale:
      haloScaleByTier[tier] *
      mobileScale *
      haloJitter *
      (0.58 + nearDepth * 0.92),
    innerHaloOpacity: clamp(
      innerHaloOpacityByTier[tier] * (0.58 + nearDepth * 0.66 + importanceLift),
      isMobileHitArea ? 0.1 : 0.06,
      0.62,
    ),
    innerHaloScale:
      innerHaloScaleByTier[tier] *
      mobileScale *
      jitter *
      (0.62 + nearDepth * 0.82),
    isMajorStar,
    twinkleSeed: seed % 97,
  };
}

export function getActiveGalaxySelection(
  points: GalaxySignalPoint[],
  selectedId: string | null,
): GalaxySelection {
  if (selectedId === null) {
    return {};
  }

  const selectedPoint = points.find((point) => point.id === selectedId);

  if (selectedPoint === undefined) {
    return {};
  }

  return {
    selectedId,
    selectedPoint,
  };
}

export function buildGalaxyLineBucketLayouts(
  points: GalaxySignalPoint[],
  budget: GalaxyLineBudget = {},
): GalaxyLineBucketLayout[] {
  const pointById = new Map(points.map((point) => [point.id, point]));
  const seenPairIds = new Set<string>();
  const nearPrimary: number[] = [];
  const nearSecondary: number[] = [];
  const midPrimary: number[] = [];
  const midSecondary: number[] = [];
  const farPrimary: number[] = [];
  const farSecondary: number[] = [];

  for (const point of points) {
    if (budget.maxLinks !== undefined && seenPairIds.size >= budget.maxLinks) {
      break;
    }

    const start = toScenePosition(point);
    const matchIds =
      budget.maxMatchesPerPoint === undefined
        ? point.matchIds
        : point.matchIds.slice(0, budget.maxMatchesPerPoint);

    for (const [matchIndex, matchId] of matchIds.entries()) {
      if (budget.maxLinks !== undefined && seenPairIds.size >= budget.maxLinks) {
        break;
      }

      const match = pointById.get(matchId);

      if (match === undefined) {
        continue;
      }

      const linkSeed = getPointSeed(`${point.id}:${match.id}`);
      const isPrimaryLink = matchIndex === 0;
      const isSignalAnchor =
        point.isMine ||
        match.isMine ||
        Math.max(point.resonanceCount, match.resonanceCount) >= 8;

      if (!isPrimaryLink && (!isSignalAnchor || pseudoRandom(linkSeed + 17) < 0.62)) {
        continue;
      }

      const pairId = [point.id, match.id].sort().join(":");

      if (seenPairIds.has(pairId)) {
        continue;
      }

      seenPairIds.add(pairId);

      const end = toScenePosition(match);
      const averageDepth = (getDepthFactor(start[2]) + getDepthFactor(end[2])) / 2;
      const isImportantLink =
        isPrimaryLink ||
        point.isMine ||
        match.isMine ||
        Math.max(point.resonanceCount, match.resonanceCount) >= 8;
      const bucket =
        averageDepth > 0.62
          ? isImportantLink
            ? nearPrimary
            : nearSecondary
          : averageDepth > 0.34
            ? isImportantLink
              ? midPrimary
              : midSecondary
            : isImportantLink
              ? farPrimary
              : farSecondary;

      bucket.push(...start, ...end);
    }
  }

  return galaxyLineBucketConfigs.map((bucket, index) => ({
    ...bucket,
    positions: [
      nearPrimary,
      nearSecondary,
      midPrimary,
      midSecondary,
      farPrimary,
      farSecondary,
    ][index],
  }));
}
