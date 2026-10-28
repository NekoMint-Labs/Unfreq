import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import {
  createThemeRadioDayBodySchema,
  themeRadioDayResponseSchema,
  themeRadioDaysResponseSchema,
} from "./schemas.js";
import {
  addThemeRadioDay,
  getCurrentThemeRadioDay,
  getThemeRadioDays,
} from "./service.js";

export async function themeRadioRoutes(app: FastifyInstance) {
  app.get("/current", async (request, reply) => {
    const themeRadioDay = await getCurrentThemeRadioDay();
    const response = themeRadioDayResponseSchema.parse({ themeRadioDay });

    return sendData(reply, request, response);
  });
}

export async function adminThemeRadioRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const themeRadioDays = await getThemeRadioDays(request.requireFrequency());
    const response = themeRadioDaysResponseSchema.parse({ themeRadioDays });

    return sendData(reply, request, response);
  });

  app.post("/", async (request, reply) => {
    const parsedBody = createThemeRadioDayBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const themeRadioDay = await addThemeRadioDay({
      frequency: request.requireFrequency(),
      input: parsedBody.data,
    });
    const response = themeRadioDayResponseSchema.parse({ themeRadioDay });

    request.log.info(
      {
        action: "theme_radio_day.create",
        requestId: request.id,
        targetId: themeRadioDay.id,
        targetType: "SIGNAL",
        theme: themeRadioDay.theme,
        userId: request.frequency?.id,
      },
      "theme radio day created",
    );

    return sendData(reply, request, response, 201);
  });
}
