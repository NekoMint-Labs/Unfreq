import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import { env } from "../../config/env.js";
import type { CreateImageBody, ImageMimeType } from "./schemas.js";
import {
  createImageRecordWithDailyLimit,
  findImageRecordById,
  ImageUploadLimitExceeded,
} from "./repository.js";
import { readStoredImage, removeStoredImage, writeStoredImage } from "./storage.js";
import type { HostedImage, ImageDownload, ImageRecord } from "./types.js";

const maxDailyImageUploadCount = 20;

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const extensionByMimeType: Record<ImageMimeType, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function decodeBase64Image(contentBase64: string): Buffer {
  if (!base64Pattern.test(contentBase64)) {
    throw new AppError("VALIDATION_ERROR", "Invalid request.", {
      field: "contentBase64",
      reason: "INVALID_BASE64",
    });
  }

  const data = Buffer.from(contentBase64, "base64");

  if (data.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Invalid request.", {
      field: "contentBase64",
      reason: "EMPTY_IMAGE",
    });
  }

  return data;
}

function hasImageSignature(data: Buffer, mimeType: ImageMimeType): boolean {
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (mimeType === "image/gif") {
    const signature = data.subarray(0, 6).toString("ascii");

    return signature === "GIF87a" || signature === "GIF89a";
  }

  return data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP";
}

function assertValidImageData(data: Buffer, mimeType: ImageMimeType) {
  if (data.length > env.imageMaxBytes) {
    throw new AppError("VALIDATION_ERROR", "Invalid request.", {
      limit: env.imageMaxBytes,
      reason: "IMAGE_TOO_LARGE",
      sizeBytes: data.length,
    });
  }

  if (!hasImageSignature(data, mimeType)) {
    throw new AppError("VALIDATION_ERROR", "Invalid request.", {
      field: "mimeType",
      reason: "MIME_SIGNATURE_MISMATCH",
    });
  }
}

function toHostedImage(record: ImageRecord): HostedImage {
  return {
    ...(record.altText === null ? {} : { altText: record.altText }),
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    url: `/api/images/${record.id}`,
  };
}

export async function createImage(
  frequency: AuthenticatedFrequency,
  body: CreateImageBody,
): Promise<HostedImage> {
  if (frequency.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "This frequency cannot upload images now.");
  }

  const imageData = decodeBase64Image(body.contentBase64);
  assertValidImageData(imageData, body.mimeType);

  const id = randomUUID();
  const storageKey = `${id}.${extensionByMimeType[body.mimeType]}`;

  await writeStoredImage(storageKey, imageData);

  try {
    const record = await createImageRecordWithDailyLimit({
      altText: body.altText,
      id,
      maxDailyCount: maxDailyImageUploadCount,
      mimeType: body.mimeType,
      sizeBytes: imageData.length,
      storageKey,
      uploaderId: frequency.id,
    });

    return toHostedImage(record);
  } catch (error) {
    await removeStoredImage(storageKey);

    if (error instanceof ImageUploadLimitExceeded) {
      throw new AppError("RATE_LIMITED", "Daily image upload limit reached.", {
        limit: maxDailyImageUploadCount,
        limitType: "IMAGE_UPLOAD",
      });
    }

    throw error;
  }
}

export async function getImageDownload(id: string): Promise<ImageDownload> {
  const record = await findImageRecordById(id);

  if (record === undefined) {
    throw new AppError("NOT_FOUND", "Image not found.");
  }

  try {
    const stream = await readStoredImage(record.storageKey);

    return {
      record,
      stream,
    };
  } catch {
    throw new AppError("NOT_FOUND", "Image not found.", {
      imageId: id,
      reason: "STORED_FILE_MISSING",
    });
  }
}
