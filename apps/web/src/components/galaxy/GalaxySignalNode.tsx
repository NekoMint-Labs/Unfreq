"use client";

import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import {
  AdditiveBlending,
  type CanvasTexture,
  DoubleSide,
  type LineBasicMaterial,
  MathUtils,
  type Mesh,
  type MeshBasicMaterial,
  type SpriteMaterial,
} from "three";
import type { GalaxySignalPoint } from "@unfreq/contracts";
import { getStarVisualProfile, toScenePosition } from "./galaxy-layout";
import {
  getPointColor,
  nodeCoreRadius,
  selfVisibleRadius,
  signalVisibleRadius,
  starCoreWhite,
  type GalaxyNodeGeometries,
} from "./galaxy-scene-constants";

export function GalaxySignalNode({
  geometries,
  coreTexture,
  detailOpacityScale,
  glowTexture,
  isDimmed,
  isMobileHitArea,
  isSelected,
  onSelect,
  point,
}: {
  coreTexture?: CanvasTexture;
  detailOpacityScale: number;
  geometries: GalaxyNodeGeometries;
  glowTexture?: CanvasTexture;
  isDimmed: boolean;
  isMobileHitArea: boolean;
  isSelected: boolean;
  onSelect: (point: GalaxySignalPoint) => void;
  point: GalaxySignalPoint;
}) {
  const coreMaterialRef = useRef<SpriteMaterial>(null);
  const elapsedRef = useRef(0);
  const haloMaterialRef = useRef<SpriteMaterial>(null);
  const horizontalBurstMaterialRef = useRef<LineBasicMaterial>(null);
  const innerHaloMaterialRef = useRef<SpriteMaterial>(null);
  const selectedRingMaterialRef = useRef<MeshBasicMaterial>(null);
  const selectedRingRef = useRef<Mesh>(null);
  const verticalBurstMaterialRef = useRef<LineBasicMaterial>(null);
  const [x, y, z] = toScenePosition(point);
  const starProfile = getStarVisualProfile(point, isMobileHitArea, z);
  const visibleRadius = point.isMine ? selfVisibleRadius : signalVisibleRadius;
  const hitGeometry = isMobileHitArea
    ? point.isMine
      ? geometries.hitMobileMine
      : geometries.hitMobile
    : point.isMine
      ? geometries.hitDesktopMine
      : geometries.hitDesktop;
  const pointColor = getPointColor(point);
  const outerHaloScale = starProfile.haloScale;
  const coreScale = starProfile.coreScale;
  const innerHaloScale = starProfile.innerHaloScale;
  const haloOpacity = starProfile.haloOpacity * detailOpacityScale;
  const innerHaloOpacity = starProfile.innerHaloOpacity * detailOpacityScale;
  const burstOpacity = starProfile.burstOpacity * detailOpacityScale;
  const hoverRingScale = (visibleRadius / signalVisibleRadius) * (isMobileHitArea ? 1.12 : 1);

  useFrame(({ camera }, delta) => {
    elapsedRef.current += delta;

    if (selectedRingRef.current !== null) {
      const pulse = 1 + Math.sin(elapsedRef.current * 2.8) * 0.08;
      selectedRingRef.current.scale.setScalar(pulse * hoverRingScale);
      selectedRingRef.current.quaternion.copy(camera.quaternion);
    }

    const alpha = 1 - Math.exp(-delta * 2.4);
    const twinkle =
      0.78 +
      Math.sin(
        elapsedRef.current * (1.05 + starProfile.twinkleSeed * 0.006) +
          starProfile.twinkleSeed,
      ) *
        0.18 +
      Math.sin(elapsedRef.current * 2.7 + starProfile.twinkleSeed * 0.37) * 0.06;
    const haloTargetOpacity = isDimmed
      ? haloOpacity * 0.12
      : isSelected
        ? Math.min(haloOpacity * 1.65 * twinkle, 0.36)
        : haloOpacity * twinkle;
    const innerHaloTargetOpacity = isDimmed
      ? innerHaloOpacity * 0.16
      : innerHaloOpacity * twinkle;
    const coreTargetOpacity = isDimmed
      ? starProfile.coreOpacity * 0.18
      : Math.min(1, starProfile.coreOpacity * (0.86 + twinkle * 0.22));
    const selectedRingTargetOpacity = isSelected ? 0.34 : 0;
    const burstTargetOpacity = isDimmed
      ? burstOpacity * 0.12
      : burstOpacity * twinkle;

    if (haloMaterialRef.current !== null) {
      haloMaterialRef.current.opacity = MathUtils.lerp(
        haloMaterialRef.current.opacity,
        haloTargetOpacity,
        alpha,
      );
    }

    if (innerHaloMaterialRef.current !== null) {
      innerHaloMaterialRef.current.opacity = MathUtils.lerp(
        innerHaloMaterialRef.current.opacity,
        innerHaloTargetOpacity,
        alpha,
      );
    }

    if (coreMaterialRef.current !== null) {
      coreMaterialRef.current.opacity = MathUtils.lerp(
        coreMaterialRef.current.opacity,
        coreTargetOpacity,
        alpha,
      );
    }

    if (selectedRingMaterialRef.current !== null) {
      selectedRingMaterialRef.current.opacity = MathUtils.lerp(
        selectedRingMaterialRef.current.opacity,
        selectedRingTargetOpacity,
        alpha,
      );
    }

    if (horizontalBurstMaterialRef.current !== null) {
      horizontalBurstMaterialRef.current.opacity = MathUtils.lerp(
        horizontalBurstMaterialRef.current.opacity,
        burstTargetOpacity,
        alpha,
      );
    }

    if (verticalBurstMaterialRef.current !== null) {
      verticalBurstMaterialRef.current.opacity = MathUtils.lerp(
        verticalBurstMaterialRef.current.opacity,
        burstTargetOpacity * 0.56,
        alpha,
      );
    }
  });

  return (
    <group dispose={null} position={[x, y, z]}>
      {glowTexture !== undefined ? (
        <sprite scale={[outerHaloScale, outerHaloScale, 1]}>
          <spriteMaterial
            ref={haloMaterialRef}
            blending={AdditiveBlending}
            color={pointColor}
            depthTest={false}
            map={glowTexture}
            opacity={isDimmed ? haloOpacity * 0.12 : haloOpacity}
            transparent
          />
        </sprite>
      ) : null}

      {glowTexture !== undefined ? (
        <sprite scale={[innerHaloScale, innerHaloScale, 1]}>
          <spriteMaterial
            ref={innerHaloMaterialRef}
            blending={AdditiveBlending}
            color="#ffffff"
            depthTest={false}
            map={glowTexture}
            opacity={isDimmed ? innerHaloOpacity * 0.16 : innerHaloOpacity}
            transparent
          />
        </sprite>
      ) : null}

      <mesh
        geometry={hitGeometry}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onSelect(point);
        }}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
        }}
      >
        <meshBasicMaterial color="#ffffff" depthTest={false} opacity={0} transparent />
      </mesh>

      {coreTexture !== undefined ? (
        <sprite scale={[coreScale, coreScale, 1]}>
          <spriteMaterial
            ref={coreMaterialRef}
            blending={AdditiveBlending}
            color={starCoreWhite}
            depthTest={false}
            map={coreTexture}
            opacity={isDimmed ? starProfile.coreOpacity * 0.18 : starProfile.coreOpacity}
            transparent
          />
        </sprite>
      ) : (
        <mesh scale={coreScale * 0.24}>
          <sphereGeometry args={[nodeCoreRadius, 16, 16]} />
          <meshBasicMaterial
            color="#ffffff"
            depthTest={false}
            opacity={isDimmed ? starProfile.coreOpacity * 0.18 : starProfile.coreOpacity}
            transparent
          />
        </mesh>
      )}

      {starProfile.isMajorStar ? (
        <lineSegments geometry={geometries.burstHorizontal} scale={starProfile.burstScale}>
          <lineBasicMaterial
            ref={horizontalBurstMaterialRef}
            blending={AdditiveBlending}
            color="#ffffff"
            depthTest={false}
            opacity={isDimmed ? burstOpacity * 0.12 : burstOpacity}
            transparent
          />
        </lineSegments>
      ) : null}

      {starProfile.isMajorStar ? (
        <lineSegments geometry={geometries.burstVertical} scale={starProfile.burstScale * 0.54}>
          <lineBasicMaterial
            ref={verticalBurstMaterialRef}
            blending={AdditiveBlending}
            color={pointColor}
            depthTest={false}
            opacity={isDimmed ? burstOpacity * 0.08 : burstOpacity * 0.56}
            transparent
          />
        </lineSegments>
      ) : null}

      {isSelected ? (
        <mesh
          geometry={point.isMine ? geometries.selectedMine : geometries.selected}
          ref={selectedRingRef}
          scale={hoverRingScale}
        >
          <meshBasicMaterial
            ref={selectedRingMaterialRef}
            blending={AdditiveBlending}
            color="#ffffff"
            depthTest={false}
            opacity={0.34}
            side={DoubleSide}
            transparent
          />
        </mesh>
      ) : null}
    </group>
  );
}
