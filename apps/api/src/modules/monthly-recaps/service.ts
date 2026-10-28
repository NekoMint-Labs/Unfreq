import { AppError } from "../../shared/errors.js";
import { summarizeMonthlyRecapWithFallback } from "../ai/service.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import { normalizeSignalFrequencyProfile } from "../signals/frequency-taxonomy.js";
import type { MySignalSummary } from "../signals/types.js";
import {
  findLatestMonthlyRecap,
  findMonthlyRecap,
  findPublishedSignalForMonthlyRecap,
  listMonthlyRecapSignals,
  upsertMonthlyRecap,
} from "./repository.js";
import type { MonthlyRecapDetail, MonthlyRecapRecord, MonthlyRecapSignal } from "./types.js";

const minSignalsForMonthlyRecap = 3;
const monthKeyPattern = /^\d{4}-(0[1-9]|1[0-2])$/u;

function assertActiveFrequency(frequency: AuthenticatedFrequency) {
  if (frequency.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "This frequency cannot generate monthly recaps now.");
  }
}

function toYearMonth(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getPreviousYearMonth(now = new Date()): string {
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  return toYearMonth(previousMonth);
}

function getMonthRange(yearMonth: string): { endAt: Date; startAt: Date } {
  if (!monthKeyPattern.test(yearMonth)) {
    throw new AppError("VALIDATION_ERROR", "Invalid year month.", {
      yearMonth: ["Expected YYYY-MM."],
    });
  }

  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const startAt = new Date(Date.UTC(year, monthIndex, 1));
  const endAt = new Date(Date.UTC(year, monthIndex + 1, 1));

  return {
    endAt,
    startAt,
  };
}

function toMySignalSummary(signal: MonthlyRecapSignal): MySignalSummary {
  const frequencyProfile = normalizeSignalFrequencyProfile({
    coreNeed: signal.fingerprintJson.coreNeed ?? signal.fingerprintJson.hiddenNeed,
    emotionTone: signal.fingerprintJson.emotionTone ?? signal.fingerprintJson.primaryEmotion,
    fallbackText: [signal.seedText, signal.expandedText, signal.fingerprintJson.theme].join("\n"),
    innerConflict:
      signal.fingerprintJson.innerConflict ?? signal.fingerprintJson.narrativeConflict,
    primaryBand: signal.fingerprintJson.primaryBand,
    resonanceKeywords:
      signal.fingerprintJson.resonanceKeywords ?? signal.fingerprintJson.tags,
    subFeeling: signal.fingerprintJson.subFeeling,
  });

  return {
    createdAt: signal.createdAt.toISOString(),
    expandedText: signal.expandedText,
    frequencyProfile,
    id: signal.id,
    parentSignalId: signal.parentSignalId ?? undefined,
    resonanceCount: signal.resonanceCount,
    seedText: signal.seedText,
    status: signal.status,
  };
}

function pickTopSignal(signals: MonthlyRecapSignal[]): MonthlyRecapSignal | undefined {
  return signals.reduce<MonthlyRecapSignal | undefined>((current, signal) => {
    if (current === undefined || signal.resonanceCount > current.resonanceCount) {
      return signal;
    }

    if (signal.resonanceCount === current.resonanceCount && signal.createdAt < current.createdAt) {
      return signal;
    }

    return current;
  }, undefined);
}

function buildRecapInput(signals: MonthlyRecapSignal[]): string {
  return signals
    .map((signal, index) => {
      const frequencyProfile = normalizeSignalFrequencyProfile({
        coreNeed: signal.fingerprintJson.coreNeed ?? signal.fingerprintJson.hiddenNeed,
        emotionTone: signal.fingerprintJson.emotionTone ?? signal.fingerprintJson.primaryEmotion,
        fallbackText: [signal.seedText, signal.expandedText, signal.fingerprintJson.theme].join("\n"),
        innerConflict:
          signal.fingerprintJson.innerConflict ?? signal.fingerprintJson.narrativeConflict,
        primaryBand: signal.fingerprintJson.primaryBand,
        resonanceKeywords:
          signal.fingerprintJson.resonanceKeywords ?? signal.fingerprintJson.tags,
        subFeeling: signal.fingerprintJson.subFeeling,
      });

      return [
        `#${index + 1}`,
        `主频段：${frequencyProfile.displayText}`,
        `共振关键词：${frequencyProfile.resonanceKeywords.join("、")}`,
        `共鸣：${signal.resonanceCount}`,
        `种子：${signal.seedText}`,
        `扩写：${signal.expandedText}`,
      ].join("\n");
    })
    .join("\n\n");
}

function normalizeThemeWords(themeWords: string[], signals: MonthlyRecapSignal[]): string[] {
  const normalized = themeWords
    .map((word) => word.trim())
    .filter((word, index, allWords) => {
      return word.length > 0 && allWords.indexOf(word) === index;
    })
    .slice(0, 3);

  if (normalized.length > 0) {
    return normalized;
  }

  const words = new Set<string>();

  signals.forEach((signal) => {
    words.add(signal.fingerprintJson.theme);
    signal.fingerprintJson.tags.forEach((tag) => words.add(tag));
  });

  return Array.from(words).filter((word) => word.length > 0).slice(0, 3);
}

function normalizeSummary(summary: string): string {
  return summary.trim().slice(0, 100);
}

async function toMonthlyRecapDetail(
  recap: MonthlyRecapRecord,
): Promise<MonthlyRecapDetail> {
  const topSignal =
    recap.topSignalId === null
      ? undefined
      : await findPublishedSignalForMonthlyRecap({
          frequencyId: recap.frequencyId,
          signalId: recap.topSignalId,
        });

  return {
    createdAt: recap.createdAt.toISOString(),
    frequencyId: recap.frequencyId,
    generatedAt: recap.generatedAt.toISOString(),
    id: recap.id,
    signalCount: recap.signalCount,
    summary: recap.summary,
    themeWords: recap.themeWords,
    topSignal: topSignal === undefined ? undefined : toMySignalSummary(topSignal),
    totalResonanceCount: recap.totalResonanceCount,
    updatedAt: recap.updatedAt.toISOString(),
    yearMonth: recap.yearMonth,
  };
}

export async function generateMonthlyRecap(params: {
  frequency: AuthenticatedFrequency;
  yearMonth?: string;
}): Promise<MonthlyRecapDetail> {
  assertActiveFrequency(params.frequency);

  const yearMonth = params.yearMonth ?? getPreviousYearMonth();
  const range = getMonthRange(yearMonth);
  const signals = await listMonthlyRecapSignals({
    endAt: range.endAt,
    frequencyId: params.frequency.id,
    startAt: range.startAt,
  });

  if (signals.length < minSignalsForMonthlyRecap) {
    throw new AppError("CONFLICT", "Not enough signals for monthly recap.", {
      minSignals: minSignalsForMonthlyRecap,
      signalCount: signals.length,
      yearMonth,
    });
  }

  const topSignal = pickTopSignal(signals);
  const aiResult = await summarizeMonthlyRecapWithFallback({
    content: buildRecapInput(signals),
  }, {
    targetId: params.frequency.id,
    targetType: "USER",
  });
  const recap = await upsertMonthlyRecap({
    frequencyId: params.frequency.id,
    signalCount: signals.length,
    summary: normalizeSummary(aiResult.result.summary),
    themeWords: normalizeThemeWords(aiResult.result.themeWords, signals),
    topSignalId: topSignal?.id,
    totalResonanceCount: signals.reduce((total, signal) => {
      return total + signal.resonanceCount;
    }, 0),
    yearMonth,
  });

  return toMonthlyRecapDetail(recap);
}

export async function getMonthlyRecap(params: {
  frequency: AuthenticatedFrequency;
  yearMonth: string;
}): Promise<MonthlyRecapDetail> {
  const recap = await findMonthlyRecap({
    frequencyId: params.frequency.id,
    yearMonth: params.yearMonth,
  });

  if (recap === undefined) {
    throw new AppError("NOT_FOUND", "Monthly recap not found.");
  }

  return toMonthlyRecapDetail(recap);
}

export async function getLatestMonthlyRecap(
  frequency: AuthenticatedFrequency,
): Promise<MonthlyRecapDetail | undefined> {
  const recap = await findLatestMonthlyRecap(frequency.id);

  return recap === undefined ? undefined : toMonthlyRecapDetail(recap);
}
