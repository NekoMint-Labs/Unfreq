import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { authenticateSessionToken } from "../modules/auth/service.js";
import type { AuthenticatedFrequency } from "../modules/auth/types.js";
import { AppError } from "../shared/errors.js";

const sessionCookieName = "unfreq_session";

declare module "fastify" {
  interface FastifyRequest {
    frequency?: AuthenticatedFrequency;
    requireFrequency: () => AuthenticatedFrequency;
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");

    if (rawKey === name) {
      return rawValue.join("=");
    }
  }

  return undefined;
}

function readBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const [scheme, token, extra] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || extra !== undefined) {
    return undefined;
  }

  return token;
}

export const authPlugin = fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("frequency", undefined);
  app.decorateRequest("requireFrequency", function requireFrequency() {
    if (this.frequency === undefined) {
      throw new AppError("UNAUTHORIZED", "Frequency login required.");
    }

    return this.frequency;
  });

  app.addHook("preHandler", async (request) => {
    const token =
      readBearerToken(request.headers.authorization) ??
      readCookie(request.headers.cookie, sessionCookieName);

    if (token === undefined) {
      return;
    }

    request.frequency = await authenticateSessionToken(token);
  });
});

export { sessionCookieName };
