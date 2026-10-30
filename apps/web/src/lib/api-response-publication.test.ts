import { afterEach, describe, expect, it, vi } from "vitest";
import { isSignalResponse, isSignalHallResponse, isSavedSignalsResponse, isGalaxyResponse, isSignalMatchesResponse, isPublicationPreview } from "./api-response-validators";
import { getPublicSignal, publishSignal } from "./signal-data";
const content = { expandedText: "作者确认的公开正文", authorFreqCode: "FM 10.01", tags: ["关系星云"], primaryBand: "relationship_nebula" };
const signal = { ...content, id: "synthetic-public", createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z", publishedAt: "2026-10-30T00:00:00Z", publicationVersion: 1, status: "PUBLISHED", visibility: "PUBLIC", echoCount: 0, resonanceCount: 0, source: "human", matches: [] };
const match = { ...content, id: signal.id, score: 1, source: "PUBLISHED", resonanceCount: 0, publicationVersion: 1 };
const saved = { ...content, id: signal.id, createdAt: signal.createdAt, savedAt: signal.createdAt, publicationVersion: 1, status: "PUBLISHED", resonanceCount: 0, source: "human" };
const point = { ...content, id: signal.id, createdAt: signal.createdAt, publicationVersion: 1, position: { x: 0, y: 0, z: 0 }, source: "human", isMine: false, matchIds: [], resonanceCount: 0 };
afterEach(() => vi.unstubAllGlobals());
describe("public publication contracts", () => {
  it("validates coverage counts and pins against the same public sample", () => {
    const coverage = { totalEligibleCount: 520, returnedCount: 1, sampleLimit: 80, samplingVersion: "recent-band-v1", filters: {}, focusStatus: "none" };
    const response = { generatedAt: signal.createdAt, points: [point], coverage };
    expect(isGalaxyResponse(response)).toBe(true);
    for (const change of [{ returnedCount: 2 }, { totalEligibleCount: 0 }, { sampleLimit: 81 }, { samplingVersion: "random" }, { latestOwnSignalId: point.id }, { focusStatus: "available" }, { focusSignalId: "private" }]) {
      expect(isGalaxyResponse({ ...response, coverage: { ...coverage, ...change } })).toBe(false);
    }
    expect(isGalaxyResponse({ ...response, points: [{ ...point, isMine: true }], coverage: { ...coverage, latestOwnSignalId: point.id } })).toBe(true);
    expect(isGalaxyResponse({ ...response, coverage: { ...coverage, focusStatus: "available", focusSignalId: point.id } })).toBe(true);
    expect(isGalaxyResponse({ ...response, coverage: { ...coverage, seedText: "private" } })).toBe(false);
  });
  it("accepts each whitelist projection", () => {
    expect(isSignalResponse({ signal })).toBe(true);
    expect(isSignalHallResponse({ signals: [signal] })).toBe(true);
    expect(isSignalMatchesResponse({ matches: [match] })).toBe(true);
    expect(isSavedSignalsResponse({ signals: [saved] })).toBe(true);
    expect(isGalaxyResponse({ generatedAt: signal.createdAt, points: [point] })).toBe(true);
  });
  it.each(["rawInput", "seedText", "fingerprint", "frequencyProfile", "program", "guestKey", "frequencyId"])("rejects leaked %s on all public projections", (key) => {
    expect(isSignalResponse({ signal: { ...signal, [key]: "PRIVATE" } })).toBe(false);
    expect(isSignalHallResponse({ signals: [{ ...signal, [key]: "PRIVATE" }] })).toBe(false);
    expect(isSignalMatchesResponse({ matches: [{ ...match, [key]: "PRIVATE" }] })).toBe(false);
    expect(isSavedSignalsResponse({ signals: [{ ...saved, [key]: "PRIVATE" }] })).toBe(false);
    expect(isGalaxyResponse({ generatedAt: signal.createdAt, points: [{ ...point, [key]: "PRIVATE" }] })).toBe(false);
  });
  it("refuses legacy public data and malformed preview labels", () => {
    expect(isSignalResponse({ signal: { ...signal, visibility: undefined } })).toBe(false);
    expect(isPublicationPreview({ content: { ...content, tags: ["另一标签"] }, version: 0, digest: "0".repeat(64) })).toBe(false);
  });
  it("fetches share data without viewer credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { signal }, meta: { requestId: "synthetic" } })));
    vi.stubGlobal("fetch", fetch);
    expect(await getPublicSignal(signal.id)).toEqual(signal);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", cache: "no-store" });
  });
  it("sends the exact displayed preview version and digest", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { signal }, meta: { requestId: "synthetic" } })));
    vi.stubGlobal("fetch", fetch);
    const confirmation = { expectedVersion: 3, digest: "a".repeat(64) };
    await expect(publishSignal(signal.id, confirmation)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string)).toEqual(confirmation);
  });
});
