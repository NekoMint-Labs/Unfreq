const fallbackApiBaseUrl = "http://localhost:4000";

const isAbsoluteUrl = (value: string): boolean => {
  return value.startsWith("http://") || value.startsWith("https://");
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const publicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? fallbackApiBaseUrl;

export const env = {
  publicApiBaseUrl: normalizeBaseUrl(publicApiBaseUrl),
  serverApiBaseUrl: normalizeBaseUrl(
    process.env.API_INTERNAL_BASE_URL ??
      (isAbsoluteUrl(publicApiBaseUrl) ? publicApiBaseUrl : fallbackApiBaseUrl),
  ),
} as const;
