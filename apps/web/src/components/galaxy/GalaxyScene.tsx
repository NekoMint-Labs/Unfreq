"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Group, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { GalaxySignalPoint } from "@unfreq/contracts";
import {
  GalaxyDepthMist,
  GalaxyDistantStars,
  GalaxyDust,
  GalaxyNebula,
} from "./GalaxyBackdrop";
import { GalaxyLinks } from "./GalaxyLinks";
import { GalaxySignalNode } from "./GalaxySignalNode";
import {
  toScenePosition,
  type GalaxyPerformanceProfile,
  type ScenePosition,
} from "./galaxy-layout";
import {
  createGalaxyNodeGeometries,
  galaxyBaseTiltX,
  galaxyBaseTiltY,
  galaxyBaseTiltZ,
  maxCameraDistance,
  minCameraDistance,
} from "./galaxy-scene-constants";
import {
  createGlowTexture,
  createNebulaTexture,
  createStarCoreTexture,
} from "./galaxy-textures";

type GalaxySceneProps = {
  detailPoint?: GalaxySignalPoint;
  isMobileHitArea: boolean;
  onSelect: (point: GalaxySignalPoint) => void;
  performanceProfile: GalaxyPerformanceProfile;
  points: GalaxySignalPoint[];
  selectedId?: string;
};

export function GalaxyScene({
  cameraFov,
  cameraPosition,
  detailPoint,
  isMobileHitArea,
  onSelect,
  performanceProfile,
  points,
  sceneScale,
  selectedId,
  selectedPoint,
}: GalaxySceneProps & {
  cameraFov: number;
  cameraPosition: ScenePosition;
  sceneScale: number;
  selectedPoint?: GalaxySignalPoint;
}) {
  const focusRef = useRef(new Vector3(0, 0, 0));
  const geometries = useMemo(() => createGalaxyNodeGeometries(), []);
  const groupRef = useRef<Group>(null);
  const coreTexture = useMemo(() => createStarCoreTexture(), []);
  const glowTexture = useMemo(() => createGlowTexture(), []);
  const nebulaTexture = useMemo(() => createNebulaTexture(), []);
  const localFocusRef = useRef(new Vector3(0, 0, 0));
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const [cameraX, cameraY, cameraZ] = cameraPosition;
  const appliedRestCameraPositionRef = useRef({ x: cameraX, y: cameraY, z: cameraZ });
  const resumeRotationTimeoutRef = useRef<number | undefined>(undefined);
  const targetPositionRef = useRef(new Vector3(...cameraPosition));
  const [isAutoRotating, setIsAutoRotating] = useState(true);
  const hasDetail = detailPoint !== undefined;
  const detailOpacityScale = performanceProfile.usesLowDetailEffects ? 0.72 : 1;

  useEffect(() => {
    return () => {
      Object.values(geometries).forEach((geometry) => {
        geometry.dispose();
      });
    };
  }, [geometries]);

  useEffect(() => {
    return () => {
      coreTexture?.dispose();
      glowTexture?.dispose();
      nebulaTexture?.dispose();
    };
  }, [coreTexture, glowTexture, nebulaTexture]);

  const pauseAutoRotation = useCallback(() => {
    setIsAutoRotating(false);

    if (resumeRotationTimeoutRef.current !== undefined) {
      window.clearTimeout(resumeRotationTimeoutRef.current);
    }

    resumeRotationTimeoutRef.current = window.setTimeout(() => {
      setIsAutoRotating(true);
      resumeRotationTimeoutRef.current = undefined;
    }, 4_000);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeRotationTimeoutRef.current !== undefined) {
        window.clearTimeout(resumeRotationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;

    if (controls === null) {
      return;
    }

    controls.addEventListener("start", pauseAutoRotation);
    controls.addEventListener("change", pauseAutoRotation);

    return () => {
      controls.removeEventListener("start", pauseAutoRotation);
      controls.removeEventListener("change", pauseAutoRotation);
    };
  }, [pauseAutoRotation]);

  useFrame(({ camera }, delta) => {
    const appliedRestCameraPosition = appliedRestCameraPositionRef.current;

    if (
      selectedPoint === undefined &&
      (appliedRestCameraPosition.x !== cameraX ||
        appliedRestCameraPosition.y !== cameraY ||
        appliedRestCameraPosition.z !== cameraZ)
    ) {
      camera.position.set(cameraX, cameraY, cameraZ);
      controlsRef.current?.target.set(0, 0, 0);
      controlsRef.current?.update();
      appliedRestCameraPositionRef.current = { x: cameraX, y: cameraY, z: cameraZ };
    }

    if (groupRef.current === null) {
      return;
    }

    groupRef.current.updateMatrixWorld();

    if (selectedPoint !== undefined) {
      const [x, y, z] = toScenePosition(selectedPoint);
      localFocusRef.current.set(x, y, z);
      groupRef.current.localToWorld(focusRef.current.copy(localFocusRef.current));
      const sideOffset = isMobileHitArea ? 0.42 : 0.72;
      const heightOffset = isMobileHitArea ? 0.86 : 1.2;
      const depthOffset = isMobileHitArea ? 6.4 : 5.2;
      targetPositionRef.current.set(
        focusRef.current.x * 0.72 + sideOffset,
        focusRef.current.y * 0.72 + heightOffset,
        focusRef.current.z + depthOffset,
      );
    }

    if (selectedPoint !== undefined) {
      const alpha = 1 - Math.exp(-delta * 2.05);
      camera.position.lerp(targetPositionRef.current, alpha);
      controlsRef.current?.target.lerp(focusRef.current, alpha);
    }

    if (!hasDetail && selectedPoint === undefined && isAutoRotating) {
      groupRef.current.rotation.y += delta * 0.043;
      groupRef.current.rotation.x =
        galaxyBaseTiltX + Math.sin(Date.now() * 0.00008) * 0.052;
      groupRef.current.rotation.z =
        galaxyBaseTiltZ + Math.sin(Date.now() * 0.00006) * 0.022;
    }

    controlsRef.current?.update();
  });

  return (
    <>
      <PerspectiveCamera
        far={1_000}
        fov={cameraFov}
        makeDefault
        near={0.1}
        position={cameraPosition}
      />
      <OrbitControls
        ref={controlsRef}
        dampingFactor={0.08}
        enableDamping
        enablePan={!hasDetail}
        enableRotate={!hasDetail}
        enableZoom={!hasDetail}
        maxDistance={maxCameraDistance}
        minDistance={minCameraDistance}
        panSpeed={0.72}
        rotateSpeed={0.48}
        target={[0, 0, 0]}
        zoomSpeed={0.72}
      />
      <GalaxyNebula isMuted={hasDetail} texture={nebulaTexture} />
      {performanceProfile.renderDepthMist ? (
        <GalaxyDepthMist isMuted={hasDetail} texture={nebulaTexture} />
      ) : null}
      <GalaxyDistantStars
        count={performanceProfile.distantStarCount}
        isMobileHitArea={isMobileHitArea}
        isMuted={hasDetail}
      />
      <group
        ref={groupRef}
        rotation={[galaxyBaseTiltX, galaxyBaseTiltY, galaxyBaseTiltZ]}
        scale={sceneScale}
      >
        <GalaxyDust count={performanceProfile.dustCount} isMuted={hasDetail} />
        <GalaxyLinks
          budget={{
            maxLinks: performanceProfile.maxLinks,
            maxMatchesPerPoint: performanceProfile.maxMatchesPerPoint,
          }}
          isMuted={hasDetail}
          points={points}
        />
        {points.map((point) => (
          <GalaxySignalNode
            coreTexture={coreTexture}
            detailOpacityScale={detailOpacityScale}
            geometries={geometries}
            glowTexture={glowTexture}
            isDimmed={
              hasDetail && point.id !== selectedId && point.id !== detailPoint?.id
            }
            isMobileHitArea={isMobileHitArea}
            isSelected={point.id === selectedId}
            key={point.id}
            onSelect={onSelect}
            point={point}
          />
        ))}
      </group>
    </>
  );
}
