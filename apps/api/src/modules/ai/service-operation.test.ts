import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors.js";
import { runWithGenerationExecution, type GenerationAuditOperation } from "../../shared/generation-execution.js";
import { classifyContent, classifyContentWithFallback } from "./service.js";
import { classifyWithProvider } from "./provider.js";
import { createAiReviewRecord } from "./repository.js";

vi.mock("./provider.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./provider.js")>(), classifyWithProvider: vi.fn(),
}));
vi.mock("./repository.js", () => ({ createAiReviewRecord: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000801" })) }));
const signalId = "00000000-0000-4000-8000-000000000011";
const attemptId = "00000000-0000-4000-8000-000000000012";
const batchId = "00000000-0000-4000-8000-000000000013";
const operation: GenerationAuditOperation = { schemaVersion: 1, kind: "signal-generation", signalId, attemptId };
const execution = { schemaVersion: 1 as const, taskType: "classify", source: "provider" as const,
  provider: "synthetic", model: "synthetic", promptVersion: "synthetic-v1", inputTemplateVersion: "synthetic-v1",
  durationMs: 1, attempts: [], cost: "unknown" as const };
function run<T>(auditContext: GenerationAuditOperation, work: () => Promise<T>) {
  return runWithGenerationExecution({ attemptId: auditContext.attemptId, auditContext,
    signal: new AbortController().signal, assertActive: async () => {}, beforeDispatch: async () => {} }, work);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(classifyWithProvider).mockResolvedValue({ execution,
    output: { channel: "MIDNIGHT", confidence: 0.8, reason: "synthetic" } });
});

describe("managed AI review operation lineage", () => {
  it("records a durable signal target and attempt without mutating transport metadata", async () => {
    await run(operation, () => classifyContent({ content: "SYNTHETIC_PRIVATE_INPUT" }));
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ targetId: signalId, targetType: "SIGNAL",
      execution: { ...execution, operation } }));
    expect(execution).not.toHaveProperty("operation");
  });
  it("keeps concurrent managed operations separate across asynchronous provider work", async () => {
    const second: GenerationAuditOperation = { ...operation, signalId: batchId };
    await Promise.all([run(operation, () => classifyContent({ content: "first synthetic" })),
      run(second, () => classifyContent({ content: "second synthetic" }))]);
    const writes = vi.mocked(createAiReviewRecord).mock.calls.map(([params]) => ({ target: params.targetId,
      operation: (params.execution as typeof execution & { operation: GenerationAuditOperation }).operation }));
    expect(writes).toEqual(expect.arrayContaining([{ target: signalId, operation }, { target: batchId, operation: second }]));
    expect(writes).toHaveLength(2);
  });
  it("retains the same operation when local fallback is audited", async () => {
    vi.mocked(classifyWithProvider).mockRejectedValue(new AppError("AI_UNAVAILABLE", "synthetic failure"));
    await run(operation, () => classifyContentWithFallback({ content: "synthetic fallback" }));
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "FALLBACK", targetId: signalId,
      execution: expect.objectContaining({ source: "rules", operation }) }));
  });
  it("records a scheduler batch without inventing a pre-persistence signal target", async () => {
    const schedulerOperation: GenerationAuditOperation = { schemaVersion: 1, kind: "scheduler-batch", batchId, attemptId };
    await run(schedulerOperation, () => classifyContent({ content: "synthetic system content" }));
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ targetId: undefined, targetType: undefined,
      execution: { ...execution, operation: schedulerOperation } }));
  });
  it("preserves explicit targets and leaves ordinary unscoped calls unattributed", async () => {
    await run(operation, () => classifyContent({ content: "synthetic explicit target" }, { targetId: batchId, targetType: "USER" }));
    expect(createAiReviewRecord).toHaveBeenLastCalledWith(expect.objectContaining({ targetId: batchId, targetType: "USER" }));
    await classifyContent({ content: "synthetic old caller" });
    expect(createAiReviewRecord).toHaveBeenLastCalledWith(expect.objectContaining({ targetId: undefined, targetType: undefined, execution }));
  });
});
