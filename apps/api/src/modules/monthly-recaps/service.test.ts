import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors.js";
import { summarizeMonthlyRecapWithFallback } from "../ai/service.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import {
  findLatestMonthlyRecap,
  findMonthlyRecap,
  findPublishedSignalForMonthlyRecap,
  listMonthlyRecapSignals,
  upsertMonthlyRecap,
} from "./repository.js";
import type { MonthlyRecapRecord, MonthlyRecapSignal } from "./types.js";
import {
  generateMonthlyRecap,
  getLatestMonthlyRecap,
  getPreviousYearMonth,
} from "./service.js";

const monthlyStore = vi.hoisted(() => {
  return {
    recaps: [] as MonthlyRecapRecord[],
    signals: [] as MonthlyRecapSignal[],
  };
});

vi.mock("../ai/service.js", () => {
  return {
    summarizeMonthlyRecapWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: {
          summary: "这个月的信号靠近孤独和等待，也留下了继续往前看的余地。",
          themeWords: ["孤独", "等待", "夜晚"],
        },
        reviewId: "00000000-0000-4000-8000-000000000801",
      });
    }),
  };
});

vi.mock("./repository.js", () => {
  return {
    findLatestMonthlyRecap: vi.fn((frequencyId: string) => {
      return Promise.resolve(
        monthlyStore.recaps.find((recap) => recap.frequencyId === frequencyId),
      );
    }),
    findMonthlyRecap: vi.fn(
      (params: { frequencyId: string; yearMonth: string }) => {
        return Promise.resolve(
          monthlyStore.recaps.find((recap) => {
            return recap.frequencyId === params.frequencyId && recap.yearMonth === params.yearMonth;
          }),
        );
      },
    ),
    findPublishedSignalForMonthlyRecap: vi.fn(
      (params: { frequencyId: string; signalId: string }) => {
        return Promise.resolve(
          monthlyStore.signals.find((signal) => signal.id === params.signalId) ??
            undefined,
        );
      },
    ),
    listMonthlyRecapSignals: vi.fn(() => {
      return Promise.resolve(monthlyStore.signals);
    }),
    upsertMonthlyRecap: vi.fn((params: {
      frequencyId: string;
      signalCount: number;
      summary: string;
      themeWords: string[];
      topSignalId?: string;
      totalResonanceCount: number;
      yearMonth: string;
    }) => {
      const now = new Date("2026-05-15T08:00:00.000Z");
      const recap: MonthlyRecapRecord = {
        createdAt: now,
        frequencyId: params.frequencyId,
        generatedAt: now,
        id: "00000000-0000-4000-8000-000000000901",
        signalCount: params.signalCount,
        summary: params.summary,
        themeWords: params.themeWords,
        topSignalId: params.topSignalId ?? null,
        totalResonanceCount: params.totalResonanceCount,
        updatedAt: now,
        yearMonth: params.yearMonth,
      };

      monthlyStore.recaps = [recap];
      return Promise.resolve(recap);
    }),
  };
});

const activeFrequency: AuthenticatedFrequency = {
  createdAt: "2026-05-01T00:00:00.000Z",
  freqCode: "FM 27.51",
  id: "00000000-0000-4000-8000-000000000301",
  role: "USER",
  status: "ACTIVE",
};

function buildSignal(id: string, resonanceCount: number): MonthlyRecapSignal {
  return {
    createdAt: new Date(`2026-04-0${Number(id.slice(-1))}T12:00:00.000Z`),
    expandedText: `第 ${id.slice(-1)} 段扩写信号，写下一个具体的夜晚和没有说完的话。`,
    fingerprintJson: {
      tags: ["孤独", "夜晚"],
      theme: "孤独",
    },
    id,
    parentSignalId: null,
    resonanceCount,
    seedText: `第 ${id.slice(-1)} 句种子`,
    status: "PUBLISHED",
  };
}

beforeEach(() => {
  monthlyStore.recaps = [];
  monthlyStore.signals = [];
  vi.clearAllMocks();
});

describe("monthly recap service", () => {
  it("uses the previous UTC month by default", () => {
    expect(getPreviousYearMonth(new Date("2026-05-15T00:00:00.000Z"))).toBe("2026-04");
    expect(getPreviousYearMonth(new Date("2026-01-15T00:00:00.000Z"))).toBe("2025-12");
  });

  it("rejects recap generation when the month has fewer than three signals", async () => {
    monthlyStore.signals = [
      buildSignal("00000000-0000-4000-8000-000000000001", 1),
      buildSignal("00000000-0000-4000-8000-000000000002", 2),
    ];

    await expect(generateMonthlyRecap({
      frequency: activeFrequency,
      yearMonth: "2026-04",
    })).rejects.toMatchObject({
      code: "CONFLICT",
    } satisfies Partial<AppError>);
    expect(summarizeMonthlyRecapWithFallback).not.toHaveBeenCalled();
  });

  it("generates and stores a monthly recap idempotently for a valid month", async () => {
    monthlyStore.signals = [
      buildSignal("00000000-0000-4000-8000-000000000001", 1),
      buildSignal("00000000-0000-4000-8000-000000000002", 5),
      buildSignal("00000000-0000-4000-8000-000000000003", 3),
    ];

    const recap = await generateMonthlyRecap({
      frequency: activeFrequency,
      yearMonth: "2026-04",
    });

    expect(listMonthlyRecapSignals).toHaveBeenCalledWith({
      endAt: new Date("2026-05-01T00:00:00.000Z"),
      frequencyId: activeFrequency.id,
      startAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(upsertMonthlyRecap).toHaveBeenCalledWith({
      frequencyId: activeFrequency.id,
      signalCount: 3,
      summary: "这个月的信号靠近孤独和等待，也留下了继续往前看的余地。",
      themeWords: ["孤独", "等待", "夜晚"],
      topSignalId: "00000000-0000-4000-8000-000000000002",
      totalResonanceCount: 9,
      yearMonth: "2026-04",
    });
    expect(recap).toMatchObject({
      signalCount: 3,
      themeWords: ["孤独", "等待", "夜晚"],
      topSignal: {
        id: "00000000-0000-4000-8000-000000000002",
        resonanceCount: 5,
      },
      totalResonanceCount: 9,
      yearMonth: "2026-04",
    });
  });

  it("returns the latest saved recap without regenerating it", async () => {
    monthlyStore.signals = [
      buildSignal("00000000-0000-4000-8000-000000000001", 1),
    ];
    monthlyStore.recaps = [{
      createdAt: new Date("2026-05-15T08:00:00.000Z"),
      frequencyId: activeFrequency.id,
      generatedAt: new Date("2026-05-15T08:00:00.000Z"),
      id: "00000000-0000-4000-8000-000000000901",
      signalCount: 3,
      summary: "这个月的信号靠近孤独和等待。",
      themeWords: ["孤独"],
      topSignalId: "00000000-0000-4000-8000-000000000001",
      totalResonanceCount: 4,
      updatedAt: new Date("2026-05-15T08:00:00.000Z"),
      yearMonth: "2026-04",
    }];

    const recap = await getLatestMonthlyRecap(activeFrequency);

    expect(findLatestMonthlyRecap).toHaveBeenCalledWith(activeFrequency.id);
    expect(findMonthlyRecap).not.toHaveBeenCalled();
    expect(recap).toMatchObject({
      topSignal: {
        id: "00000000-0000-4000-8000-000000000001",
      },
      yearMonth: "2026-04",
    });
    expect(findPublishedSignalForMonthlyRecap).toHaveBeenCalledWith({
      frequencyId: activeFrequency.id,
      signalId: "00000000-0000-4000-8000-000000000001",
    });
  });
});
