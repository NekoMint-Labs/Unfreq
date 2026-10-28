export type {
  ThemeRadioDayDetail,
  ThemeRadioDayInput,
} from "@unfreq/contracts/theme-radio";

export type ThemeRadioDayRecord = {
  createdAt: Date;
  description: string | null;
  endsAt: Date | null;
  id: string;
  isActive: boolean;
  startsAt: Date;
  theme: string;
  title: string;
  updatedAt: Date;
};
