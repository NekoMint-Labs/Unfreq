import type { ReadStream } from "node:fs";
import type { ImageMimeType } from "./schemas.js";

export type ImageRecord = {
  altText: string | null;
  createdAt: Date;
  id: string;
  mimeType: ImageMimeType;
  sizeBytes: number;
  storageKey: string;
  updatedAt: Date;
  uploaderId: string;
};

export type HostedImage = {
  altText?: string;
  createdAt: string;
  id: string;
  mimeType: ImageMimeType;
  sizeBytes: number;
  url: string;
};

export type ImageDownload = {
  record: ImageRecord;
  stream: ReadStream;
};
