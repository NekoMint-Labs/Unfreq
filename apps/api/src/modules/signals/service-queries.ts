import { AppError } from "../../shared/errors.js";
import type { EmbeddingLogger } from "../ai/embedding.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { SignalGalaxyQuery } from "./schemas.js";
import { findPublishedSignalById, findRandomPublishedSignal, findSignalResultById, findSignalSave,
  getFrequencyLastSeenAt, listPublishedGalaxyThemes, listPublishedGalaxySignals, listPublishedSignals, listSavedSignalsForFrequency,
  readMySignalHistory, recheckPublicSignals, summarizeSignalResonancesSince, touchFrequencyLastSeenAt } from "./repository.js";
import { galaxyThemeOptionLimit, galaxyLimit, hallLimit, mySignalsLimit, savedSignalsLimit, maxMatchCount } from "./service-constants.js";
import { queueSignalGalaxyPositionWrite } from "./service-embedding.js";
import { findSameFrequencyMatches, scoreSignalMatch } from "./service-matching.js";
import { buildStableGalaxyPosition, isFiniteGalaxyPosition, toMySignalSummary,
  toSignalGenerationDetail, toSignalDetail, getFingerprintFrequencyProfile, getSignalFrequencyProfile } from "./service-mappers.js";
import { projectPublicSignal, projectPublicMatch, projectPublicSaved, projectPublicGalaxy, parsePublicationSnapshot } from "./publication.js";
import { isPublicSignal, publicationProjection } from "./publication-policy.js";
import { previewSignalPublicationForOwner } from "./service-publication-confirmation.js";
import { signalBandLabels, signalPrimaryBands } from "./frequency-taxonomy.js";
import type { EchoSummary, GalaxyResult, MySignalsResult, SavedSignalsResult,
  SignalRecord, SignalResultDetail } from "./types.js";
import type { OwnerSignalDetail, PublicSignalDetail, PublicSignalMatchSummary, SignalPublicationActions } from "@unfreq/contracts/signals";
import { decodeHistoryCursor } from "./history-cursor.js";
import { isMatchEligible, type MatchScope } from "./match-policy.js";

const notFound = () => new AppError("NOT_FOUND", "Signal not found.");

export async function getSignalHall(): Promise<PublicSignalDetail[]> {
  const rows = await listPublishedSignals(hallLimit);
  return (await recheckPublicSignals(rows)).flatMap((signal) => {
    const detail = projectPublicSignal(publicationProjection(signal));
    return detail === undefined ? [] : [detail];
  });
}

export async function getSignalGalaxy(frequency: AuthenticatedFrequency | undefined,
  query: SignalGalaxyQuery = {}, logger?: EmbeddingLogger): Promise<GalaxyResult> {
  const [sample, themeOptions] = await Promise.all([listPublishedGalaxySignals({ band: query.band, limit: galaxyLimit, theme: query.theme,
    focus: query.focus, frequencyId: frequency?.id }), listPublishedGalaxyThemes(galaxyThemeOptionLimit)]);
  const currentRows = await recheckPublicSignals(sample.signals);
  const byId = new Map(currentRows.map((row) => [row.id, row]));
  const current = sample.signals.flatMap((row) => { const valid = byId.get(row.id); return valid === undefined ? [] : [valid]; });
  const visibleSignalIds = new Set(current.map((signal) => signal.id));
  // Reuse only within this synchronous snapshot projection. No shared cache or
  // new scoring weights: each profile used to be rebuilt for every edge.
  const fingerprintProfiles = new Map(current.map((signal) => [signal.id, getFingerprintFrequencyProfile(signal.fingerprintJson)]));
  const candidateProfiles = new Map(current.map((signal) => [signal.id, getSignalFrequencyProfile(signal)]));
  const points = current.flatMap((signal) => {
    const position = buildStableGalaxyPosition(signal);
    if (!isFiniteGalaxyPosition(signal.galaxyPosition)) queueSignalGalaxyPositionWrite({ logger, position, signal });
    const matchIds = current.filter((item) => item.id !== signal.id)
      .map((item) => ({ id: item.id, score: scoreSignalMatch(signal.fingerprintJson, item,
        { current: fingerprintProfiles.get(signal.id)!, candidate: candidateProfiles.get(item.id)! }) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, maxMatchCount).map((item) => item.id);
    const point = projectPublicGalaxy({ ...publicationProjection(signal), position, visibleSignalIds,
      isMine: frequency !== undefined && (signal.authorId ?? signal.frequencyId) === frequency.id, matchIds });
    return point === undefined ? [] : [point];
  });
  const latestOwn = points.find((point) => point.id === sample.latestOwnSignalId && point.isMine);
  const focused = points.find((point) => point.id === query.focus);
  return { generatedAt: new Date().toISOString(), points, coverage: {
    totalEligibleCount: sample.totalEligibleCount, returnedCount: points.length, sampleLimit: 80, samplingVersion: "recent-band-v1",
    filters: query.band === undefined ? (query.theme === undefined ? {} : { theme: query.theme }) : { band: query.band },
    ...(latestOwn === undefined ? {} : { latestOwnSignalId: latestOwn.id }),
    ...(focused === undefined ? {} : { focusSignalId: focused.id }),
    focusStatus: query.focus === undefined ? "none" : focused === undefined ? "unavailable" : "available",
  },
    bandOptions: signalPrimaryBands.map((value) => ({ label: signalBandLabels[value], value })),
    themeOptions };
}

export async function getMySignals(
  frequency: AuthenticatedFrequency,
  query: { limit?: number; cursor?: string } = {},
): Promise<MySignalsResult> {
  const cursor = query.cursor === undefined ? undefined : decodeHistoryCursor(query.cursor);
  const limit = query.limit ?? mySignalsLimit;
  if ((query.cursor !== undefined && cursor === undefined) || !Number.isInteger(limit) || limit < 1 || limit > mySignalsLimit) throw new AppError("VALIDATION_ERROR", "Invalid history page.");
  const result = await readMySignalHistory({ authorId: frequency.id, limit, cursor });
  return { ...result, signals: result.signals.map(toMySignalSummary),
    topSignal: result.topSignal === undefined ? undefined : toMySignalSummary(result.topSignal) };
}

export async function getSavedSignals(
  frequency: AuthenticatedFrequency,
): Promise<SavedSignalsResult> {
  const signals = await listSavedSignalsForFrequency({
    frequencyId: frequency.id,
    limit: savedSignalsLimit,
  });

  return {
    signals: (await recheckPublicSignals(signals)).flatMap((current) => {
      const saved = signals.find((item) => item.id === current.id);
      if (saved === undefined) return [];
      const projected = projectPublicSaved({ ...publicationProjection(current), signal: { ...current, savedAt: saved.savedAt } });
      return projected === undefined ? [] : [projected];
    }),
  };
}

export async function getMyEchoSummary(
  frequency: AuthenticatedFrequency,
  options: {
    markSeen?: boolean;
  } = {},
): Promise<EchoSummary> {
  const result = await getMySignals(frequency, { limit: 1 });
  const totalTopSignal = result.topSignal;
  const lastSeenAt = await getFrequencyLastSeenAt(frequency.id);
  const sinceSummary =
    lastSeenAt === null
      ? undefined
      : await summarizeSignalResonancesSince({
          authorId: frequency.id,
          since: lastSeenAt,
        });

  if (options.markSeen === true) {
    await touchFrequencyLastSeenAt({
      frequencyId: frequency.id,
      seenAt: new Date(),
    });
  }

  const topSignal =
    sinceSummary?.topSignal === undefined
      ? totalTopSignal
      : toMySignalSummary(sinceSummary.topSignal);

  return {
    frequencyId: frequency.id,
    newResonanceCount: sinceSummary?.newResonanceCount ?? 0,
    since: lastSeenAt?.toISOString(),
    topSignal: topSignal?.resonanceCount === 0 ? undefined : topSignal,
    totalResonanceCount: result.totalResonanceCount,
  };
}


async function toPublishedSignalDetail(signal: SignalRecord, frequency?: AuthenticatedFrequency, logger?: EmbeddingLogger): Promise<PublicSignalDetail> {
  if (!isPublicSignal(signal)) throw notFound();
  const snapshot = parsePublicationSnapshot(signal.publicationSnapshot)!;
  const matchScope: MatchScope = { excludeSignalId: signal.id,
    excludeAuthorIds: [...new Set([signal.authorId ?? signal.frequencyId, frequency?.id].filter((id): id is string => id !== null && id !== undefined))] };
  const result = await findSameFrequencyMatches({ excludeSignalId: signal.id,
    excludeAuthorIds: matchScope.excludeAuthorIds,
    publicTags: snapshot.content.tags, publicBand: snapshot.content.primaryBand,
    logger, publicQuery: true, expandedText: snapshot.content.expandedText, rawInput: snapshot.content.expandedText, fingerprint: signal.fingerprintJson });
  const save = frequency === undefined ? undefined : await findSignalSave({ frequencyId: frequency.id, signalId: signal.id });
  const candidates = result.matches.filter((match) => match.source === "PUBLISHED" && match.publicationVersion !== undefined);
  // Parent and every match are rechecked together after provider/save awaits.
  const current = await recheckPublicSignals([signal, ...candidates.map((match) => ({ id: match.id, publicationVersion: match.publicationVersion! }))]);
  const parent = current.find((item) => item.id === signal.id);
  if (parent === undefined) throw notFound();
  const matches = candidates.flatMap((match) => {
    const row = current.find((item) => item.id === match.id);
    const projected = row === undefined || !isMatchEligible(row, matchScope) || (row.authorId ?? row.frequencyId) === (parent.authorId ?? parent.frequencyId)
      ? undefined : projectPublicMatch({ ...publicationProjection(row, match.publicationVersion), score: match.score, scoreProvenance: match.scoreProvenance });
    return projected === undefined ? [] : [projected];
  });
  const detail = projectPublicSignal({ ...publicationProjection(parent, signal.publicationVersion), matches,
    ...(frequency === undefined ? {} : { hasSaved: save !== undefined }) });
  if (detail === undefined) throw notFound();
  return detail;
}

export async function getSignalDetail(id: string, logger?: EmbeddingLogger, frequency?: AuthenticatedFrequency): Promise<PublicSignalDetail> {
  const signal = await findPublishedSignalById(id);
  if (signal === undefined) throw notFound();
  return toPublishedSignalDetail(signal, frequency, logger);
}

async function ownerActions(signal: SignalRecord, frequency: AuthenticatedFrequency): Promise<SignalPublicationActions> {
  let state: SignalPublicationActions["state"] = signal.status === "HIDDEN" ? "HIDDEN" :
    signal.status === "REVIEWING" ? "REVIEWING" : signal.withdrawnAt !== null ? "WITHDRAWN" :
    signal.generationStatus === "FAILED" ? "FAILED" : signal.generationStatus !== "COMPLETED" ? "GENERATING" :
    isPublicSignal(signal) ? "PUBLIC" : signal.status === "DRAFT" ? "DRAFT" : "UNCONFIRMED";
  let preview: SignalPublicationActions["preview"];
  if (frequency.status === "ACTIVE" && ["PUBLIC", "WITHDRAWN", "DRAFT", "UNCONFIRMED"].includes(state) && signal.generationStatus === "COMPLETED") {
    try { preview = await previewSignalPublicationForOwner(signal.id, frequency); }
    catch (error) { if (!(error instanceof AppError) || !["CONFLICT", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) throw error; }
    if (preview !== undefined && preview.version !== signal.publicationVersion) throw new AppError("CONFLICT", "Signal changed. Refresh before continuing.");
  }
  if (isPublicSignal(signal)) state = "PUBLIC";
  const content = parsePublicationSnapshot(signal.publicationSnapshot)?.content;
  return { state, version: signal.publicationVersion, canPublish: preview !== undefined && state !== "PUBLIC",
    canWithdraw: frequency.status !== "BANNED" && signal.withdrawnAt === null,
    ...(preview === undefined ? {} : { preview }), ...(content === undefined ? {} : { publishedContent: content }) };
}

export async function getSignalDetailForFrequency(id: string, frequency: AuthenticatedFrequency | undefined, logger?: EmbeddingLogger): Promise<SignalResultDetail> {
  const signal = await findSignalResultById(id);
  if (signal === undefined || signal.status === "DELETED" || signal.status === "HIDDEN") throw notFound();
  const owned = frequency !== undefined && (signal.authorId ?? signal.frequencyId) === frequency.id && frequency.status !== "BANNED";
  if (owned) {
    const publication = await ownerActions(signal, frequency);
    const matches = isPublicSignal(signal) ? (await toPublishedSignalDetail(signal, undefined, logger)).matches : [];
    // The second read fences owner actions that raced with moderation/withdrawal.
    const latest = await findSignalResultById(id);
    if (latest === undefined || latest.publicationVersion !== signal.publicationVersion) throw notFound();
    if (signal.generationStatus !== "COMPLETED") return { ...toSignalGenerationDetail(signal), publication };
    const detail: OwnerSignalDetail = { ...toSignalDetail(signal), visibility: "PRIVATE_OWNER", matches, publication };
    return detail;
  }
  if (signal.status === "REVIEWING" && signal.withdrawnAt === null) return {
    id: signal.id, status: "REVIEWING", visibility: "REVIEW_RESTRICTED",
    createdAt: signal.createdAt.toISOString(), updatedAt: signal.updatedAt.toISOString(),
  };
  if (!isPublicSignal(signal)) throw notFound();
  return toPublishedSignalDetail(signal, frequency, logger);
}

export async function getSignalMatches(id: string, logger?: EmbeddingLogger, frequency?: AuthenticatedFrequency): Promise<PublicSignalMatchSummary[]> {
  return (await getSignalDetail(id, logger, frequency)).matches;
}

export async function getRandomSignal(frequency: AuthenticatedFrequency | undefined): Promise<PublicSignalDetail> {
  const signal = await findRandomPublishedSignal({ excludeFrequencyId: frequency?.id });
  if (signal === undefined) throw notFound();
  const [current] = await recheckPublicSignals([signal]);
  const detail = current === undefined ? undefined : projectPublicSignal(publicationProjection(current, signal.publicationVersion));
  if (detail === undefined) throw notFound();
  return detail;
}
