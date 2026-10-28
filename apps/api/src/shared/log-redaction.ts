export function apiLogRedactionPaths(config: { isProduction: boolean; authLoginDeliveryMode: string }): string[] {
  return ["authorization", "cookie", "password", "sessionToken", "apiKey",
    "req.headers.authorization", "req.headers.cookie", "headers.authorization", "headers.cookie",
    "body.password", "body.code", "*.password", "*.sessionToken", "*.apiKey",
    // A development local-log challenge deliberately uses this field as its
    // delivery channel. Production forbids that mode and redacts defensively.
    ...(config.isProduction || config.authLoginDeliveryMode !== "local-log" ? ["loginChallengeCode"] : [])];
}
