import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { ThemeRadioDayInput, ThemeRadioDayRecord } from "./types.js";

const themeStore = vi.hoisted(() => {
  return {
    rows: [] as ThemeRadioDayRecord[],
  };
});

vi.mock("../auth/service.js", () => {
  const frequency: AuthenticatedFrequency = {
    createdAt: "2026-05-10T00:00:00.000Z",
    freqCode: "FM-27.51",
    id: "00000000-0000-4000-8000-000000000301",
    role: "USER",
    status: "ACTIVE",
  };
  const adminFrequency: AuthenticatedFrequency = {
    createdAt: "2026-05-10T00:00:00.000Z",
    freqCode: "FM-99.01",
    id: "00000000-0000-4000-8000-000000000302",
    role: "ADMIN",
    status: "ACTIVE",
  };

  return {
    authenticateSessionToken: vi.fn((token: string) => {
      if (token === "active-token") {
        return Promise.resolve(frequency);
      }

      if (token === "admin-token") {
        return Promise.resolve(adminFrequency);
      }

      return Promise.resolve(undefined);
    }),
    getSessionTtlSeconds: vi.fn(() => 60 * 60 * 24 * 30),
  };
});

vi.mock("./repository.js", () => {
  return {
    createThemeRadioDay: vi.fn((input: ThemeRadioDayInput) => {
      const now = new Date("2026-05-10T12:00:00.000Z");
      const record: ThemeRadioDayRecord = {
        createdAt: now,
        description: input.description ?? null,
        endsAt: input.endsAt === undefined ? null : new Date(input.endsAt),
        id: `00000000-0000-4000-8000-${String(themeStore.rows.length + 1).padStart(12, "0")}`,
        isActive: true,
        startsAt: input.startsAt === undefined ? now : new Date(input.startsAt),
        theme: input.theme,
        title: input.title,
        updatedAt: now,
      };

      themeStore.rows.push(record);

      return Promise.resolve(record);
    }),
    findCurrentThemeRadioDay: vi.fn(() => {
      return Promise.resolve(themeStore.rows.find((row) => row.isActive));
    }),
    listThemeRadioDays: vi.fn(() => {
      return Promise.resolve(themeStore.rows);
    }),
  };
});

let app: FastifyInstance | undefined;

beforeEach(() => {
  themeStore.rows = [];
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("theme radio routes", () => {
  it("returns no current theme when none is configured", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "GET",
      url: "/api/theme-radio/current",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {},
    });
  });

  it("lets admins configure a theme radio day and exposes it publicly", async () => {
    const testApp = await buildApp();
    app = testApp;

    const createResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        description: "这一期只做轻提示和星图筛选。",
        endsAt: "2026-05-18T00:00:00.000Z",
        startsAt: "2026-05-10T00:00:00.000Z",
        theme: "孤独",
        title: "低频夜行日",
      },
      url: "/api/admin/theme-radio-days",
    });
    const currentResponse = await testApp.inject({
      method: "GET",
      url: "/api/theme-radio/current",
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      data: {
        themeRadioDay: {
          description: "这一期只做轻提示和星图筛选。",
          theme: "孤独",
          title: "低频夜行日",
        },
      },
    });
    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json()).toMatchObject({
      data: {
        themeRadioDay: {
          theme: "孤独",
          title: "低频夜行日",
        },
      },
    });
  });

  it("rejects theme radio configuration from normal frequencies", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        theme: "孤独",
        title: "低频夜行日",
      },
      url: "/api/admin/theme-radio-days",
    });

    expect(response.statusCode).toBe(403);
  });
});
