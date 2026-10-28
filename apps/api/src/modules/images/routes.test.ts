import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { ImageRecord } from "./types.js";

const imageStores = vi.hoisted(() => {
  return {
    filesByStorageKey: new Map<string, Buffer>(),
    imagesById: new Map<string, ImageRecord>(),
    shouldHitDailyLimit: false,
  };
});

const activeFrequency: AuthenticatedFrequency = {
  createdAt: "2026-05-10T00:00:00.000Z",
  freqCode: "FM-27.51",
  id: "00000000-0000-4000-8000-000000000001",
  role: "USER",
  status: "ACTIVE",
};

const mutedFrequency: AuthenticatedFrequency = {
  ...activeFrequency,
  id: "00000000-0000-4000-8000-000000000002",
  status: "MUTED",
};

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

vi.mock("../auth/service.js", () => {
  return {
    authenticateSessionToken: vi.fn((token: string) => {
      if (token === "active-token") {
        return Promise.resolve(activeFrequency);
      }

      if (token === "muted-token") {
        return Promise.resolve(mutedFrequency);
      }

      return Promise.resolve(undefined);
    }),
    getSessionTtlSeconds: vi.fn(() => 60 * 60 * 24 * 30),
    loginWithEmail: vi.fn(),
  };
});

vi.mock("./repository.js", () => {
  class ImageUploadLimitExceeded extends Error {
    count: number;

    constructor(count: number) {
      super("Image upload daily limit exceeded.");
      this.name = "ImageUploadLimitExceeded";
      this.count = count;
    }
  }

  return {
    ImageUploadLimitExceeded,
    createImageRecordWithDailyLimit: vi.fn((input: {
      altText?: string;
      id: string;
      maxDailyCount: number;
      mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
      sizeBytes: number;
      storageKey: string;
      uploaderId: string;
    }) => {
      if (imageStores.shouldHitDailyLimit) {
        throw new ImageUploadLimitExceeded(input.maxDailyCount + 1);
      }

      const now = new Date("2026-05-12T08:00:00.000Z");
      const record: ImageRecord = {
        altText: input.altText ?? null,
        createdAt: now,
        id: input.id,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        updatedAt: now,
        uploaderId: input.uploaderId,
      };

      imageStores.imagesById.set(record.id, record);

      return Promise.resolve(record);
    }),
    findImageRecordById: vi.fn((id: string) => {
      return Promise.resolve(imageStores.imagesById.get(id));
    }),
  };
});

vi.mock("./storage.js", () => {
  return {
    readStoredImage: vi.fn((storageKey: string) => {
      const data = imageStores.filesByStorageKey.get(storageKey);

      if (data === undefined) {
        return Promise.reject(new Error("missing image"));
      }

      return Promise.resolve(Readable.from(data));
    }),
    removeStoredImage: vi.fn((storageKey: string) => {
      imageStores.filesByStorageKey.delete(storageKey);

      return Promise.resolve();
    }),
    writeStoredImage: vi.fn((storageKey: string, data: Buffer) => {
      imageStores.filesByStorageKey.set(storageKey, data);

      return Promise.resolve();
    }),
  };
});

let app: FastifyInstance | undefined;

beforeEach(() => {
  imageStores.filesByStorageKey.clear();
  imageStores.imagesById.clear();
  imageStores.shouldHitDailyLimit = false;
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("image routes", () => {
  it("requires a session before uploading an image", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        contentBase64: pngBytes.toString("base64"),
        mimeType: "image/png",
      },
      url: "/api/images",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("rejects uploads from inactive frequencies", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer muted-token",
      },
      method: "POST",
      payload: {
        contentBase64: pngBytes.toString("base64"),
        mimeType: "image/png",
      },
      url: "/api/images",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
  });

  it("uploads an image and serves it through the returned url", async () => {
    const testApp = await buildApp();
    app = testApp;

    const uploadResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        altText: "星河图片",
        contentBase64: pngBytes.toString("base64"),
        mimeType: "image/png",
      },
      url: "/api/images",
    });

    expect(uploadResponse.statusCode).toBe(201);

    const image = uploadResponse.json().data.image;
    expect(image).toMatchObject({
      altText: "星河图片",
      createdAt: "2026-05-12T08:00:00.000Z",
      id: expect.any(String),
      mimeType: "image/png",
      sizeBytes: pngBytes.length,
      url: expect.stringMatching(/^\/api\/images\//),
    });

    const fileResponse = await testApp.inject({
      method: "GET",
      url: image.url,
    });

    expect(fileResponse.statusCode).toBe(200);
    expect(fileResponse.headers["content-type"]).toContain("image/png");
    expect(fileResponse.rawPayload).toEqual(pngBytes);
  });

  it("rejects invalid base64 payloads", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        contentBase64: "not-base64!",
        mimeType: "image/png",
      },
      url: "/api/images",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("rejects mime types that do not match the image bytes", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        contentBase64: pngBytes.toString("base64"),
        mimeType: "image/jpeg",
      },
      url: "/api/images",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("rejects oversized images", async () => {
    const testApp = await buildApp();
    app = testApp;

    const oversizedPng = Buffer.concat([
      pngBytes.subarray(0, 8),
      Buffer.alloc(2 * 1024 * 1024),
    ]);

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        contentBase64: oversizedPng.toString("base64"),
        mimeType: "image/png",
      },
      url: "/api/images",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          reason: "IMAGE_TOO_LARGE",
        },
      },
    });
  });

  it("rejects uploads after the daily image limit is reached", async () => {
    const testApp = await buildApp();
    app = testApp;
    imageStores.shouldHitDailyLimit = true;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        contentBase64: pngBytes.toString("base64"),
        mimeType: "image/png",
      },
      url: "/api/images",
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: "RATE_LIMITED",
        details: {
          limitType: "IMAGE_UPLOAD",
        },
      },
    });
    expect(imageStores.filesByStorageKey.size).toBe(0);
  });

  it("returns not found for missing images", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "GET",
      url: "/api/images/00000000-0000-4000-8000-000000000099",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
      },
    });
  });
});
