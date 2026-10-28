import { createReadStream } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { env } from "../../config/env.js";

function resolveStoragePath(storageKey: string): string {
  const rootPath = resolve(env.imageStorageDir);
  const filePath = resolve(rootPath, storageKey);

  if (!filePath.startsWith(`${rootPath}${sep}`)) {
    throw new Error("Invalid image storage key.");
  }

  return filePath;
}

export async function writeStoredImage(storageKey: string, data: Buffer): Promise<void> {
  await mkdir(resolve(env.imageStorageDir), { recursive: true });
  await writeFile(resolveStoragePath(storageKey), data, { flag: "wx" });
}

export async function readStoredImage(storageKey: string) {
  const filePath = resolveStoragePath(storageKey);

  await access(filePath);

  return createReadStream(filePath);
}

export async function removeStoredImage(storageKey: string): Promise<void> {
  await rm(resolveStoragePath(storageKey), { force: true });
}
