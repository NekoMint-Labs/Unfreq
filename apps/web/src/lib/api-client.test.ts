import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiClient } from "./api-client";

const requestId = "req_test";

const buildResponse = (payload: unknown, init?: ResponseInit): Response => {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
};

const mockFetch = (response: Response): void => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
};

describe("apiClient response validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns typed data when the optional response validator accepts it", async () => {
    mockFetch(buildResponse({
      data: { ok: true },
      meta: { requestId },
    }));

    const result = await apiClient.get<{ ok: boolean }>("/api/test", {
      validate: (value): value is { ok: boolean } => {
        return (
          typeof value === "object" &&
          value !== null &&
          "ok" in value &&
          typeof value.ok === "boolean"
        );
      },
    });

    expect(result).toEqual({ ok: true });
  });

  it("throws a typed client error when response data fails validation", async () => {
    mockFetch(buildResponse({
      data: { ok: "yes" },
      meta: { requestId },
    }));

    await expect(
      apiClient.get<{ ok: boolean }>("/api/test", {
        validate: (value): value is { ok: boolean } => {
          return (
            typeof value === "object" &&
            value !== null &&
            "ok" in value &&
            typeof value.ok === "boolean"
          );
        },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      requestId,
      status: 200,
    } satisfies Partial<ApiClientError>);
  });

  it("preserves API error responses before optional data validation", async () => {
    mockFetch(buildResponse(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Login required.",
        },
        meta: { requestId },
      },
      { status: 401 },
    ));

    await expect(
      apiClient.get<{ ok: boolean }>("/api/test", {
        validate: (value): value is { ok: boolean } => value === undefined,
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Login required.",
      requestId,
      status: 401,
    } satisfies Partial<ApiClientError>);
  });

  it("keeps the existing unchecked data path when no validator is provided", async () => {
    mockFetch(buildResponse({
      data: { ok: "legacy" },
      meta: { requestId },
    }));

    await expect(apiClient.get<{ ok: boolean }>("/api/test")).resolves.toEqual({
      ok: "legacy",
    });
  });
});
