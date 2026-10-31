import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluationHash, prepareBlindReview, seedDatasetSchema, summarizeBlindReview, validateFaithfulnessCapture, type BlindKey } from "../modules/ai/faithfulness-evaluation.js";

const usage = `Offline only; no provider calls, database access or automatic human scores.
  faithfulness:evaluate -- prepare --dataset <json> --capture <json> --out <new-directory>
  faithfulness:evaluate -- summarize --key <key.json> --first <reviewer-a.json> --second <reviewer-b.json>`;
function options(argv: string[]) {
  const [command, ...rest] = argv;
  if (command !== "prepare" && command !== "summarize") throw new Error(usage);
  const allowed = command === "prepare" ? ["--dataset", "--capture", "--out"] : ["--key", "--first", "--second"];
  const result: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]!;
    if (!allowed.includes(flag) || !rest[index + 1] || result[flag]) throw new Error(usage);
    result[flag] = resolve(rest[index + 1]!);
  }
  if (allowed.some((flag) => !result[flag])) throw new Error(usage);
  return { command, values: result };
}
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")) as unknown; }
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
try {
  const { command, values } = options(process.argv.slice(2));
  if (command === "prepare") {
    const bytes = await readFile(values["--dataset"]!);
    const dataset = seedDatasetSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
    const expectedHash = (await readFile(values["--dataset"]!.replace(/\.json$/u, ".sha256"), "utf8")).trim();
    if (hash(bytes) !== expectedHash) throw new Error("Frozen dataset hash mismatch.");
    const capture = validateFaithfulnessCapture(dataset, expectedHash, await json(values["--capture"]!));
    const rawPath = resolve(dirname(values["--capture"]!), capture.rawEvidence.path);
    const rawBytes = await readFile(rawPath);
    if (hash(rawBytes) !== capture.rawEvidence.sha256) throw new Error("Raw capture evidence hash mismatch.");
    const packet = prepareBlindReview(dataset, expectedHash, {
      ...capture, rawEvidence: { ...capture.rawEvidence, path: "raw-evidence.bin" },
    });
    // A new directory prevents accidentally replacing completed human reviews.
    await mkdir(values["--out"]!);
    await writeFile(resolve(values["--out"]!, "raw-evidence.bin"), rawBytes, { flag: "wx" });
    await writeFile(resolve(values["--out"]!, "dataset.json"), bytes, { flag: "wx" });
    for (const [name, value] of [["key", packet.key], ["reviewer-a", packet.reviewerA], ["reviewer-b", packet.reviewerB]] as const) {
      await writeFile(resolve(values["--out"]!, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    }
    process.stdout.write("Prepared two unscored independent review sheets. Keep key.json separate from reviewers.\n");
  } else {
    const key = await json(values["--key"]!) as BlindKey;
    const datasetBytes = await readFile(resolve(dirname(values["--key"]!), "dataset.json"));
    if (hash(datasetBytes) !== key.capture.datasetSha256 ||
        evaluationHash(seedDatasetSchema.parse(JSON.parse(datasetBytes.toString("utf8")) as unknown)) !== evaluationHash(key.dataset)) throw new Error("Dataset evidence changed.");
    const rawBytes = await readFile(resolve(dirname(values["--key"]!), key.capture.rawEvidence.path));
    if (hash(rawBytes) !== key.capture.rawEvidence.sha256) throw new Error("Raw evidence changed.");
    const summary = summarizeBlindReview(key, await json(values["--first"]!), await json(values["--second"]!));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
} catch {
  // Captures may contain private Seed text. Do not echo parser input or errors.
  process.stderr.write(`Evaluation refused: check arguments, hashes, completeness and independent ratings.\n${usage}\n`);
  process.exitCode = 1;
}
