"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  type CanvasTexture,
  Float32BufferAttribute,
  MathUtils,
  type PointsMaterial,
  type SpriteMaterial,
} from "three";
import { pseudoRandom } from "./galaxy-layout";

export function GalaxyDust({ count, isMuted }: { count: number; isMuted: boolean }) {
  const materialRef = useRef<PointsMaterial>(null);
  const geometry = useMemo(() => {
    const colors: number[] = [];
    const positions: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const depth = pseudoRandom(index + count * 3 + 1);
      const colorMix = pseudoRandom(index + count * 4 + 1);
      const depthBand = depth < 0.28 ? 0.46 : depth < 0.7 ? 1 : 1.62;
      const zLayer = depth < 0.28 ? -1 : depth < 0.7 ? 0 : 1;
      const zNoise = (pseudoRandom(index + count * 2 + 1) - 0.5) * (7 + depthBand * 8.5);
      positions.push(
        (pseudoRandom(index + 1) - 0.5) * (15 + depthBand * 6.8) + zLayer * 1.45,
        (pseudoRandom(index + count + 1) - 0.5) * (8.8 + depthBand * 3.8) + zLayer * 0.42,
        zNoise + zLayer * 7.4,
      );

      if (colorMix > 0.78) {
        colors.push(0.56, 0.66, 0.9);
      } else if (colorMix > 0.48) {
        colors.push(0.66, 0.68, 0.72);
      } else {
        colors.push(0.32, 0.35, 0.45);
      }
    }

    const nextGeometry = new BufferGeometry();
    nextGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    nextGeometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return nextGeometry;
  }, [count]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    if (materialRef.current === null) {
      return;
    }

    const targetOpacity = isMuted ? 0.014 : 0.088;
    const alpha = 1 - Math.exp(-delta * 2.2);
    materialRef.current.opacity = MathUtils.lerp(
      materialRef.current.opacity,
      targetOpacity,
      alpha,
    );
  });

  return (
    <points geometry={geometry}>
      <pointsMaterial
        ref={materialRef}
        blending={AdditiveBlending}
        depthTest={false}
        opacity={isMuted ? 0.018 : 0.076}
        size={0.018}
        sizeAttenuation
        transparent
        vertexColors
      />
    </points>
  );
}

export function GalaxyDistantStars({
  count,
  isMuted,
  isMobileHitArea,
}: {
  count: number;
  isMobileHitArea: boolean;
  isMuted: boolean;
}) {
  const materialRef = useRef<PointsMaterial>(null);
  const geometry = useMemo(() => {
    const colors: number[] = [];
    const positions: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const radius = 20 + pseudoRandom(index + 121) * 30;
      const theta = pseudoRandom(index + 227) * Math.PI * 2;
      const phi = Math.acos(pseudoRandom(index + 331) * 2 - 1);
      const colorMix = pseudoRandom(index + 443);

      positions.push(
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.cos(phi) * radius * 0.74,
        Math.sin(phi) * Math.sin(theta) * radius,
      );

      if (colorMix > 0.78) {
        colors.push(0.86, 0.78, 0.62);
      } else if (colorMix > 0.48) {
        colors.push(0.62, 0.72, 0.92);
      } else {
        colors.push(0.74, 0.8, 0.92);
      }
    }

    const nextGeometry = new BufferGeometry();
    nextGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    nextGeometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return nextGeometry;
  }, [count]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    if (materialRef.current === null) {
      return;
    }

    const targetOpacity = isMuted ? 0.055 : isMobileHitArea ? 0.26 : 0.3;
    const alpha = 1 - Math.exp(-delta * 1.8);
    materialRef.current.opacity = MathUtils.lerp(
      materialRef.current.opacity,
      targetOpacity,
      alpha,
    );
  });

  return (
    <points geometry={geometry}>
      <pointsMaterial
        ref={materialRef}
        blending={AdditiveBlending}
        depthTest={false}
        opacity={isMuted ? 0.055 : isMobileHitArea ? 0.26 : 0.3}
        size={isMobileHitArea ? 0.021 : 0.016}
        sizeAttenuation
        transparent
        vertexColors
      />
    </points>
  );
}

export function GalaxyNebula({
  isMuted,
  texture,
}: {
  isMuted: boolean;
  texture?: CanvasTexture;
}) {
  const materialRef = useRef<SpriteMaterial>(null);
  const elapsedRef = useRef(0);

  useFrame((_, delta) => {
    elapsedRef.current += delta;

    if (materialRef.current === null) {
      return;
    }

    const drift = Math.sin(elapsedRef.current * 0.12) * 0.025;
    const targetOpacity = isMuted ? 0.08 : 0.18 + drift;
    const alpha = 1 - Math.exp(-delta * 1.6);
    materialRef.current.opacity = MathUtils.lerp(
      materialRef.current.opacity,
      targetOpacity,
      alpha,
    );
  });

  if (texture === undefined) {
    return null;
  }

  return (
    <>
      <sprite position={[-4.8, 1.2, -8.5]} scale={[13.5, 8.2, 1]}>
        <spriteMaterial
          ref={materialRef}
          blending={AdditiveBlending}
          color="#aebcff"
          depthTest={false}
          map={texture}
          opacity={isMuted ? 0.06 : 0.16}
          transparent
        />
      </sprite>
      <sprite position={[6.2, -1.4, -15.5]} scale={[18, 10.4, 1]}>
        <spriteMaterial
          blending={AdditiveBlending}
          color="#f5c978"
          depthTest={false}
          map={texture}
          opacity={isMuted ? 0.028 : 0.07}
          transparent
        />
      </sprite>
    </>
  );
}

export function GalaxyDepthMist({
  isMuted,
  texture,
}: {
  isMuted: boolean;
  texture?: CanvasTexture;
}) {
  if (texture === undefined) {
    return null;
  }

  return (
    <>
      <sprite position={[0, 0.12, -6.8]} scale={[15, 8.8, 1]}>
        <spriteMaterial
          blending={AdditiveBlending}
          color="#5d6f96"
          depthTest={false}
          map={texture}
          opacity={isMuted ? 0.018 : 0.052}
          transparent
        />
      </sprite>
      <sprite position={[0.8, -0.25, 6.1]} scale={[13.2, 7.6, 1]}>
        <spriteMaterial
          blending={AdditiveBlending}
          color="#202638"
          depthTest={false}
          map={texture}
          opacity={isMuted ? 0.01 : 0.038}
          transparent
        />
      </sprite>
      <sprite position={[-2.4, 0.48, 12.2]} scale={[9.6, 5.8, 1]}>
        <spriteMaterial
          blending={AdditiveBlending}
          color="#151927"
          depthTest={false}
          map={texture}
          opacity={isMuted ? 0.008 : 0.026}
          transparent
        />
      </sprite>
    </>
  );
}
