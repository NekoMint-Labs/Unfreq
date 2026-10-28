import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { env } from "../../config/env.js";

function resolveAudioPath(storageKey: string): string {
  const rootPath = resolve(env.ttsStorageDir);
  const filePath = resolve(rootPath, storageKey);

  if (!filePath.startsWith(`${rootPath}${sep}`)) {
    throw new Error("Invalid signal audio storage key.");
  }

  return filePath;
}

export function buildSignalAudioStorageKey(
  signalId: string,
  channel: "left" | "main" | "right",
): string {
  if (channel === "main") {
    return `${signalId}.mp3`;
  }

  return `${signalId}-${channel}.mp3`;
}

export async function writeSignalAudio(storageKey: string, data: Buffer): Promise<void> {
  await mkdir(resolve(env.ttsStorageDir), { recursive: true });
  await writeFile(resolveAudioPath(storageKey), data, { flag: "wx" });
}

export async function readSignalAudio(storageKey: string) {
  const filePath = resolveAudioPath(storageKey);

  await access(filePath);

  return createReadStream(filePath);
}
