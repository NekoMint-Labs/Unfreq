import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import {
  adminAiReviewQuerySchema,
  adminAiSignalQuerySchema,
  adminGenerateSignalsBodySchema,
  adminKeepSignalBodySchema,
  adminIdParamsSchema,
  adminProviderConfigBodySchema,
  adminProviderConfigIdParamsSchema,
  adminProviderConfigParamsSchema,
  adminProviderConfigTestQuerySchema,
  adminReportResolutionBodySchema,
  adminReportStatusQuerySchema,
  adminSignalQuerySchema,
  adminSignalStatusBodySchema,
  adminUserStatusBodySchema,
  adminUserStatusQuerySchema,
} from "./schemas.js";
import {
  changeAdminFrequencyStatus,
  changeAdminProviderConfig,
  createAdminProviderConfig,
  deleteAdminProviderConfig,
  changeAdminSignalKept,
  changeAdminSignalStatus,
  changeAdminReportStatus,
  changeAdminUserStatus,
  createAdminAiSignals,
  removeAdminSignal,
  readAdminAiReviews,
  readAdminAiEvaluation,
  readAdminOverview,
  readAdminProviderConfigs,
  readAdminFrequencies,
  readAdminReports,
  readAdminSignals,
  readAdminAiSignals,
  readAdminUsers,
  requireAdmin,
  testAdminProviderConfig,
  updateAdminProviderConfigById,
} from "./service.js";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request) => {
    const frequency = request.requireFrequency();
    requireAdmin(frequency);
  });

  app.get("/overview", async (request, reply) => {
    const overview = await readAdminOverview(request.requireFrequency());
    return sendData(reply, request, { overview });
  });

  app.get("/provider-configs", async (request, reply) => {
    const providerConfigs = await readAdminProviderConfigs(request.requireFrequency());
    return sendData(reply, request, { providerConfigs });
  });

  app.post("/provider-configs/:kind/test", async (request, reply) => {
    const parsedParams = adminProviderConfigParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const parsedBody = adminProviderConfigBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const parsedQuery = adminProviderConfigTestQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedQuery.error.flatten());
    }

    const result = await testAdminProviderConfig({
      body: parsedBody.data,
      environment: parsedQuery.data.environment === "1",
      frequency: request.requireFrequency(),
      id: parsedQuery.data.id,
      kind: parsedParams.data.kind,
    });

    request.log.info(
      {
        action: "admin.provider_config.test",
        freqCode: request.requireFrequency().freqCode,
        kind: parsedParams.data.kind,
        reason: result.reason,
        requestId: request.id,
        status: result.status,
        targetId: request.requireFrequency().id,
        targetType: "USER",
        userId: request.requireFrequency().id,
      },
      "admin provider config tested",
    );

    return sendData(reply, request, { result });
  });

  app.put("/provider-configs/:kind", async (request, reply) => {
    const parsedParams = adminProviderConfigParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const parsedBody = adminProviderConfigBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const providerConfig = await changeAdminProviderConfig({
      body: parsedBody.data,
      frequency: request.requireFrequency(),
      kind: parsedParams.data.kind,
    });

    request.log.info(
      {
        action: "admin.provider_config.update",
        freqCode: request.requireFrequency().freqCode,
        kind: providerConfig.kind,
        requestId: request.id,
        targetId: request.requireFrequency().id,
        targetType: "USER",
        userId: request.requireFrequency().id,
      },
      "admin provider config updated",
    );

    return sendData(reply, request, { providerConfig });
  });

  app.post("/provider-configs/:kind", async (request, reply) => {
    const parsedParams = adminProviderConfigParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const parsedBody = adminProviderConfigBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const providerConfig = await createAdminProviderConfig({
      body: parsedBody.data,
      frequency: request.requireFrequency(),
      kind: parsedParams.data.kind,
    });

    request.log.info(
      {
        action: "admin.provider_config.create",
        freqCode: request.requireFrequency().freqCode,
        kind: providerConfig.kind,
        requestId: request.id,
        targetId: providerConfig.id ?? request.requireFrequency().id,
        targetType: "USER",
        userId: request.requireFrequency().id,
      },
      "admin provider config created",
    );

    return sendData(reply, request, { providerConfig }, 201);
  });

  app.put("/provider-configs/:kind/:id", async (request, reply) => {
    const parsedParams = adminProviderConfigParamsSchema
      .merge(adminProviderConfigIdParamsSchema)
      .safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const parsedBody = adminProviderConfigBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const providerConfig = await updateAdminProviderConfigById({
      body: parsedBody.data,
      frequency: request.requireFrequency(),
      id: parsedParams.data.id,
      kind: parsedParams.data.kind,
    });

    request.log.info(
      {
        action: "admin.provider_config.update",
        freqCode: request.requireFrequency().freqCode,
        kind: providerConfig.kind,
        requestId: request.id,
        targetId: providerConfig.id ?? parsedParams.data.id,
        targetType: "USER",
        userId: request.requireFrequency().id,
      },
      "admin provider config updated",
    );

    return sendData(reply, request, { providerConfig });
  });

  app.delete("/provider-configs/:kind/:id", async (request, reply) => {
    const parsedParams = adminProviderConfigParamsSchema
      .merge(adminProviderConfigIdParamsSchema)
      .safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const providerConfig = await deleteAdminProviderConfig({
      frequency: request.requireFrequency(),
      id: parsedParams.data.id,
      kind: parsedParams.data.kind,
    });

    request.log.info(
      {
        action: "admin.provider_config.delete",
        freqCode: request.requireFrequency().freqCode,
        kind: parsedParams.data.kind,
        requestId: request.id,
        targetId: providerConfig.id ?? parsedParams.data.id,
        targetType: "USER",
        userId: request.requireFrequency().id,
      },
      "admin provider config deleted",
    );

    return sendData(reply, request, { providerConfig });
  });

  app.get("/reports", async (request, reply) => {
    const parsedQuery = adminReportStatusQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedQuery.error.flatten());
    }

    const reports = await readAdminReports(request.requireFrequency(), parsedQuery.data.status);
    return sendData(reply, request, { reports });
  });

  app.get("/signals", async (request, reply) => {
    const parsedQuery = adminSignalQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedQuery.error.flatten());
    }

    const signals = await readAdminSignals(request.requireFrequency(), parsedQuery.data);
    return sendData(reply, request, { signals });
  });

  app.patch("/signals/:id/status", async (request, reply) => {
    const parsedParams = adminIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const parsedBody = adminSignalStatusBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const signal = await changeAdminSignalStatus({
      frequency: request.requireFrequency(),
      id: parsedParams.data.id,
      status: parsedBody.data.status,
    });

    request.log.info(
      {
        action: "admin.signal.status.update",
        freqCode: request.requireFrequency().freqCode,
        requestId: request.id,
        status: signal.status,
        targetId: signal.id,
        targetType: "SIGNAL",
        userId: request.requireFrequency().id,
      },
      "admin signal status updated",
    );

    return sendData(reply, request, { signal });
  });

  app.patch("/reports/:id", async (request, reply) => {
    const parsedBody = adminReportResolutionBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const parsedParams = adminIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const report = await changeAdminReportStatus({
      frequency: request.requireFrequency(),
      id: parsedParams.data.id,
      resolution: parsedBody.data.resolution,
      status: parsedBody.data.status,
    });

    request.log.info(
      {
        action: "admin.report.status.update",
        freqCode: request.requireFrequency().freqCode,
        requestId: request.id,
        status: report.status,
        targetId: report.targetId,
        targetType: report.targetType,
        userId: request.requireFrequency().id,
      },
      "admin report status updated",
    );

    return sendData(reply, request, { report });
  });

  app.get("/users", async (request, reply) => {
    const parsedQuery = adminUserStatusQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedQuery.error.flatten());
    }

    const users = await readAdminUsers(request.requireFrequency(), parsedQuery.data.status);
    return sendData(reply, request, { users });
  });

  app.get("/frequencies", async (request, reply) => {
    const parsedQuery = adminUserStatusQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedQuery.error.flatten());
    }

    const frequencies = await readAdminFrequencies(
      request.requireFrequency(),
      parsedQuery.data.status,
    );
    return sendData(reply, request, { frequencies });
  });

  app.patch("/frequencies/:id/status", async (request, reply) => {
    const parsedBody = adminUserStatusBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const parsedParams = adminIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const frequency = await changeAdminFrequencyStatus({
      frequency: request.requireFrequency(),
      id: parsedParams.data.id,
      status: parsedBody.data.status,
    });

    request.log.info(
      {
        action: "admin.frequency.status.update",
        freqCode: request.requireFrequency().freqCode,
        requestId: request.id,
        status: frequency.status,
        targetId: frequency.id,
        targetType: "USER",
        userId: request.requireFrequency().id,
      },
      "admin frequency status updated",
    );

    return sendData(reply, request, { frequency });
  });

  app.patch("/users/:id/status", async (request, reply) => {
    const parsedBody = adminUserStatusBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const parsedParams = adminIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const user = await changeAdminUserStatus({
      frequency: request.requireFrequency(),
      id: parsedParams.data.id,
      status: parsedBody.data.status,
    });

    request.log.info(
      {
        action: "admin.user.status.update",
        freqCode: request.requireFrequency().freqCode,
        requestId: request.id,
        status: user.status,
        targetId: user.id,
        targetType: "USER",
        userId: request.requireFrequency().id,
      },
      "admin user status updated",
    );

    return sendData(reply, request, { user });
  });

  app.get("/ai-reviews", async (request, reply) => {
    const parsedQuery = adminAiReviewQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedQuery.error.flatten());
    }

    const aiReviews = await readAdminAiReviews(request.requireFrequency(), parsedQuery.data);
    return sendData(reply, request, { aiReviews });
  });

  app.get("/ai-evaluation", async (request, reply) => {
    const evaluation = await readAdminAiEvaluation(request.requireFrequency());
    return sendData(reply, request, { evaluation });
  });

  app.get("/ai-signals", async (request, reply) => {
    const parsedQuery = adminAiSignalQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedQuery.error.flatten());
    }

    const signals = await readAdminAiSignals(request.requireFrequency(), parsedQuery.data);
    return sendData(reply, request, { signals });
  });

  app.post("/ai-signals/generate", async (request, reply) => {
    const parsedBody = adminGenerateSignalsBodySchema.safeParse(request.body ?? {});

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const generation = await createAdminAiSignals({
      count: parsedBody.data.count,
      frequency: request.requireFrequency(),
      logger: request.log,
    });

    request.log.info(
      {
        accepted: generation.accepted,
        action: "admin.ai_signals.generate",
        freqCode: request.requireFrequency().freqCode,
        requestId: request.id,
        userId: request.requireFrequency().id,
      },
      "admin generated ai signals",
    );

    return sendData(reply, request, { generation }, 201);
  });

  app.delete("/ai-signals/:id", async (request, reply) => {
    const parsedParams = adminIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const signal = await removeAdminSignal({
      frequency: request.requireFrequency(),
      id: parsedParams.data.id,
    });

    request.log.info(
      {
        action: "admin.signal.delete",
        freqCode: request.requireFrequency().freqCode,
        requestId: request.id,
        targetId: signal.id,
        targetType: "SIGNAL",
        userId: request.requireFrequency().id,
      },
      "admin signal deleted",
    );

    return sendData(reply, request, { signal });
  });

  app.patch("/ai-signals/:id/keep", async (request, reply) => {
    const parsedParams = adminIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const parsedBody = adminKeepSignalBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const signal = await changeAdminSignalKept({
      frequency: request.requireFrequency(),
      id: parsedParams.data.id,
      isKept: parsedBody.data.isKept,
    });

    request.log.info(
      {
        action: "admin.signal.keep.update",
        freqCode: request.requireFrequency().freqCode,
        isKept: parsedBody.data.isKept,
        requestId: request.id,
        targetId: signal.id,
        targetType: "SIGNAL",
        userId: request.requireFrequency().id,
      },
      "admin signal kept state updated",
    );

    return sendData(reply, request, { signal });
  });
}
