import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import {
  createThemeRadioDay,
  findCurrentThemeRadioDay,
  listThemeRadioDays,
} from "./repository.js";
import type {
  ThemeRadioDayDetail,
  ThemeRadioDayInput,
  ThemeRadioDayRecord,
} from "./types.js";

const themeRadioDayLimit = 20;

function toThemeRadioDayDetail(record: ThemeRadioDayRecord): ThemeRadioDayDetail {
  return {
    createdAt: record.createdAt.toISOString(),
    description: record.description ?? undefined,
    endsAt: record.endsAt?.toISOString(),
    id: record.id,
    isActive: record.isActive,
    startsAt: record.startsAt.toISOString(),
    theme: record.theme,
    title: record.title,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function requireAdmin(frequency: AuthenticatedFrequency) {
  if (frequency.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Admin access required.");
  }
}

function assertValidRange(input: ThemeRadioDayInput) {
  if (input.startsAt === undefined || input.endsAt === undefined) {
    return;
  }

  if (new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new AppError("VALIDATION_ERROR", "Invalid request.", {
      endsAt: ["Must be after startsAt."],
    });
  }
}

export async function getCurrentThemeRadioDay(): Promise<ThemeRadioDayDetail | undefined> {
  const current = await findCurrentThemeRadioDay();

  return current === undefined ? undefined : toThemeRadioDayDetail(current);
}

export async function getThemeRadioDays(
  frequency: AuthenticatedFrequency,
): Promise<ThemeRadioDayDetail[]> {
  requireAdmin(frequency);

  const days = await listThemeRadioDays(themeRadioDayLimit);

  return days.map(toThemeRadioDayDetail);
}

export async function addThemeRadioDay(params: {
  frequency: AuthenticatedFrequency;
  input: ThemeRadioDayInput;
}): Promise<ThemeRadioDayDetail> {
  requireAdmin(params.frequency);
  assertValidRange(params.input);

  const day = await createThemeRadioDay(params.input);

  return toThemeRadioDayDetail(day);
}
