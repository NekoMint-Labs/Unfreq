import { createHash } from "node:crypto";
import { embeddingSpaceKey, signalEmbeddingText } from "./embedding-space.js";
import type { EmbeddingProviderConfig } from "./embedding.js";

export function parseBackfillOptions(argv: string[]) {
  if (argv.some((arg) => arg !== "--apply" && !/^--limit=\d+$/u.test(arg))) throw new Error("Use --limit=1..1000 and optionally --apply.");
  if (new Set(argv).size !== argv.length || argv.filter((arg) => arg.startsWith("--limit=")).length > 1) throw new Error("Duplicate backfill options.");
  const limit = Number(argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be an integer between 1 and 1000.");
  return { apply: argv.includes("--apply"), limit };
}

export function embeddingBackfillPlan(rows: { id: string; expandedText: string }[], configs: EmbeddingProviderConfig[]) {
  const spaces = configs.map((config) => ({ provider: config.provider, model: config.model,
    dimensions: config.dimensions, requestedSpace: embeddingSpaceKey(config) }));
  const inputCharacters = rows.reduce((count, row) => count + signalEmbeddingText(row.expandedText).length, 0);
  return { scope: "confirmed-public-missing-vectors-only", rows: rows.length, inputCharacters, spaces,
    maxDispatches: rows.length * configs.length * 4,
    maxDispatchedCharacters: inputCharacters * configs.length * 4,
    // Stable scope identifier includes content hashes, never content or keys.
    planKey: createHash("sha256").update(JSON.stringify([spaces, rows.map((row) => [row.id,
      createHash("sha256").update(signalEmbeddingText(row.expandedText)).digest("hex")])])).digest("hex"),
    currencyCost: "unknown", tokenEstimate: "unknown", overwritesExistingVectors: false };
}
