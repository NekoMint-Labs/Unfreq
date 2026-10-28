import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { sessionCookieName } from "../../plugins/auth.js";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import {
  echoSummaryResponseSchema,
  mySignalsResponseSchema,
  savedSignalsResponseSchema,
} from "../signals/schemas.js";
import {
  getMyEchoSummary,
  getMySignals,
  getSavedSignals,
} from "../signals/service.js";
import {
  getSessionTtlSeconds,
  loginWithFrequencyCredentials,
  requestLoginChallenge,
  registerFrequency,
  verifyLoginChallenge,
} from "./service.js";
import {
  frequencyLoginBodySchema,
  loginRequestBodySchema,
  loginVerifyBodySchema,
  registerFrequencyBodySchema,
} from "./schemas.js";
import type {
  FrequencyIdentity,
  LoginChallengeResponse,
} from "./types.js";

function buildSessionCookie(sessionToken: string, maxAgeSeconds: number): string {
  const parts = [
    `${sessionCookieName}=${sessionToken}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (env.isProduction) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function buildClearedSessionCookie(): string {
  const parts = [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (env.isProduction) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function toFrequencyResponse(frequency: FrequencyIdentity): FrequencyIdentity & { code: string } {
  return {
    ...frequency,
    code: frequency.freqCode,
  };
}

export async function frequencyRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
    if (request.frequency !== undefined) {
      return sendData(reply, request, {
        frequency: toFrequencyResponse(request.frequency),
      });
    }

    throw new AppError("UNAUTHORIZED", "Frequency login required.");
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/guest", async () => {
    throw new AppError("FORBIDDEN", "Guest frequency creation is disabled.");
  });

  app.post("/register", async (request, reply) => {
    const parsedBody = registerFrequencyBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const result = await registerFrequency(parsedBody.data);

    reply.header(
      "set-cookie",
      buildSessionCookie(result.sessionToken, getSessionTtlSeconds()),
    );

    request.log.info(
      {
        action: "auth.frequency.register",
        freqCode: result.frequency.freqCode,
        requestId: request.id,
        userId: result.frequency.id,
      },
      "frequency registered",
    );

    return sendData(reply, request, result, 201);
  });

  app.post("/login", async (request, reply) => {
    const parsedBody = loginRequestBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const result = await requestLoginChallenge(app.redis, parsedBody.data.email);

    request.log.info(
      {
        action: "auth.login.challenge.request",
        email: result.localDelivery.maskedEmail,
        loginChallengeCode: result.localDelivery.code,
        loginChallengeMode: result.delivery.mode,
        loginChallengeRequestId: request.id,
        requestId: request.id,
      },
      "login challenge issued",
    );

    const response: LoginChallengeResponse = {
      challenge: result.challenge,
      delivery: result.delivery,
    };

    return sendData(reply, request, response);
  });

  app.post("/login/verify", async (request, reply) => {
    const parsedBody = loginVerifyBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const result = await verifyLoginChallenge(app.redis, parsedBody.data);

    reply.header(
      "set-cookie",
      buildSessionCookie(result.sessionToken, getSessionTtlSeconds()),
    );

    request.log.info(
      {
        action: "auth.login.challenge.verify",
        freqCode: result.frequency.freqCode,
        requestId: request.id,
        userId: result.frequency.id,
      },
      "frequency login completed",
    );

    return sendData(reply, request, result);
  });

  app.post("/frequency/login", async (request, reply) => {
    const parsedBody = frequencyLoginBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const result = await loginWithFrequencyCredentials(parsedBody.data);

    reply.header(
      "set-cookie",
      buildSessionCookie(result.sessionToken, getSessionTtlSeconds()),
    );

    request.log.info(
      {
        action: "auth.frequency.login",
        freqCode: result.frequency.freqCode,
        requestId: request.id,
        userId: result.frequency.id,
      },
      "frequency login completed",
    );

    return sendData(reply, request, result);
  });

  app.post("/frequency/save", async () => {
    throw new AppError(
      "FORBIDDEN",
      "Frequency naming is disabled. Register a random FM with a password.",
    );
  });

  app.post("/frequency/suggestions", async () => {
    throw new AppError(
      "FORBIDDEN",
      "Frequency name suggestions are disabled.",
    );
  });

  app.post("/logout", async (request, reply) => {
    reply.header("set-cookie", buildClearedSessionCookie());

    if (request.frequency !== undefined) {
      request.log.info(
        {
          freqCode: request.frequency.freqCode,
          requestId: request.id,
          userId: request.frequency.id,
        },
        "frequency logout completed",
      );
    }

    return sendData(reply, request, { ok: true });
  });
}

export async function meRoutes(app: FastifyInstance) {
  app.get("/me", async (request, reply) => {
    const frequency = request.requireFrequency();

    return sendData(reply, request, {
      frequency,
    });
  });

  app.get("/me/signals", async (request, reply) => {
    const frequency = request.requireFrequency();
    const result = await getMySignals(frequency);
    const response = mySignalsResponseSchema.parse(result);

    return sendData(reply, request, response);
  });

  app.get("/me/saves", async (request, reply) => {
    const frequency = request.requireFrequency();
    const result = await getSavedSignals(frequency);
    const response = savedSignalsResponseSchema.parse(result);

    return sendData(reply, request, response);
  });

  app.get("/me/echo-summary", async (request, reply) => {
    const frequency = request.requireFrequency();
    const summary = await getMyEchoSummary(frequency);
    const response = echoSummaryResponseSchema.parse({ summary });

    return sendData(reply, request, response);
  });

  app.post("/me/echo-summary/seen", async (request, reply) => {
    const frequency = request.requireFrequency();
    const summary = await getMyEchoSummary(frequency, {
      markSeen: true,
    });
    const response = echoSummaryResponseSchema.parse({ summary });

    return sendData(reply, request, response);
  });
}
