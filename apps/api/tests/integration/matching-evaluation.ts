import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { LightMyRequestResponse } from "fastify";
import type { IntegrationHarness } from "./harness.js";
import { fixtureFingerprint } from "./fixtures.js";
import { buildPublicationPreview, confirmPublicationSnapshot } from "../../src/modules/signals/publication.js";
import { embeddingSpaceKey, signalEmbeddingText } from "../../src/modules/ai/embedding-space.js";
import { composeMatchScore, cosineRelevance } from "../../src/modules/signals/match-scoring.js";
import { summarizeMatchEvaluation, type MatchEvaluationRun } from "../../src/modules/signals/match-evaluation.js";
import type { MatchPolicy } from "../../src/modules/signals/match-policy.js";
import { expect } from "vitest";

type FixtureCandidate = { id: string; authorId: string; source: "human" | "seed" | "ai_generated";
  publicState: "public" | "withdrawn" | "hidden" | "unconfirmed"; body: string; tags: string[];
  distance: number | null; rerankScore: number; grade: number; createdAt: string };
export type MatchCase = { id: string; query: { authorId: string; viewerId: string; body: string; tags: string[]; band: "self_mirror" }; candidates: FixtureCandidate[] };
const fixtureBytes = readFileSync(new URL("../fixtures/e3-matches.v1.json", import.meta.url));
export const matchingDatasetHash = createHash("sha256").update(fixtureBytes).digest("hex");
if (matchingDatasetHash !== readFileSync(new URL("../fixtures/e3-matches.v1.sha256", import.meta.url), "utf8").trim()) throw new Error("Frozen matching corpus changed without a version bump.");
const dataset = JSON.parse(fixtureBytes.toString()) as { version: string; judgmentSource: string; cases: MatchCase[] };
if (dataset.version !== "e3-synthetic-v1" || dataset.judgmentSource !== "synthetic-presets-not-human") throw new Error("Unexpected matching fixture source.");
export const matchingCases = dataset.cases;
export const matchingStrategies: Array<{ name: string; policy?: MatchPolicy }> = [
  { name: "e2-baseline-K3-recent50" },
  { name: "merged-K3-score80", policy: { semanticCandidates: 3, ruleCandidates: 24, minScore: 80, maxRerankCharacters: 12000 } },
  { name: "merged-K12-score0", policy: { semanticCandidates: 12, ruleCandidates: 24, minScore: 0, maxRerankCharacters: 12000 } },
  { name: "merged-K12-score80", policy: { semanticCandidates: 12, ruleCandidates: 24, minScore: 80, maxRerankCharacters: 12000 } },
  { name: "merged-K24-score95", policy: { semanticCandidates: 24, ruleCandidates: 24, minScore: 95, maxRerankCharacters: 12000 } },
];
export const matchingCaptures: Array<{ name: string; policy: MatchPolicy | null; runs: MatchEvaluationRun[] }> = matchingStrategies.map(({ name, policy }) => ({ name, policy: policy ?? null, runs: [] }));
const verificationMeters: Array<{ queryId: string; embeddingCalls: number; rerankerCalls: number; requestBytes: number }> = [];
export function frozenMatchingReport() {
  return { datasetHash: matchingDatasetHash, datasetVersion: dataset.version, judgmentSource: dataset.judgmentSource,
    humanRelevance: null, currencyCost: null, modelQualityValidated: false,
    verificationMeters,
    strategies: matchingCaptures.map((strategy) => ({ ...strategy, summary: summarizeMatchEvaluation(strategy.runs) })) };
}

type Session = { id: string; frequencyCode: string; cookie: string };
type Request = (method: "GET" | "POST" | "DELETE", url: string, cookie?: string, payload?: Record<string, unknown>) => Promise<LightMyRequestResponse>;
export async function runFrozenMatchingCase(h: IntegrationHarness, current: MatchCase, author: Session, reader: Session, admin: Session, request: Request) {
  const owner = (id: string) => id === current.query.authorId ? author.id : id === current.query.viewerId ? reader.id : id;
  const aliases = new Map<string, string>([[author.id, author.frequencyCode], [reader.id, reader.frequencyCode]]);
  const authors = [...new Set(current.candidates.map((candidate) => owner(candidate.authorId)))].filter((id) => !aliases.has(id));
  const existingCodes = new Set((await h.sql<{ freq_code: string }[]>`select freq_code from users`).map((row) => row.freq_code));
  let code = 9000;
  const users = authors.map((id) => {
    while (existingCodes.has(`FM ${String(Math.floor(code / 100)).padStart(2, "0")}.${String(code % 100).padStart(2, "0")}`)) code += 1;
    if (code > 9999) throw new Error("No synthetic evaluation aliases remain.");
    const freq_code = `FM ${String(Math.floor(code / 100)).padStart(2, "0")}.${String(code % 100).padStart(2, "0")}`;
    code += 1; existingCodes.add(freq_code); aliases.set(id, freq_code); return { id, freq_code };
  });
  if (users.length) await h.sql`insert into users ${h.sql(users, "id", "freq_code")}`;
  // Match the owning runtime's configured dimension contract. Padding preserves
  // the frozen angles without weakening provider-space validation.
  const { env } = await h.loadModule("env");
  const space = { provider: "e3-loopback", model: "e3-embedding-fixed", dimensions: env.embeddingDimensions, version: "v1" };
  const queryVector = JSON.stringify([1, ...Array<number>(space.dimensions - 1).fill(0)]);
  const version = embeddingSpaceKey(space);
  const queryId = `00000000-0000-4000-8000-${String(700000 + matchingCases.indexOf(current)).padStart(12, "0")}`;
  const rows = [...current.candidates, { id: queryId, authorId: current.query.authorId, source: "human" as const, publicState: "public" as const,
    body: current.query.body, tags: current.query.tags, distance: 0, rerankScore: 0, grade: 0, createdAt: "2030-01-01T00:00:00Z" }].map((candidate) => {
    const authorId = owner(candidate.authorId);
    const fingerprint = { ...fixtureFingerprint, tags: candidate.tags };
    const preview = buildPublicationPreview({ authorId, authorFreqCode: aliases.get(authorId)!, expandedText: candidate.body,
      generationStatus: "COMPLETED", primaryBand: "self_mirror", fingerprintJson: fingerprint }, 0);
    const x = 1 - (candidate.distance ?? 0);
    return { id: candidate.id, author_id: authorId, frequency_id: null, raw_input: "E3_PRIVATE_SEED_" + candidate.id,
      seed_text: "E3_PRIVATE_SEED_" + candidate.id, expanded_text: candidate.body, fingerprint_json: JSON.stringify(fingerprint), program_json: "{}",
      primary_band: "self_mirror", source: candidate.source, status: candidate.publicState === "hidden" ? "HIDDEN" : "PUBLISHED",
      generation_status: "COMPLETED", publication_snapshot: candidate.publicState === "unconfirmed" ? null : JSON.stringify(confirmPublicationSnapshot(preview, new Date("2026-10-30T00:00:00Z"))),
      publication_version: candidate.publicState === "unconfirmed" ? 0 : 1, withdrawn_at: candidate.publicState === "withdrawn" ? "2026-10-30T01:00:00Z" : null,
      embedding: candidate.distance === null ? null : JSON.stringify([x, Math.sqrt(Math.max(0, 1 - x*x)), ...Array<number>(space.dimensions - 2).fill(0)]),
      embedding_dimensions: candidate.distance === null ? null : space.dimensions, embedding_model: candidate.distance === null ? null : space.model,
      embedding_provider: candidate.distance === null ? null : space.provider, embedding_version: candidate.distance === null ? null : version, created_at: candidate.createdAt };
  });
  await h.sql`insert into signals ${h.sql(rows, ...Object.keys(rows[0]) as Array<keyof typeof rows[number]>)}`;
  const configIds: string[] = [];
  const corpusIds = current.candidates.map((candidate) => candidate.id);
  const eligible = (candidate: FixtureCandidate) => candidate.publicState === "public" && candidate.source === "human" && ![author.id, reader.id].includes(owner(candidate.authorId));
  const judgments = Object.fromEntries(current.candidates.map((candidate) => [candidate.id, eligible(candidate) ? candidate.grade : 0]));
  h.provider.setMatchScores(Object.fromEntries(current.candidates.map((candidate) => [candidate.id, candidate.rerankScore])));
  try {
    for (const kind of ["embedding", "reranker"] as const) {
      const created = await request("POST", `/api/admin/provider-configs/${kind}`, admin.cookie, { apiKey: "E3-STUB-ONLY", baseUrl: h.provider.origin + "/v1",
        model: kind === "embedding" ? space.model : "e3-rerank-fixed", provider: space.provider,
        extraJson: kind === "embedding" ? { dimensions: space.dimensions, version: "v1" } : { scoreScale: "zero_to_one" } });
      expect(created.statusCode).toBe(201); configIds.push(created.json().data.providerConfig.id);
    }
    const [{ findSameFrequencyMatches, scoreSignalMatch }, { generateEmbedding }, { rerankCandidates }, repository] = await Promise.all([
      h.loadModule("matching"), h.loadModule("embedding"), h.loadModule("reranker"), h.loadModule("repository"),
    ]);
    for (const strategy of matchingStrategies) {
      const start = performance.now(); const meterStart = h.provider.matchDispatches.length;
      let semanticIds: string[]; let poolIds: string[]; let resultIds: string[];
      if (strategy.policy === undefined) {
        // Test-only E2 reference: same E1 template, real embedding/pgvector/rerank,
        // K=3, recent rules=50, semantic-first output. Never used by production.
        const embedding = await generateEmbedding(signalEmbeddingText(current.query.body));
        const semantic = await h.sql<{ id: string; distance: number }[]>`select id, embedding <=> ${queryVector}::vector as distance from signals
          where id in ${h.sql(corpusIds)} and status = 'PUBLISHED' and generation_status = 'COMPLETED' and withdrawn_at is null and publication_version > 0
          and publication_snapshot->>'kind' = 'AUTHOR_CONFIRMED' and embedding_version = ${embedding.version}
          and publication_snapshot->'content'->>'expandedText' = expanded_text order by embedding <=> ${queryVector}::vector, id limit 3`;
        const ruleIds = await h.sql<{ id: string }[]>`select id from signals where id in ${h.sql(corpusIds)} and status = 'PUBLISHED'
          and generation_status = 'COMPLETED' and withdrawn_at is null and publication_version > 0 and publication_snapshot->>'kind' = 'AUTHOR_CONFIRMED'
          order by created_at desc limit 50`;
        const records = (await Promise.all([...new Set([...semantic, ...ruleIds].map((row) => row.id))].map((id) => repository.findSignalResultById(id))))
          .filter((row): row is NonNullable<typeof row> => row !== undefined);
        const ruleTop = records.filter((row) => ruleIds.some((item) => item.id === row.id)).map((signal) => ({ signal, score: scoreSignalMatch(fixtureFingerprint, signal) }))
          .filter((row) => row.score > 0).sort((a,b) => b.score-a.score || a.signal.id.localeCompare(b.signal.id)).slice(0,3);
        let ranked = semantic.map((item) => ({ signal: records.find((row) => row.id === item.id)!, distance: Number(item.distance), score: 0 }));
        if (ranked.length) {
          const reranked = await rerankCandidates({ queryText: current.query.body, candidates: ranked.map(({ signal, distance }) => ({ id: signal.id, expandedText: signal.expandedText, distance })) });
          ranked = ranked.map((entry) => ({ ...entry, score: composeMatchScore(reranked.results.find((row) => row.id === entry.signal.id)?.score ?? cosineRelevance(entry.distance), scoreSignalMatch(fixtureFingerprint, entry.signal)) }));
        }
        ranked.sort((a,b) => b.score-a.score || a.signal.id.localeCompare(b.signal.id));
        resultIds = [...ranked.map(({ signal }) => signal.id), ...ruleTop.map(({ signal }) => signal.id).filter((id) => !ranked.some(({ signal }) => signal.id === id))].slice(0,3);
        semanticIds = semantic.map((row) => row.id); poolIds = [...new Set([...semanticIds, ...ruleTop.map(({ signal }) => signal.id)])];
      } else {
        const result = await findSameFrequencyMatches({ expandedText: current.query.body, rawInput: "E3_PRIVATE_QUERY_SEED", fingerprint: fixtureFingerprint,
          publicQuery: true, publicTags: current.query.tags, publicBand: "self_mirror", excludeSignalId: queryId, excludeAuthorIds: [author.id, reader.id], corpusIds,
          policy: strategy.policy });
        semanticIds = result.diagnostics.semanticIds; poolIds = result.diagnostics.poolIds; resultIds = result.matches.map((match) => match.id);
        if (current.id === "identity-and-source") {
          expect(semanticIds).toEqual(current.candidates.filter(eligible).map((candidate) => candidate.id));
        }
        expect(resultIds.every((id) => current.candidates.some((candidate) => candidate.id === id && eligible(candidate)))).toBe(true);
        const dispatched = h.provider.matchDispatches.slice(meterStart).filter((row) => row.kind === "reranker");
        const hash = (text: string) => createHash("sha256").update(text).digest("hex");
        for (const dispatch of dispatched) {
          expect(dispatch.ids.every((id) => current.candidates.some((candidate) => candidate.id === id && eligible(candidate)))).toBe(true);
          expect(dispatch.textHashes).toEqual([hash(current.query.body), ...dispatch.ids.map((id) => hash(current.candidates.find((candidate) => candidate.id === id)!.body))]);
        }
        for (const dispatch of h.provider.matchDispatches.slice(meterStart).filter((row) => row.kind === "embedding")) {
          expect(dispatch.textHashes).toEqual([hash(signalEmbeddingText(current.query.body))]);
        }
        expect(new Set(dispatched[0]?.ids ?? []).size).toBe(dispatched[0]?.ids.length ?? 0);
        if (strategy.policy.minScore === 80 && current.id === "no-suitable-match") expect(resultIds).toEqual([]);
      }
      const dispatches = h.provider.matchDispatches.slice(meterStart);
      matchingCaptures.find((capture) => capture.name === strategy.name)!.runs.push({ queryId: current.id, judgments, semanticIds, poolIds, resultIds,
        latencyMs: Math.max(0, performance.now() - start), embeddingCalls: dispatches.filter((row) => row.kind === "embedding").length,
        rerankerCalls: dispatches.filter((row) => row.kind === "reranker").length, requestBytes: dispatches.reduce((sum, row) => sum + row.requestBytes, 0) });
    }
    // Full HTTP projection must use the query author and the authenticated viewer
    // on both entry points; public labels never substitute for identity filtering.
    const verificationStart = h.provider.matchDispatches.length;
    for (const suffix of ["", "/matches"]) {
      const response = await request("GET", `/api/signals/${queryId}${suffix}`, reader.cookie);
      expect(response.statusCode).toBe(200);
      const matches = suffix ? response.json().data.matches : response.json().data.signal.matches;
      if (current.id === "no-suitable-match") expect(matches).toEqual([]);
      else expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.contentSource).toBe("human"); expect(match.score).toBeGreaterThanOrEqual(80);
        expect(match.scoreProvenance.version).toBe("match-score-v1");
        expect(current.candidates.some((candidate) => candidate.id === match.id && eligible(candidate))).toBe(true);
        for (const key of ["rawInput", "seedText", "frequencyProfile", "authorId"]) expect(match).not.toHaveProperty(key);
      }
    }
    const verification = h.provider.matchDispatches.slice(verificationStart);
    verificationMeters.push({ queryId: current.id, embeddingCalls: verification.filter((row) => row.kind === "embedding").length,
      rerankerCalls: verification.filter((row) => row.kind === "reranker").length,
      requestBytes: verification.reduce((sum, row) => sum + row.requestBytes, 0) });
  } finally {
    for (const id of configIds) {
      const kind = id === configIds[0] ? "embedding" : "reranker";
      expect((await request("DELETE", `/api/admin/provider-configs/${kind}/${id}`, admin.cookie)).statusCode).toBe(200);
    }
    await h.sql`update signals set status = 'DRAFT' where id in ${h.sql(rows.map((row) => row.id))}`;
    h.provider.setMatchScores({});
  }
}
