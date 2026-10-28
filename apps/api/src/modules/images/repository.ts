import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { dailyLimits, images } from "../../db/schema.js";
import type { ImageMimeType } from "./schemas.js";
import type { ImageRecord } from "./types.js";

type ImageRow = typeof images.$inferSelect;

function toImageRecord(row: ImageRow): ImageRecord {
  return {
    altText: row.altText,
    createdAt: row.createdAt,
    id: row.id,
    mimeType: row.mimeType as ImageMimeType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    updatedAt: row.updatedAt,
    uploaderId: row.uploaderId,
  };
}

export class ImageUploadLimitExceeded extends Error {
  count: number;

  constructor(count: number) {
    super("Image upload daily limit exceeded.");
    this.name = "ImageUploadLimitExceeded";
    this.count = count;
  }
}

function getUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function createImageRecordWithDailyLimit(input: {
  altText?: string;
  id: string;
  maxDailyCount: number;
  mimeType: ImageMimeType;
  sizeBytes: number;
  storageKey: string;
  uploaderId: string;
}): Promise<ImageRecord> {
  return db.transaction(async (tx) => {
    const today = getUtcDateKey(new Date());
    const [limitRow] = await tx
      .insert(dailyLimits)
      .values({
        count: 1,
        limitDate: today,
        limitType: "IMAGE_UPLOAD",
        userId: input.uploaderId,
      })
      .onConflictDoUpdate({
        set: {
          count: sql`${dailyLimits.count} + 1`,
          updatedAt: new Date(),
        },
        target: [dailyLimits.userId, dailyLimits.limitType, dailyLimits.limitDate],
      })
      .returning({
        count: dailyLimits.count,
      });

    if (limitRow === undefined || limitRow.count > input.maxDailyCount) {
      throw new ImageUploadLimitExceeded(limitRow?.count ?? input.maxDailyCount + 1);
    }

    const [row] = await tx
      .insert(images)
      .values({
        altText: input.altText,
        id: input.id,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        uploaderId: input.uploaderId,
      })
      .returning();

    if (row === undefined) {
      throw new Error("Image insert returned no row.");
    }

    return toImageRecord(row);
  });
}

export async function findImageRecordById(id: string): Promise<ImageRecord | undefined> {
  const [row] = await db.select().from(images).where(eq(images.id, id)).limit(1);

  return row === undefined ? undefined : toImageRecord(row);
}
