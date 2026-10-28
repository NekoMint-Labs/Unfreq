import { CanvasTexture, MathUtils } from "three";
import { pseudoRandom } from "./galaxy-layout";

export function createGlowTexture(): CanvasTexture | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");

  if (context === null) {
    return undefined;
  }

  const imageData = context.createImageData(canvas.width, canvas.height);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const pixelIndex = index / 4;
    const x = (pixelIndex % canvas.width) - canvas.width / 2;
    const y = Math.floor(pixelIndex / canvas.width) - canvas.height / 2;
    const angle = Math.atan2(y, x);
    const radius = Math.sqrt(x * x + y * y) / (canvas.width / 2);
    const warp =
      1 +
      Math.sin(angle * 5.1 + 0.7) * 0.045 +
      Math.sin(angle * 9.3 + 1.9) * 0.032;
    const normalizedRadius = radius * warp;
    const edgeFade = MathUtils.clamp(1 - Math.max(0, normalizedRadius - 0.78) * 4.8, 0, 1);
    const core = Math.exp(-(normalizedRadius * normalizedRadius) * 48);
    const mid = Math.exp(-(normalizedRadius * normalizedRadius) * 9.5) * 0.34;
    const outer = Math.exp(-(normalizedRadius * normalizedRadius) * 2.2) * 0.11;
    const grain = 0.84 + pseudoRandom(pixelIndex + 23) * 0.24;
    const alpha = MathUtils.clamp((core + mid + outer) * edgeFade * grain, 0, 1);

    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = Math.floor(alpha * 255);
  }

  context.putImageData(imageData, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}

export function createStarCoreTexture(): CanvasTexture | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");

  if (context === null) {
    return undefined;
  }

  const imageData = context.createImageData(canvas.width, canvas.height);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const pixelIndex = index / 4;
    const x = (pixelIndex % canvas.width) - canvas.width / 2;
    const y = Math.floor(pixelIndex / canvas.width) - canvas.height / 2;
    const angle = Math.atan2(y, x);
    const radius = Math.sqrt(x * x + y * y) / (canvas.width / 2);
    const warp =
      1 +
      Math.sin(angle * 7.2 + 0.3) * 0.055 +
      Math.sin(angle * 13.4 + 2.1) * 0.035;
    const normalizedRadius = radius * warp;
    const core = Math.exp(-(normalizedRadius * normalizedRadius) * 310);
    const corona = Math.exp(-(normalizedRadius * normalizedRadius) * 34) * 0.62;
    const scatter = Math.exp(-(normalizedRadius * normalizedRadius) * 8.5) * 0.16;
    const grain = 0.88 + pseudoRandom(pixelIndex + 71) * 0.2;
    const alpha = MathUtils.clamp((core + corona + scatter) * grain, 0, 1);

    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = Math.floor(alpha * 255);
  }

  context.putImageData(imageData, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}

export function createNebulaTexture(): CanvasTexture | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;

  const context = canvas.getContext("2d");

  if (context === null) {
    return undefined;
  }

  const baseGradient = context.createRadialGradient(116, 132, 8, 116, 132, 124);
  baseGradient.addColorStop(0, "rgba(210,225,255,0.2)");
  baseGradient.addColorStop(0.26, "rgba(142,166,226,0.12)");
  baseGradient.addColorStop(0.58, "rgba(98,128,184,0.05)");
  baseGradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = baseGradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const warmGradient = context.createRadialGradient(166, 92, 6, 166, 92, 102);
  warmGradient.addColorStop(0, "rgba(245,201,120,0.1)");
  warmGradient.addColorStop(0.36, "rgba(245,167,191,0.055)");
  warmGradient.addColorStop(1, "rgba(0,0,0,0)");
  context.globalCompositeOperation = "screen";
  context.fillStyle = warmGradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const pixelIndex = index / 4;
    const noise = pseudoRandom(pixelIndex + 17);
    imageData.data[index + 3] = Math.floor(imageData.data[index + 3] * (0.62 + noise * 0.52));
  }

  context.putImageData(imageData, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}
