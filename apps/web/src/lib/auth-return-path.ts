export const authSuccessFallbackPaths = {
  login: "/me?onboarding=login",
  registration: "/me?onboarding=registered",
} as const;

export type AuthSuccessFlow = keyof typeof authSuccessFallbackPaths;

export const sanitizeAuthReturnPath = (
  value: string | string[] | undefined,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (
    trimmedValue.length === 0 ||
    !trimmedValue.startsWith("/") ||
    trimmedValue.startsWith("//") ||
    trimmedValue.includes("\\") ||
    trimmedValue.includes("\n") ||
    trimmedValue.includes("\r")
  ) {
    return undefined;
  }

  try {
    const baseOrigin = "https://unfreq.local";
    const parsedUrl = new URL(trimmedValue, baseOrigin);

    if (parsedUrl.origin !== baseOrigin) {
      return undefined;
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return undefined;
  }
};

export const getAuthSuccessPath = (
  returnPath: string | string[] | undefined,
  flow: AuthSuccessFlow,
): string => {
  return sanitizeAuthReturnPath(returnPath) ?? authSuccessFallbackPaths[flow];
};
