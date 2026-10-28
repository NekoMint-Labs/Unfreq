import { afterEach, describe, expect, it, vi } from "vitest";
import { maxSignalPublicationVersion } from "@unfreq/contracts";
import { isWithdrawSignalResponse, withdrawSignal } from "./signal-publication";

const signalId = "synthetic-signal";
const expectedVersion = 3;

function response(publicationVersion = expectedVersion) {
  return { withdrawal: { id: signalId, withdrawn: true, publicationVersion } };
}

function mockResponse(data: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data,
    meta: { requestId: "synthetic-request" },
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("withdrawal response boundary", () => {
  it("accepts the same version for an idempotent response and a newer safe version", () => {
    expect(isWithdrawSignalResponse(response(), signalId, expectedVersion)).toBe(true);
    expect(isWithdrawSignalResponse(response(4), signalId, expectedVersion)).toBe(true);
    expect(isWithdrawSignalResponse(response(0), signalId, 0)).toBe(true);
    expect(isWithdrawSignalResponse(response(maxSignalPublicationVersion), signalId, 3)).toBe(true);
  });

  it.each(["rawInput", "seedText", "fingerprint", "frequencyProfile", "guestKey"])(
    "rejects unexpected %s at either response level",
    (field) => {
      const valid = response();
      expect(isWithdrawSignalResponse({ ...valid, [field]: "private" }, signalId, 3)).toBe(false);
      expect(isWithdrawSignalResponse({
        withdrawal: { ...valid.withdrawal, [field]: "private" },
      }, signalId, 3)).toBe(false);
    },
  );

  it.each([
    undefined,
    null,
    [],
    {},
    { withdrawal: [] },
    { withdrawal: null },
    { withdrawal: { id: signalId, publicationVersion: 3 } },
    { withdrawal: { id: signalId, withdrawn: "true", publicationVersion: 3 } },
    { withdrawal: { id: signalId, withdrawn: false, publicationVersion: 3 } },
    { withdrawal: { id: "another-signal", withdrawn: true, publicationVersion: 3 } },
    { withdrawal: { id: signalId, withdrawn: true } },
  ])("rejects malformed or unrelated response %#", (value) => {
    expect(isWithdrawSignalResponse(value, signalId, expectedVersion)).toBe(false);
  });

  it.each([-1, 2, 3.5, NaN, Infinity, maxSignalPublicationVersion + 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, "3", null])(
    "rejects stale or unsafe returned version %s",
    (publicationVersion) => {
      expect(isWithdrawSignalResponse({
        withdrawal: { id: signalId, withdrawn: true, publicationVersion },
      }, signalId, expectedVersion)).toBe(false);
    },
  );

  it("does not accept an inherited required field", () => {
    const withdrawal = Object.assign(Object.create({ id: signalId }), {
      withdrawn: true,
      publicationVersion: 3,
    });
    expect(isWithdrawSignalResponse({ withdrawal }, signalId, 3)).toBe(false);
  });
});

describe("withdrawSignal", () => {
  it("posts only the expected version with cookies and validates the returned receipt", async () => {
    const fetch = mockResponse(response(4));
    await expect(withdrawSignal(signalId, expectedVersion)).resolves.toEqual(response(4));
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/signals\/synthetic-signal\/withdraw$/);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ expectedVersion }),
    });
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("keeps the requested ID in one encoded path segment", async () => {
    const id = "synthetic/one?next=two";
    const data = { withdrawal: { id, withdrawn: true, publicationVersion: 3 } };
    const fetch = mockResponse(data);
    await expect(withdrawSignal(id, 3)).resolves.toEqual(data);
    expect(fetch.mock.calls[0][0]).toMatch(/\/signals\/synthetic%2Fone%3Fnext%3Dtwo\/withdraw$/);
  });

  it("rejects a successful HTTP response containing extra private data", async () => {
    mockResponse({ ...response(), seedText: "private synthetic seed" });
    await expect(withdrawSignal(signalId, 3)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 200,
      requestId: "synthetic-request",
    });
  });

  it.each([-1, 1.5, NaN, Infinity, maxSignalPublicationVersion + 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe requested version %s before sending",
    async (version) => {
      const fetch = mockResponse(response());
      await expect(withdrawSignal(signalId, version)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(isWithdrawSignalResponse(response(), signalId, version)).toBe(false);
    },
  );
});
