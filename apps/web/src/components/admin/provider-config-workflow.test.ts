import { describe, expect, it, vi } from "vitest";
import {
  buildProviderPayload,
  confirmAndDeleteProviderConfig,
  createEmptyProviderDraft,
  getProviderDeleteConfirmationMessage,
  removeProviderDraftOverride,
  toProviderDrafts,
} from "./provider-config-workflow";

describe("provider config workflow helpers", () => {
  it("removes the temporary provider draft after add", () => {
    const drafts = {
      "existing:chat": { id: "1", model: "main" },
      "new:chat": { model: "backup" },
    };

    const nextDrafts = removeProviderDraftOverride(drafts, "new:chat");

    expect(nextDrafts).toEqual({
      "existing:chat": { id: "1", model: "main" },
    });
    expect(drafts).toHaveProperty("new:chat");
  });

  it("asks for confirmation before deleting a provider config", async () => {
    const confirmDelete = vi.fn(() => false);
    const deleteProviderConfig = vi.fn().mockResolvedValue(undefined);

    const result = await confirmAndDeleteProviderConfig({
      confirmDelete,
      deleteProviderConfig,
      target: {
        kindLabel: "Chat",
        model: "backup-chat",
        provider: "openai-compatible",
      },
    });

    expect(confirmDelete).toHaveBeenCalledWith(
      getProviderDeleteConfirmationMessage({
        kindLabel: "Chat",
        model: "backup-chat",
        provider: "openai-compatible",
      }),
    );
    expect(deleteProviderConfig).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("only deletes after confirmation", async () => {
    const confirmDelete = vi.fn(() => true);
    const deleteProviderConfig = vi.fn().mockResolvedValue(undefined);

    const result = await confirmAndDeleteProviderConfig({
      confirmDelete,
      deleteProviderConfig,
      target: {
        kindLabel: "Chat",
        model: "backup-chat",
        provider: "openai-compatible",
      },
    });

    expect(deleteProviderConfig).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("uses a writable draft priority for environment provider configs", () => {
    const drafts = toProviderDrafts([
      {
        baseUrl: "https://api.example.com",
        extraJson: { chatProfile: "fast" },
        isEnabled: true,
        keyState: "configured",
        kind: "chat",
        model: "main-chat",
        priority: 1000,
        provider: "openai-compatible",
        source: "environment",
        status: "configured",
      },
    ]);

    expect(drafts["environment:chat"]).toMatchObject({
      chatProfile: "fast",
      priority: "100",
    });
  });

  it("builds trimmed provider payloads with write-only keys", () => {
    const draft = {
      ...createEmptyProviderDraft("embedding"),
      apiKey: "  sk-test  ",
      baseUrl: " https://embedding.example.com ",
      dimensions: "1536",
      model: " text-embedding ",
      priority: "7",
      provider: " dashscope ",
      version: " v2 ",
    };

    expect(buildProviderPayload("embedding", draft)).toEqual({
      apiKey: "sk-test",
      baseUrl: "https://embedding.example.com",
      extraJson: {
        dimensions: 1536,
        version: "v2",
      },
      isEnabled: true,
      kind: "embedding",
      model: "text-embedding",
      priority: 7,
      provider: "dashscope",
    });
  });

  it("omits invalid priority and clears keys only when requested", () => {
    const draft = {
      ...createEmptyProviderDraft("tts"),
      baseUrl: "https://tts.example.com",
      clearApiKey: true,
      model: "voice-model",
      priority: "0",
      provider: "dashscope",
      voiceLeft: " longxiaochun ",
      voiceRight: "",
    };

    expect(buildProviderPayload("tts", draft)).toEqual({
      baseUrl: "https://tts.example.com",
      clearApiKey: true,
      extraJson: {
        voiceLeft: "longxiaochun",
      },
      isEnabled: true,
      kind: "tts",
      model: "voice-model",
      provider: "dashscope",
    });
  });
});
