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
    trimmedValue.length === 0 || trimmedValue.length > 2048 || /[\u0000-\u001f\u007f]/.test(trimmedValue) ||
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

    const path = parsedUrl.pathname;
    if (!/^(?:\/|\/me|\/galaxy|\/admin|\/result\/[a-zA-Z0-9-]{1,64}|\/signal\/[a-zA-Z0-9-]{1,64}\/transmitting|\/me\/recap\/\d{4}-\d{2})$/.test(path)) return undefined;
    const query = new URLSearchParams();
    for (const [key, entry] of parsedUrl.searchParams) {
      if (key === "continue" && path === "/" && entry === "1") query.set(key, entry);
      if (key === "onboarding" && ["seed", "result", "galaxy", "login", "registered", "complete"].includes(entry)) query.set(key, entry);
      if (key === "from" && ["home", "galaxy"].includes(entry)) query.set(key, entry);
      if (key === "band" && path === "/galaxy" && /^[a-z_]{1,40}$/.test(entry)) query.set(key, entry);
    }
    const hash = /^#[a-zA-Z0-9-]{1,32}$/.test(parsedUrl.hash) ? parsedUrl.hash : "";
    return `${path}${query.size ? `?${query}` : ""}${hash}`;
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
