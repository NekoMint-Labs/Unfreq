// Match the existing login aliases without inventing a second limiter identity.
export function normalizeFrequencyCode(frequencyCode: string): string {
  const compact = frequencyCode.trim().toUpperCase().replace(/^FM[\s-]*/, "");
  return `FM ${compact}`;
}

export function createFrequencyCodeCandidates(frequencyCode: string): string[] {
  const normalized = normalizeFrequencyCode(frequencyCode);
  return [normalized, normalized.replace(/^FM /u, "FM-")];
}
