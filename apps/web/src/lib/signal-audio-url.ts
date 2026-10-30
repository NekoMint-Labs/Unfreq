/** Resolve API-relative audio paths against the same base used by JSON requests. */
export function resolveSignalAudioUrl(value: string, apiBaseUrl: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  const base = apiBaseUrl.replace(/\/+$/u, "");
  const path = value.startsWith("/") ? value : `/${value}`;
  return `${base}${base.endsWith("/api") && path.startsWith("/api/") ? path.slice(4) : path}`;
}
