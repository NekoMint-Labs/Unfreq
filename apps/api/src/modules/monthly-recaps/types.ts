import type {
  SignalFingerprint,
} from "@unfreq/contracts/signals";

export type {
  MonthlyRecapDetail,
} from "@unfreq/contracts/signals";

type MonthlyRecapFingerprint = Pick<SignalFingerprint, "tags" | "theme"> &
  Partial<
    Pick<
      SignalFingerprint,
      | "coreNeed"
      | "emotionTone"
      | "hiddenNeed"
      | "innerConflict"
      | "narrativeConflict"
      | "primaryBand"
      | "primaryEmotion"
      | "resonanceKeywords"
      | "subFeeling"
    >
  >;

export type MonthlyRecapSignal = {
  createdAt: Date;
  expandedText: string;
  fingerprintJson: MonthlyRecapFingerprint;
  id: string;
  parentSignalId: string | null;
  resonanceCount: number;
  seedText: string;
  status: "PUBLISHED";
};

export type MonthlyRecapRecord = {
  createdAt: Date;
  frequencyId: string;
  generatedAt: Date;
  id: string;
  signalCount: number;
  summary: string;
  themeWords: string[];
  topSignalId: string | null;
  totalResonanceCount: number;
  updatedAt: Date;
  yearMonth: string;
};
