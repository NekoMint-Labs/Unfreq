import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignalReport, getOwnSignalReport, isSignalReportResponse } from "./signal-reports";

const receipt = { id: "report-synthetic", targetType: "SIGNAL", targetId: "signal-synthetic", status: "PENDING", createdAt: "2026-10-30T00:00:00Z" };
function mockResponse(data: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data, meta: { requestId: "report-test" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("signal report API boundary", () => {
  it("accepts only the target's minimal receipt or a missing own report", () => {
    expect(isSignalReportResponse({}, receipt.targetId)).toBe(true);
    expect(isSignalReportResponse({ report: receipt }, receipt.targetId)).toBe(true);
    expect(isSignalReportResponse({ report: { ...receipt, status: "RESOLVED", resolvedAt: receipt.createdAt } }, receipt.targetId)).toBe(true);
    expect(isSignalReportResponse({ report: receipt }, "another-signal")).toBe(false);
  });
  it.each(["reporterId", "reporterFreqCode", "note", "reason", "resolution", "seedText"])("rejects unexpected %s in receipts", (key) => {
    expect(isSignalReportResponse({ report: { ...receipt, [key]: "private" } }, receipt.targetId)).toBe(false);
    expect(isSignalReportResponse({ report: receipt, [key]: "private" }, receipt.targetId)).toBe(false);
  });
  it.each([null, [], { report: null }, { report: {} }, { report: { ...receipt, status: "APPROVED" } }, { report: { ...receipt, createdAt: "invalid" } }])("rejects malformed receipt %#", (value) => {
    expect(isSignalReportResponse(value, receipt.targetId)).toBe(false);
  });
  it("submits only the chosen reason and note, with cookies and no-store", async () => {
    const fetch = mockResponse({ report: receipt });
    await expect(createSignalReport(receipt.targetId, "涉及隐私", "  合成说明  ")).resolves.toEqual(receipt);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include", cache: "no-store",
      body: JSON.stringify({ targetId: receipt.targetId, targetType: "SIGNAL", reason: "涉及隐私", note: "合成说明" }) });
  });
  it("reads the signed-in reporter's state through one encoded path segment", async () => {
    const fetch = mockResponse({});
    await expect(getOwnSignalReport("one/two?three")).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/reports\/signal\/one%2Ftwo%3Fthree$/u);
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store" });
  });
  it("rejects a success response with review text or without the submitted receipt", async () => {
    mockResponse({ report: { ...receipt, note: "private" } });
    await expect(createSignalReport(receipt.targetId, "其他", "")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    mockResponse({});
    await expect(createSignalReport(receipt.targetId, "其他", "")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
