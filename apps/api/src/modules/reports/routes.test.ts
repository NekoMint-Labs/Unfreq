import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { ReportRecord } from "./types.js";
import { findOwnedReportRecord } from "./repository.js";

vi.mock("../auth/service.js", () => {
  const frequency: AuthenticatedFrequency = {
    createdAt: "2026-05-10T00:00:00.000Z",
    freqCode: "FM-27.51",
    id: "00000000-0000-4000-8000-000000000001",
    role: "USER",
    status: "ACTIVE",
  };

  return {
    authenticateSessionToken: vi.fn((token: string) => {
      return Promise.resolve(token === "active-token" ? frequency : undefined);
    }),
    getSessionTtlSeconds: vi.fn(() => 60 * 60 * 24 * 30),
    loginWithEmail: vi.fn(),
  };
});

vi.mock("./repository.js", () => {
  return {
    createReportRecord: vi.fn(
      (params: {
        body: {
          note?: string;
          reason: string;
          targetId: string;
          targetType: "SIGNAL" | "USER";
        };
        reporterId: string;
      }) => {
        const now = new Date("2026-05-10T12:00:00.000Z");
        const report: ReportRecord = {
          createdAt: now,
          id: "00000000-0000-4000-8000-000000000101",
          note: params.body.note ?? null,
          reason: params.body.reason,
          reporterFreqCode: "FM-27.51",
          reporterId: params.reporterId,
          resolvedAt: null,
          resolvedById: null,
          resolution: null,
          status: "PENDING",
          targetId: params.body.targetId,
          targetType: params.body.targetType,
          updatedAt: now,
        };

        return Promise.resolve(report);
      },
    ),
    listReportRecords: vi.fn(),
    findOwnedReportRecord: vi.fn(async () => undefined),
    updateReportRecord: vi.fn(),
  };
});

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("report routes", () => {
  it("requires a session before creating a report", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        reason: "泄露隐私",
        targetId: "00000000-0000-4000-8000-000000000201",
        targetType: "SIGNAL",
      },
      url: "/api/reports",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("creates a report with the shared response envelope", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        note: "这段信号暴露了具体姓名。",
        reason: "泄露隐私",
        targetId: "00000000-0000-4000-8000-000000000201",
        targetType: "SIGNAL",
      },
      url: "/api/reports",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: {
        report: {
          id: "00000000-0000-4000-8000-000000000101",
          status: "PENDING",
          targetType: "SIGNAL",
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
    expect(response.headers["cache-control"]).toContain("no-store");
    for (const key of ["note", "reason", "reporterFreqCode", "reporterId", "resolution"]) {
      expect(response.json().data.report).not.toHaveProperty(key);
    }
  });

  it("rejects invalid target ids", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        reason: "泄露隐私",
        targetId: "voice-1",
        targetType: "SIGNAL",
      },
      url: "/api/reports",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("rejects legacy target types", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        reason: "泄露隐私",
        targetId: "00000000-0000-4000-8000-000000000201",
        targetType: "VOICE",
      },
      url: "/api/reports",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("requires a session for private report status", async () => {
    app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/reports/signal/00000000-0000-4000-8000-000000000201" });
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toContain("no-store");
  });
  it("looks up status only under the signed-in reporter identity", async () => {
    app = await buildApp();
    const response = await app.inject({ method: "GET", headers: { authorization: "Bearer active-token" },
      url: "/api/reports/signal/00000000-0000-4000-8000-000000000201" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({});
    expect(findOwnedReportRecord).toHaveBeenCalledWith({ reporterId: "00000000-0000-4000-8000-000000000001",
      signalId: "00000000-0000-4000-8000-000000000201" });
  });
});
