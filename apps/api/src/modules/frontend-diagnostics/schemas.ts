import { z } from "zod";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const secretPattern =
  /\b(cookie|session|token|authorization|bearer)\b\s*[:=]\s*[^\s;]+/gi;

const redactSensitiveText = (value: string): string => {
  return value
    .replace(emailPattern, "[redacted-email]")
    .replace(secretPattern, "$1=[redacted-secret]");
};

const diagnosticTextSchema = (maxLength: number) => {
  return z.string().trim().min(1).max(maxLength).transform(redactSensitiveText);
};

export const frontendDiagnosticSourceSchema = z.enum([
  "client-runtime",
  "route-error",
  "service-worker-registration",
  "unhandled-rejection",
]);

export const frontendDiagnosticBodySchema = z
  .object({
    correlationId: z
      .string()
      .trim()
      .min(6)
      .max(120)
      .regex(/^[A-Za-z0-9._:-]+$/),
    digest: diagnosticTextSchema(120).optional(),
    message: diagnosticTextSchema(300),
    name: diagnosticTextSchema(120),
    requestId: diagnosticTextSchema(120).optional(),
    route: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^\/[A-Za-z0-9/_~.%:-]*$/),
    source: frontendDiagnosticSourceSchema,
  })
  .strict();

export type FrontendDiagnosticBody = z.infer<typeof frontendDiagnosticBodySchema>;
