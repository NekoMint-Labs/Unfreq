import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import {
  createSignalEchoBodySchema,
  createPublishedSignalBodySchema,
  signalAudioResponseSchema,
  signalAudioSideParamsSchema,
  signalEchoResponseSchema,
  signalEchoesResponseSchema,
  signalGalaxyQuerySchema,
  signalGalaxyResponseSchema,
  signalHallResponseSchema,
  signalIdParamsSchema,
  signalMatchesResponseSchema,
  signalResonanceBodySchema,
  signalResonanceResponseSchema,
  signalResponseSchema,
  signalSaveResponseSchema,
} from "./schemas.js";
import {
  addSignalEcho,
  addSignalResonance,
  addSignalSave,
  createPendingSignal,
  getRandomSignal,
  getSignalAudio,
  getSignalAudioDownload,
  getSignalDetailForFrequency,
  getSignalEchoes,
  getSignalGalaxy,
  getSignalHall,
  getSignalMatches,
  publishSignalForOwner,
  requestSignalAudio,
  removeSignalSave,
  removeSignalResonance,
} from "./service.js";

export async function signalRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
    const parsedBody = createPublishedSignalBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const signal = await createPendingSignal(
      request.frequency,
      parsedBody.data,
      request.log,
    );
    const response = signalResponseSchema.parse({ signal });

    request.log.info(
      {
        action: "signal.generation.queued",
        requestId: request.id,
        targetId: signal.id,
        targetType: "SIGNAL",
        userId: request.frequency?.id,
      },
      "signal generation queued",
    );

    return sendData(reply, request, response, 201);
  });

  app.get("/hall", async (request, reply) => {
    const signals = await getSignalHall();
    const response = signalHallResponseSchema.parse({ signals });

    return sendData(reply, request, response);
  });

  app.get("/random", async (request, reply) => {
    const signal = await getRandomSignal(request.frequency);
    const response = signalResponseSchema.parse({ signal });

    return sendData(reply, request, response);
  });

  app.get("/galaxy", async (request, reply) => {
    const parsedQuery = signalGalaxyQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedQuery.error.flatten());
    }

    const galaxy = await getSignalGalaxy(request.frequency, parsedQuery.data, request.log);
    const response = signalGalaxyResponseSchema.parse(galaxy);

    return sendData(reply, request, response);
  });

  app.get("/:id/audio", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const audio = await getSignalAudio(parsedParams.data.id, request.log);
    const response = signalAudioResponseSchema.parse({ audio });

    return sendData(reply, request, response);
  });

  app.post("/:id/audio", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const audio = await requestSignalAudio(parsedParams.data.id, request.log);
    const response = signalAudioResponseSchema.parse({ audio });

    request.log.info(
      {
        action: "signal.audio.request",
        requestId: request.id,
        targetId: audio.signalId,
        targetType: "SIGNAL",
        userId: request.frequency?.id,
      },
      "signal audio requested",
    );

    return sendData(reply, request, response);
  });

  app.get("/:id/audio/:side", async (request, reply) => {
    const parsedParams = signalAudioSideParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const download = await getSignalAudioDownload(
      parsedParams.data.id,
      parsedParams.data.side,
    );

    return reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("content-type", "audio/mpeg")
      .send(download.stream);
  });

  app.post("/:id/resonance", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);
    const parsedBody = signalResonanceBodySchema.safeParse(request.body ?? {});

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const resonance = await addSignalResonance(
      parsedParams.data.id,
      request.frequency,
      parsedBody.data,
    );
    const response = signalResonanceResponseSchema.parse({ resonance });

    return sendData(reply, request, response);
  });

  app.post("/:id/resonate", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);
    const parsedBody = signalResonanceBodySchema.safeParse(request.body ?? {});

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const resonance = await addSignalResonance(
      parsedParams.data.id,
      request.frequency,
      parsedBody.data,
    );
    const response = signalResonanceResponseSchema.parse({ resonance });

    return sendData(reply, request, response);
  });

  app.delete("/:id/resonance", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);
    const parsedBody = signalResonanceBodySchema.safeParse(request.body ?? {});

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const resonance = await removeSignalResonance(
      parsedParams.data.id,
      request.frequency,
      parsedBody.data,
    );
    const response = signalResonanceResponseSchema.parse({ resonance });

    return sendData(reply, request, response);
  });

  app.post("/:id/save", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const save = await addSignalSave(parsedParams.data.id, request.frequency);
    const response = signalSaveResponseSchema.parse({ save });

    return sendData(reply, request, response);
  });

  app.delete("/:id/save", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const save = await removeSignalSave(parsedParams.data.id, request.frequency);
    const response = signalSaveResponseSchema.parse({ save });

    return sendData(reply, request, response);
  });

  app.post("/:id/publish", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const signal = await publishSignalForOwner(parsedParams.data.id, request.frequency);
    const response = signalResponseSchema.parse({ signal });

    request.log.info(
      {
        action: "signal.publish.confirm",
        requestId: request.id,
        targetId: signal.id,
        targetType: "SIGNAL",
        userId: request.frequency?.id,
      },
      "signal publish confirmed",
    );

    return sendData(reply, request, response);
  });

  app.get("/:id", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const signal = await getSignalDetailForFrequency(parsedParams.data.id, request.frequency);
    const response = signalResponseSchema.parse({ signal });

    return sendData(reply, request, response);
  });

  app.get("/:id/matches", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const matches = await getSignalMatches(parsedParams.data.id);
    const response = signalMatchesResponseSchema.parse({ matches });

    return sendData(reply, request, response);
  });

  app.get("/:id/echoes", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const echoes = await getSignalEchoes(parsedParams.data.id);
    const response = signalEchoesResponseSchema.parse({ echoes });

    return sendData(reply, request, response);
  });

  app.post("/:id/echoes", async (request, reply) => {
    const parsedParams = signalIdParamsSchema.safeParse(request.params);
    const parsedBody = createSignalEchoBodySchema.safeParse(request.body);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const echo = await addSignalEcho(
      parsedParams.data.id,
      request.frequency,
      parsedBody.data,
    );
    const response = signalEchoResponseSchema.parse({ echo });

    request.log.info(
      {
        action: "signal.echo.create",
        requestId: request.id,
        targetId: echo.id,
        targetType: "SIGNAL_ECHO",
        userId: request.frequency?.id,
      },
      "signal echo created",
    );

    return sendData(reply, request, response, 201);
  });
}
