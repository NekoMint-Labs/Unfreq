import { AppError } from "../../shared/errors.js";
import type { EmbeddingLogger } from "../ai/embedding.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { SignalGalaxyQuery } from "./schemas.js";
import {
  findPublishedSignalById,
  findRandomPublishedSignal,
  findSignalResultById,
  findSignalSave,
  getFrequencyLastSeenAt,
  listPublishedGalaxySignals,
  listPublishedGalaxyThemes,
  listPublishedSignals,
  listSavedSignalsForFrequency,
  listSignalsForAuthor,
  summarizeSignalResonancesSince,
  touchFrequencyLastSeenAt,
} from "./repository.js";
import {
  galaxyLimit,
  galaxyThemeOptionLimit,
  hallLimit,
  maxMatchCount,
  mySignalsLimit,
  savedSignalsLimit,
} from "./service-constants.js";
import { queueSignalGalaxyPositionWrite } from "./service-embedding.js";
import { findSameFrequencyMatches, scoreSignalMatch } from "./service-matching.js";
import {
  buildStableGalaxyPosition,
  getSignalFrequencyProfile,
  isFiniteGalaxyPosition,
  sumResonanceCount,
  toMySignalSummary,
  toSavedSignalSummary,
  toShortText,
  toSignalGenerationDetail,
  toSignalDetail,
  toSignalPreviewDetail,
  withSaveState,
} from "./service-mappers.js";
import { signalBandLabels, signalPrimaryBands } from "./frequency-taxonomy.js";
import type {
  EchoSummary,
  GalaxyResult,
  GalaxySignalPoint,
  MySignalsResult,
  MySignalSummary,
  ReviewingSignalRestrictedDetail,
  SavedSignalsResult,
  SignalDetail,
  SignalGalaxyPosition,
  SignalMatchSummary,
  SignalRecord,
  SignalResultDetail,
} from "./types.js";

export async function getSignalHall(): Promise<SignalDetail[]> {
  const signals = await listPublishedSignals(hallLimit);

  return signals.map(toSignalDetail);
}

function toGalaxyPoint(params: {
  currentFrequencyId?: string;
  matchIds: string[];
  position: SignalGalaxyPosition;
  signal: SignalRecord;
}): GalaxySignalPoint {
  const frequencyProfile = getSignalFrequencyProfile(params.signal);
  const isCurrentFrequencySignal =
    params.currentFrequencyId !== undefined &&
    (params.signal.frequencyId === params.currentFrequencyId ||
      params.signal.authorId === params.currentFrequencyId);

  return {
    createdAt: params.signal.createdAt.toISOString(),
    expandedText: toShortText(params.signal.expandedText, 180),
    frequencyProfile,
    frequencyCode: params.signal.authorFreqCode ?? params.signal.fingerprintJson.frequency,
    id: params.signal.id,
    isMine: isCurrentFrequencySignal,
    matchIds: params.matchIds,
    position: params.position,
    resonanceCount: params.signal.resonanceCount,
    source: params.signal.source,
    theme: frequencyProfile.displayText,
  };
}

function getGalaxyMatchIds(signal: SignalRecord, allSignals: SignalRecord[]): string[] {
  const matchIds = new Set<string>();
  const visibleSignalIds = new Set(allSignals.map((candidate) => candidate.id));

  if (signal.matchSignalId !== null && visibleSignalIds.has(signal.matchSignalId)) {
    matchIds.add(signal.matchSignalId);
  }

  allSignals
    .filter((candidate) => candidate.id !== signal.id)
    .map((candidate) => {
      return {
        candidate,
        score: scoreSignalMatch(signal.fingerprintJson, candidate),
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.candidate.id.localeCompare(right.candidate.id);
    })
    .forEach((candidate) => {
      if (matchIds.size < maxMatchCount) {
        matchIds.add(candidate.candidate.id);
      }
    });

  return Array.from(matchIds).slice(0, maxMatchCount);
}

export async function getSignalGalaxy(
  frequency: AuthenticatedFrequency | undefined,
  query: SignalGalaxyQuery = {},
  logger?: EmbeddingLogger,
): Promise<GalaxyResult> {
  const [signals, themeOptions] = await Promise.all([
    listPublishedGalaxySignals({
      band: query.band,
      limit: galaxyLimit,
      theme: query.theme,
    }),
    listPublishedGalaxyThemes(galaxyThemeOptionLimit),
  ]);
  const points = signals.map((signal) => {
    const position = buildStableGalaxyPosition(signal);

    if (!isFiniteGalaxyPosition(signal.galaxyPosition)) {
      queueSignalGalaxyPositionWrite({
        logger,
        position,
        signal,
      });
    }

    return toGalaxyPoint({
      currentFrequencyId: frequency?.id,
      matchIds: getGalaxyMatchIds(signal, signals),
      position,
      signal,
    });
  });

  return {
    bandOptions: signalPrimaryBands.map((band) => ({
      label: signalBandLabels[band],
      value: band,
    })),
    generatedAt: new Date().toISOString(),
    points: points.filter((point) => {
      return isFiniteGalaxyPosition(point.position);
    }),
    themeOptions: themeOptions.map((theme) => {
      return signalBandLabels[theme as keyof typeof signalBandLabels] ?? theme;
    }),
  };
}

export async function getMySignals(
  frequency: AuthenticatedFrequency,
): Promise<MySignalsResult> {
  const signals = (await listSignalsForAuthor({
    authorId: frequency.id,
    limit: mySignalsLimit,
  })).map(toMySignalSummary);

  return {
    signals,
    totalResonanceCount: sumResonanceCount(signals),
  };
}

export async function getSavedSignals(
  frequency: AuthenticatedFrequency,
): Promise<SavedSignalsResult> {
  const signals = await listSavedSignalsForFrequency({
    frequencyId: frequency.id,
    limit: savedSignalsLimit,
  });

  return {
    signals: signals.map(toSavedSignalSummary),
  };
}

export async function getMyEchoSummary(
  frequency: AuthenticatedFrequency,
  options: {
    markSeen?: boolean;
  } = {},
): Promise<EchoSummary> {
  const result = await getMySignals(frequency);
  const totalTopSignal = result.signals.reduce<MySignalSummary | undefined>(
    (current, signal) => {
      if (current === undefined || signal.resonanceCount > current.resonanceCount) {
        return signal;
      }

      return current;
    },
    undefined,
  );
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

async function toPublishedSignalDetail(signal: SignalRecord): Promise<SignalDetail> {
  const matchResult = await findSameFrequencyMatches({
    excludeSignalId: signal.id,
    expandedText: signal.expandedText,
    fingerprint: signal.fingerprintJson,
    rawInput: signal.rawInput,
  });

  return {
    ...toSignalDetail(signal),
    matches: matchResult.matches,
  };
}

function isOwnedByFrequency(signal: SignalRecord, frequency: AuthenticatedFrequency): boolean {
  return signal.frequencyId === frequency.id || signal.authorId === frequency.id;
}

function toReviewingRestrictedDetail(
  signal: SignalRecord,
): ReviewingSignalRestrictedDetail {
  return {
    createdAt: signal.createdAt.toISOString(),
    id: signal.id,
    status: "REVIEWING",
    updatedAt: signal.updatedAt.toISOString(),
    visibility: "REVIEW_RESTRICTED",
  };
}

export async function getSignalDetail(id: string): Promise<SignalDetail> {
  const signal = await findPublishedSignalById(id);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  return toPublishedSignalDetail(signal);
}

export async function getSignalDetailForFrequency(
  id: string,
  frequency: AuthenticatedFrequency | undefined,
): Promise<SignalResultDetail> {
  const signal = await findSignalResultById(id);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  if (signal.generationStatus !== "COMPLETED") {
    if (frequency !== undefined && isOwnedByFrequency(signal, frequency)) {
      return toSignalGenerationDetail(signal);
    }

    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  if (signal.status === "DRAFT") {
    if (frequency !== undefined && isOwnedByFrequency(signal, frequency)) {
      return toSignalPreviewDetail(signal);
    }

    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  if (signal.status !== "PUBLISHED" && signal.status !== "REVIEWING") {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  if (signal.status === "REVIEWING") {
    if (frequency !== undefined && isOwnedByFrequency(signal, frequency)) {
      return toSignalDetail(signal);
    }

    return toReviewingRestrictedDetail(signal);
  }

  const detail = await toPublishedSignalDetail(signal);

  if (frequency === undefined) {
    return detail;
  }

  const save = await findSignalSave({
    frequencyId: frequency.id,
    signalId: id,
  });

  return withSaveState(detail, save !== undefined);
}

export async function getSignalMatches(id: string): Promise<SignalMatchSummary[]> {
  const signal = await findPublishedSignalById(id);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  const matchResult = await findSameFrequencyMatches({
    excludeSignalId: signal.id,
    expandedText: signal.expandedText,
    fingerprint: signal.fingerprintJson,
    rawInput: signal.rawInput,
  });

  return matchResult.matches;
}

export async function getRandomSignal(
  frequency: AuthenticatedFrequency | undefined,
): Promise<SignalDetail> {
  const signal = await findRandomPublishedSignal({
    excludeFrequencyId: frequency?.id,
  });

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  return toSignalDetail(signal);
}
