import { readFile } from "node:fs/promises";
import { summarizeMatchEvaluation, type MatchEvaluationRun } from "../modules/signals/match-evaluation.js";

// Offline only. It summarizes captured IDs, judgments and dispatch counters;
// it never loads provider configuration or dispatches a model request.
const args = process.argv.slice(2);
try {
  if (args.length !== 2 || args[0] !== "--file") throw new Error("Use --file <captured-evaluation.json>.");
  const bytes = await readFile(args[1]);
  if (bytes.byteLength > 5_000_000) throw new Error("Evaluation input is too large.");
  const input = JSON.parse(bytes.toString()) as { datasetHash: string; judgmentSource: string; strategies: { name: string; runs: MatchEvaluationRun[] }[] };
  if (!/^[a-f0-9]{64}$/u.test(input.datasetHash) || input.judgmentSource !== "synthetic-presets-not-human" ||
      !Array.isArray(input.strategies) || input.strategies.length < 1 || input.strategies.length > 20) throw new Error("Unsupported evaluation metadata.");
  console.log(JSON.stringify({ datasetHash: input.datasetHash, judgmentSource: input.judgmentSource,
    strategies: input.strategies.map((strategy) => ({ name: strategy.name, ...summarizeMatchEvaluation(strategy.runs) })) }, null, 2));
} catch { console.error("Match evaluation failed: provide a valid bounded synthetic capture; no provider calls were made."); process.exitCode = 1; }
