import { ApiClientError } from "./api-client";
/** An explicit visibility/version denial must not become local speech playback. */
export function allowsBrowserSpeechFallback(error: unknown): boolean {
  return !(error instanceof ApiClientError && [401, 403, 404, 409].includes(error.status));
}
