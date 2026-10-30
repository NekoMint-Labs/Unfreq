import { createHash } from "node:crypto";
import type { SignalPrimaryBand } from "./types.js";
import { galaxyLimit } from "./service-constants.js";

export type GalaxyCandidate = {
  id: string;
  publicationVersion: number;
  createdAt: Date;
  primaryBand?: SignalPrimaryBand;
  isMine: boolean;
};
const recentOrder = (a: GalaxyCandidate, b: GalaxyCandidate) =>
  b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);

/** Bounded metadata only: recent 80 + at most 12 per confirmed band. */
export class GalaxySampler {
  totalEligibleCount = 0;
  latestOwn?: GalaxyCandidate;
  private focused?: GalaxyCandidate;
  private recent: GalaxyCandidate[] = [];
  private bands = new Map<string, Array<{ candidate: GalaxyCandidate; rank: string }>>();
  constructor(private focusId?: string) {}

  add(candidate: GalaxyCandidate) {
    this.totalEligibleCount += 1;
    if (candidate.id === this.focusId) this.focused = candidate;
    if (candidate.isMine && (this.latestOwn === undefined || recentOrder(candidate, this.latestOwn) < 0)) this.latestOwn = candidate;
    this.recent.push(candidate);
    this.recent.sort(recentOrder);
    if (this.recent.length > galaxyLimit) this.recent.pop();
    const key = candidate.primaryBand ?? "unclassified";
    const bucket = this.bands.get(key) ?? [];
    bucket.push({ candidate, rank: createHash("sha256").update(candidate.id).digest("hex") });
    bucket.sort((a, b) => a.rank.localeCompare(b.rank) || a.candidate.id.localeCompare(b.candidate.id));
    if (bucket.length > 12) bucket.pop();
    this.bands.set(key, bucket);
  }

  select(): GalaxyCandidate[] {
    const selected = new Map<string, GalaxyCandidate>();
    const add = (candidate?: GalaxyCandidate) => {
      if (candidate !== undefined && selected.size < galaxyLimit) selected.set(candidate.id, candidate);
    };
    add(this.focused); add(this.latestOwn);
    this.recent.slice(0, galaxyLimit / 2).forEach(add);
    const buckets = [...this.bands.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => bucket);
    for (let index = 0; index < 12; index += 1) for (const bucket of buckets) add(bucket[index]?.candidate);
    this.recent.forEach(add);
    return [...selected.values()];
  }
}
