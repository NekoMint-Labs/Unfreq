export type ThemeRadioDay = {
  createdAt: string;
  description?: string;
  endsAt?: string;
  id: string;
  isActive: boolean;
  startsAt: string;
  theme: string;
  title: string;
  updatedAt: string;
};

export type ThemeRadioDayDetail = ThemeRadioDay;

export type ThemeRadioDayResponse = {
  themeRadioDay?: ThemeRadioDay;
};

export type ThemeRadioDayInput = {
  description?: string;
  endsAt?: string;
  startsAt?: string;
  theme: string;
  title: string;
};
