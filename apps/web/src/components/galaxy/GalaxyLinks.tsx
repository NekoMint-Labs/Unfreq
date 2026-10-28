"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  type LineBasicMaterial,
  MathUtils,
} from "three";
import type { GalaxySignalPoint } from "@unfreq/contracts";
import { buildGalaxyLineBucketLayouts, type GalaxyLineBudget } from "./galaxy-layout";

type GalaxyLineBucketData = {
  color: string;
  geometry: BufferGeometry;
  id: string;
  lineWidth: number;
  opacity: number;
};

function GalaxyLineBucket({
  color,
  geometry,
  isMuted,
  lineWidth,
  opacity,
}: {
  color: string;
  geometry: BufferGeometry;
  isMuted: boolean;
  lineWidth: number;
  opacity: number;
}) {
  const materialRef = useRef<LineBasicMaterial>(null);
  const haloMaterialRef = useRef<LineBasicMaterial>(null);

  useFrame((_, delta) => {
    const targetOpacity = isMuted ? opacity * 0.1 : opacity;
    const alpha = 1 - Math.exp(-delta * 2.2);

    if (materialRef.current !== null) {
      materialRef.current.opacity = MathUtils.lerp(
        materialRef.current.opacity,
        targetOpacity,
        alpha,
      );
    }

    if (haloMaterialRef.current !== null) {
      haloMaterialRef.current.opacity = MathUtils.lerp(
        haloMaterialRef.current.opacity,
        targetOpacity * 0.28,
        alpha,
      );
    }
  });

  return (
    <>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          ref={haloMaterialRef}
          blending={AdditiveBlending}
          color="#9fb0c9"
          depthTest={false}
          linewidth={lineWidth + 0.8}
          opacity={(isMuted ? opacity * 0.1 : opacity) * 0.28}
          transparent
        />
      </lineSegments>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          ref={materialRef}
          blending={AdditiveBlending}
          color={color}
          depthTest={false}
          linewidth={lineWidth}
          opacity={isMuted ? opacity * 0.1 : opacity}
          transparent
        />
      </lineSegments>
    </>
  );
}

export function GalaxyLinks({
  budget,
  isMuted,
  points,
}: {
  budget?: GalaxyLineBudget;
  isMuted: boolean;
  points: GalaxySignalPoint[];
}) {
  const lineBuckets = useMemo(() => {
    return buildGalaxyLineBucketLayouts(points, budget).map<GalaxyLineBucketData>((bucket) => {
      const nextGeometry = new BufferGeometry();
      nextGeometry.setAttribute("position", new Float32BufferAttribute(bucket.positions, 3));

      return {
        color: bucket.color,
        geometry: nextGeometry,
        id: bucket.id,
        lineWidth: bucket.lineWidth,
        opacity: bucket.opacity,
      };
    });
  }, [budget, points]);

  useEffect(() => {
    return () => {
      lineBuckets.forEach((bucket) => {
        bucket.geometry.dispose();
      });
    };
  }, [lineBuckets]);

  return (
    <>
      {lineBuckets.map((bucket) => {
        if ((bucket.geometry.getAttribute("position")?.count ?? 0) === 0) {
          return null;
        }

        return (
          <GalaxyLineBucket
            color={bucket.color}
            geometry={bucket.geometry}
            isMuted={isMuted}
            key={bucket.id}
            lineWidth={bucket.lineWidth}
            opacity={bucket.opacity}
          />
        );
      })}
    </>
  );
}
