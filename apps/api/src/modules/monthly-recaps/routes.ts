import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import {
  generateMonthlyRecapBodySchema,
  latestMonthlyRecapResponseSchema,
  monthlyRecapParamsSchema,
  monthlyRecapResponseSchema,
} from "./schemas.js";
import {
  generateMonthlyRecap,
  getLatestMonthlyRecap,
  getMonthlyRecap,
} from "./service.js";

export async function monthlyRecapRoutes(app: FastifyInstance) {
  app.get("/latest", async (request, reply) => {
    const frequency = request.requireFrequency();
    const recap = await getLatestMonthlyRecap(frequency);
    const response = latestMonthlyRecapResponseSchema.parse({ recap });

    return sendData(reply, request, response);
  });

  app.post("/", async (request, reply) => {
    const frequency = request.requireFrequency();
    const parsedBody = generateMonthlyRecapBodySchema.safeParse(request.body ?? {});

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const recap = await generateMonthlyRecap({
      frequency,
      yearMonth: parsedBody.data.yearMonth,
    });
    const response = monthlyRecapResponseSchema.parse({ recap });

    request.log.info(
      {
        action: "monthly_recap.generate",
        requestId: request.id,
        targetId: recap.id,
        targetType: "USER",
        userId: frequency.id,
        yearMonth: recap.yearMonth,
      },
      "monthly recap generated",
    );

    return sendData(reply, request, response, 201);
  });

  app.get("/:yearMonth", async (request, reply) => {
    const frequency = request.requireFrequency();
    const parsedParams = monthlyRecapParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const recap = await getMonthlyRecap({
      frequency,
      yearMonth: parsedParams.data.yearMonth,
    });
    const response = monthlyRecapResponseSchema.parse({ recap });

    return sendData(reply, request, response);
  });
}
