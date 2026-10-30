import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchRecord } from "../../../tests/unit/matching-fixture.js";
import { getSignalDetailForFrequency, getSignalMatches } from "./service-queries.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
const calls = vi.hoisted(() => ({ find: vi.fn(), recheck: vi.fn(), match: vi.fn() }));
vi.mock("./repository.js", () => ({ findPublishedSignalById: calls.find, findSignalResultById: calls.find,
  findSignalSave: async () => undefined, recheckPublicSignals: calls.recheck }));
vi.mock("./service-matching.js", () => ({ findSameFrequencyMatches: calls.match, scoreSignalMatch: vi.fn() }));
const parent = matchRecord({ id: "00000000-0000-4000-8000-000000000502" });
const candidate = matchRecord({ authorId: "00000000-0000-4000-8000-000000000503" });
const viewer: AuthenticatedFrequency = { id: "00000000-0000-4000-8000-000000000504", createdAt: "2026-10-30T00:00:00Z",
  freqCode: "FM 50.04", isGuest: false, role: "USER", status: "ACTIVE" };
beforeEach(() => {
  calls.find.mockReset().mockResolvedValue(parent);
  calls.match.mockReset().mockResolvedValue({ matches: [{ id: candidate.id, publicationVersion: 1, source: "PUBLISHED", score: 90 }] });
  calls.recheck.mockReset().mockResolvedValue([parent, candidate]);
});
describe("E3 final public projection policy fence", () => {
  it.each(["ai_generated", "seed"] as const)("drops a candidate changed to %s after matching", async (source) => {
    calls.recheck.mockResolvedValue([parent, { ...candidate, source }]);
    expect(await getSignalDetailForFrequency(parent.id, viewer)).toMatchObject({ visibility: "PUBLIC", matches: [] });
  });
  it.each([parent.authorId, viewer.id])("drops a candidate reassigned to the query author/viewer after matching", async (authorId) => {
    calls.recheck.mockResolvedValue([parent, { ...candidate, authorId }]);
    expect(await getSignalDetailForFrequency(parent.id, viewer)).toMatchObject({ visibility: "PUBLIC", matches: [] });
  });
  it("passes authenticated viewer scope through the /matches service entry and preserves safe source metadata", async () => {
    const matches = await getSignalMatches(parent.id, undefined, viewer);
    expect(calls.match).toHaveBeenCalledWith(expect.objectContaining({ excludeAuthorIds: [parent.authorId, viewer.id] }));
    expect(matches[0]).toMatchObject({ id: candidate.id, contentSource: "human" });
    expect(matches[0]).not.toHaveProperty("authorId");
  });
});
