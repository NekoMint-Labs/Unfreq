import { createReadStream } from "node:fs";
import { access, mkdir, open, unlink } from "node:fs/promises";
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
  attemptId?: string,
): string {
  if (attemptId !== undefined) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (!uuid.test(signalId) || !uuid.test(attemptId)) throw new Error("Invalid signal audio attempt.");
    return `${signalId}-${attemptId}-${channel}.mp3`;
  }
  if (channel === "main") {
    return `${signalId}.mp3`;
  }

  return `${signalId}-${channel}.mp3`;
}

export async function writeSignalAudio(storageKey: string, data: Buffer,
  options: { signal?: AbortSignal; onCreated?: () => void } = {}): Promise<void> {
  await mkdir(resolve(env.ttsStorageDir), { recursive: true });
  options.signal?.throwIfAborted();
  // wx proves creation belongs to this caller. EEXIST never invokes onCreated,
  // while a later abort/write error can still leave an owned partial file.
  const file = await open(resolveAudioPath(storageKey), "wx");
  try {
    options.onCreated?.();
    await file.writeFile(data, { signal: options.signal });
  } finally { await file.close(); }
}

/** Only call for the current attempt's private file after a definitive non-reference decision. */
export async function removeSignalAudio(storageKey: string): Promise<void> {
  try { await unlink(resolveAudioPath(storageKey)); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
}

export async function readSignalAudio(storageKey: string) {
  const filePath = resolveAudioPath(storageKey);

  await access(filePath);

  return createReadStream(filePath);
}
