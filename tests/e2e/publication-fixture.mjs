import { createHash } from "node:crypto";
const labels = { meaning_deep_space: "意义深空", relationship_nebula: "关系星云" };
export function content(signal) {
  const primaryBand = signal.frequencyProfile.primaryBand;
  return { expandedText: signal.expandedText, authorFreqCode: signal.authorFreqCode,
    tags: [labels[primaryBand], ...signal.fingerprint.tags.slice(0, 2)], primaryBand };
}
export function preview(signal) {
  const value = content(signal);
  return { content: value, digest: createHash("sha256").update(JSON.stringify(value)).digest("hex"), version: signal.publicationVersion ?? 1 };
}
export function publicMatch(signal) {
  return { ...content(signal), id: signal.id, score: signal.score ?? 1, source: "PUBLISHED", resonanceCount: signal.resonanceCount, publicationVersion: signal.publicationVersion ?? 1 };
}
export function publicView(signal) {
  return { ...content(signal), id: signal.id, createdAt: signal.createdAt, updatedAt: signal.updatedAt,
    publishedAt: signal.updatedAt, publicationVersion: signal.publicationVersion ?? 1,
    status: "PUBLISHED", visibility: "PUBLIC", echoCount: signal.echoCount, resonanceCount: signal.resonanceCount,
    source: signal.source, hasSaved: signal.hasSaved, matches: (signal.matches ?? []).map((match) => ({ expandedText: match.expandedText,
      authorFreqCode: match.authorFreqCode ?? match.frequencyCode, tags: ["意义深空", "忙碌"], primaryBand: "meaning_deep_space",
      id: match.id, score: match.score, source: "PUBLISHED", resonanceCount: match.resonanceCount, publicationVersion: 1 })) };
}
export function ownerView(signal) {
  const state = signal.withdrawn ? "WITHDRAWN" : signal.status === "PUBLISHED" ? "PUBLIC" : "DRAFT";
  return { ...signal, visibility: "PRIVATE_OWNER", matches: state === "PUBLIC" ? publicView(signal).matches : [],
    publication: { state, version: signal.publicationVersion ?? 1, canPublish: state !== "PUBLIC", canWithdraw: !signal.withdrawn,
      preview: preview(signal), ...(state === "PUBLIC" ? { publishedContent: content(signal) } : {}) } };
}
export function galaxyPoint(signal, isMine, matchIds = []) {
  return { ...content(signal), id: signal.id, createdAt: signal.createdAt, publicationVersion: signal.publicationVersion ?? 1,
    isMine, matchIds, position: signal.galaxyPosition, resonanceCount: signal.resonanceCount, source: signal.source };
}
