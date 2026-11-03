import { describe, expect, it } from "vitest";
import { GalaxySampler, type GalaxyCandidate } from "./galaxy-sampling.js";
import { signalPrimaryBands } from "./frequency-taxonomy.js";
import { signalGalaxyQuerySchema } from "./schemas.js";

const candidates = Array.from({ length: 520 }, (_, index): GalaxyCandidate => ({
  id: String(index).padStart(8, "0"), createdAt: new Date(index * 1000), publicationVersion: 1,
  primaryBand: signalPrimaryBands[index % signalPrimaryBands.length], isMine: index % 2 === 0,
}));
describe("bounded Galaxy sampling", () => {
  it("canonicalizes valid UUID selection and rejects malformed focus", () => {
    const id = "ABCDEF00-0000-4000-8000-000000000001";
    expect(signalGalaxyQuerySchema.parse({ focus: id }).focus).toBe(id.toLowerCase());
    expect(signalGalaxyQuerySchema.safeParse({ focus: "one/two" }).success).toBe(false);
  });
  it("keeps newest own, explicit focus, recent expressions and band diversity within 80", () => {
    const sampler = new GalaxySampler(candidates[0].id);
    candidates.forEach((candidate) => sampler.add(candidate));
    const sample = sampler.select();
    expect(sampler.totalEligibleCount).toBe(520);
    expect(sample).toHaveLength(80);
    expect(new Set(sample.map((item) => item.id)).size).toBe(80);
    expect(sample.map((item) => item.id)).toEqual(expect.arrayContaining([candidates[0].id, candidates[518].id, candidates[519].id]));
    expect(new Set(sample.map((item) => item.primaryBand)).size).toBe(7);
  });
  it("returns the same ordered sample independently of database scan order", () => {
    const forward = new GalaxySampler(); const reverse = new GalaxySampler();
    candidates.forEach((candidate) => forward.add(candidate));
    [...candidates].reverse().forEach((candidate) => reverse.add(candidate));
    expect(reverse.select()).toEqual(forward.select());
  });
  it("does not invent missing focus or ownership and returns every item for a small set", () => {
    const sampler = new GalaxySampler("missing");
    candidates.slice(0, 3).map((candidate) => ({ ...candidate, isMine: false })).forEach((candidate) => sampler.add(candidate));
    expect(sampler.select()).toHaveLength(3);
    expect(sampler.latestOwn).toBeUndefined();
    expect(sampler.select().some((candidate) => candidate.id === "missing")).toBe(false);
  });
});
