import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  frequencies,
  providerConfigs,
  signalAudioStatusEnum,
  signalResonances,
  signals,
} from "./schema.js";

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.flatMap((index) => {
    return index.config.name === undefined ? [] : [index.config.name];
  });
}

function uniqueIndexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table)
    .indexes.filter((index) => index.config.unique)
    .flatMap((index) => {
      return index.config.name === undefined ? [] : [index.config.name];
    });
}

describe("Unfreq resonance schema", () => {
  it("defines unique FM frequencies with return-visit state", () => {
    expect(columnNames(frequencies)).toEqual(
      expect.arrayContaining([
        "code",
        "device_hash",
        "frequency_name",
        "last_seen_at",
      ]),
    );
    expect(uniqueIndexNames(frequencies)).toEqual(
      expect.arrayContaining(["frequencies_code_unique"]),
    );
  });

  it("stores seed, expanded signal, nullable embedding, and public visibility fields", () => {
    expect(signalAudioStatusEnum.enumValues).toContain("NOT_REQUESTED");
    expect(signals.audioStatus.default).toBe("NOT_REQUESTED");
    expect(columnNames(signals)).toEqual(
      expect.arrayContaining([
        "frequency_id",
        "seed_text",
        "expanded_text",
        "embedding",
        "embedding_dimensions",
        "embedding_model",
        "embedding_provider",
        "embedding_version",
        "galaxy_position",
        "follow_up_question",
        "parent_signal_id",
        "resonance_count",
        "source",
        "status",
      ]),
    );
    expect(indexNames(signals)).toEqual(
      expect.arrayContaining([
        "signals_frequency_created_at_idx",
        "signals_status_created_at_idx",
      ]),
    );
  });

  it("keeps resonance writes idempotent per signal and actor", () => {
    expect(columnNames(signalResonances)).toEqual(
      expect.arrayContaining(["signal_id", "frequency_id", "actor_key"]),
    );
    expect(uniqueIndexNames(signalResonances)).toEqual(
      expect.arrayContaining(["signal_resonances_signal_actor_unique"]),
    );
  });

  it("supports multiple provider configs per kind with fallback priority", () => {
    expect(columnNames(providerConfigs)).toEqual(
      expect.arrayContaining([
        "kind",
        "provider",
        "model",
        "base_url",
        "api_key_ciphertext",
        "api_key_last4",
        "is_enabled",
        "priority",
      ]),
    );
    expect(uniqueIndexNames(providerConfigs)).not.toContain("provider_configs_kind_unique");
    expect(indexNames(providerConfigs)).toEqual(
      expect.arrayContaining(["provider_configs_kind_priority_idx"]),
    );
  });
});
