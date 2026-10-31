const allowedErrorTypes = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "PostgresError", "FastifyError", "ZodError", "AbortError", "ReplyError"]);

export function safeErrorType(error: unknown): string {
  return error instanceof Error && allowedErrorTypes.has(error.name) ? error.name : "Error";
}

export function apiLogRedactionPaths(_config: { isProduction: boolean; authLoginDeliveryMode: string }): string[] {
  return ["authorization", "cookie", "password", "passwordHash", "sessionToken", "apiKey",
    "req.headers.authorization", "req.headers.cookie", "headers.authorization", "headers.cookie",
    "body", "req.body", "*.password", "*.passwordHash", "*.sessionToken", "*.apiKey",
    "seedText", "rawInput", "expandedText", "prompt", "messages",
    "*.seedText", "*.rawInput", "*.expandedText", "*.prompt", "*.messages",
    // Error serializers can copy driver commands, URLs and arbitrary text.
    // Call sites log an allow-listed type instead of raw Error objects.
    "err", "error", "stack", "loginChallengeCode"];
}
