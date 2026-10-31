import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Build API first. These are synthetic scores testing the CLI contract, never
// human/model-quality evidence. All artifacts stay in ignored test-results.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("offline CLI binds both reviews to copied dataset and raw evidence", async () => {
  const directory = await mkdtemp(path.join(root, "test-results/e4-cli-"));
  const datasetPath = path.join(root, "apps/api/tests/fixtures/e4-seeds.v1.json");
  const datasetBytes = await readFile(datasetPath);
  const dataset = JSON.parse(datasetBytes.toString());
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const raw = Buffer.from("SYNTHETIC CLI TEST ONLY; no model or human run\n");
  await writeFile(path.join(directory, "raw.bin"), raw);
  const capture = {
    version: "e4-capture-v1", datasetSha256: hash(datasetBytes), codeSha: "a".repeat(40), promptSha256: "b".repeat(64),
    executionPath: "POST /api/signals -> generation worker", environment: "loopback-stub",
    rawEvidence: { path: "raw.bin", sha256: hash(raw) },
    records: [{ caseId: dataset.cases[0].id, seedText: dataset.cases[0].seedText,
      signalId: "00000000-0000-4000-8000-000000000001", status: "COMPLETED", outputText: "SYNTHETIC_PRIVATE_CANARY",
      matches: [], provider: "stub", model: "preset", fallback: false, latencyMs: 10, tokens: null, currencyCost: null, currency: null }],
  };
  const capturePath = path.join(directory, "capture.json");
  await writeFile(capturePath, JSON.stringify(capture));
  const output = path.join(directory, "review");
  const invoke = (...args) => spawnSync(process.execPath, [path.join(root, "apps/api/dist/scripts/evaluate-faithfulness.js"), ...args], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000,
  });
  const prepareArgs = ["prepare", "--dataset", datasetPath, "--capture", capturePath, "--out", output];
  assert.equal(invoke(...prepareArgs).status, 0);
  assert.equal(invoke(...prepareArgs).status, 1, "must not overwrite reviews");
  const summarizeArgs = ["summarize", "--key", path.join(output, "key.json"), "--first", path.join(output, "reviewer-a.json"), "--second", path.join(output, "reviewer-b.json")];
  const incomplete = invoke(...summarizeArgs);
  assert.equal(incomplete.status, 1);
  assert.doesNotMatch(incomplete.stderr, /SYNTHETIC_PRIVATE_CANARY/u);
  for (const [name, reviewerId] of [["reviewer-a", "synthetic-test-a"], ["reviewer-b", "synthetic-test-b"]]) {
    const location = path.join(output, `${name}.json`);
    const sheet = JSON.parse(await readFile(location, "utf8"));
    sheet.reviewerId = reviewerId;
    sheet.independentReviewConfirmed = true;
    for (const item of sheet.items) Object.assign(item, { faithfulness: 4, fabrication: false, forcedNegative: false });
    await writeFile(location, JSON.stringify(sheet));
  }
  const completed = invoke(...summarizeArgs);
  assert.equal(completed.status, 0, completed.stderr);
  const summary = JSON.parse(completed.stdout);
  assert.equal(summary.modelQualityValidated, false);
  assert.equal(summary.dataset.humanValidated, false);
  assert.equal(summary.authorApproval, null);
  assert.equal(summary.currencyCost, null);
  // Zod normalizes object key order. A different frozen JSON key order must
  // still be accepted after its own byte hash has been verified.
  const reordered = Buffer.from(JSON.stringify({ cases: dataset.cases.map(({ id, category, seedText }) => ({ seedText, category, id })),
    humanValidated: false, source: dataset.source, version: dataset.version }));
  const reorderedPath = path.join(directory, "reordered.json");
  await writeFile(reorderedPath, reordered);
  await writeFile(path.join(directory, "reordered.sha256"), hash(reordered));
  await writeFile(capturePath, JSON.stringify({ ...capture, datasetSha256: hash(reordered) }));
  const reorderedOutput = path.join(directory, "review-reordered");
  assert.equal(invoke("prepare", "--dataset", reorderedPath, "--capture", capturePath, "--out", reorderedOutput).status, 0);
  for (const [name, reviewerId] of [["reviewer-a", "synthetic-test-a"], ["reviewer-b", "synthetic-test-b"]]) {
    const location = path.join(reorderedOutput, `${name}.json`);
    const sheet = JSON.parse(await readFile(location, "utf8"));
    Object.assign(sheet, { reviewerId, independentReviewConfirmed: true });
    for (const item of sheet.items) Object.assign(item, { faithfulness: 4, fabrication: false, forcedNegative: false });
    await writeFile(location, JSON.stringify(sheet));
  }
  assert.equal(invoke("summarize", "--key", path.join(reorderedOutput, "key.json"), "--first", path.join(reorderedOutput, "reviewer-a.json"),
    "--second", path.join(reorderedOutput, "reviewer-b.json")).status, 0);
  await writeFile(path.join(output, "raw-evidence.bin"), "changed");
  assert.equal(invoke(...summarizeArgs).status, 1, "must recheck raw evidence");
  await writeFile(path.join(output, "raw-evidence.bin"), raw);
  await writeFile(path.join(output, "dataset.json"), "changed");
  assert.equal(invoke(...summarizeArgs).status, 1, "must recheck dataset evidence");
});
