import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyPostgresStartupPatch } from "../../scripts/apply-postgres-startup-patch.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const metadata = JSON.parse(await readFile(join(root, "patches", "postgres-3.4.9-startup.json"), "utf8"));
const patch = (await readFile(join(root, "patches", "postgres-3.4.9-startup.patch"), "utf8")).replaceAll("\r\n", "\n");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Reconstruct byte-identical registry inputs from a patched install. The
// independent original SHA prevents a permissive inverse from inventing fixtures.
function originalSource(file, source) {
  if (hash(source) === file.originalSha256) return source;
  assert.equal(hash(source), file.patchedSha256);
  const header = `diff --git a/node_modules/postgres/${file.path} b/node_modules/postgres/${file.path}`;
  const block = patch.split(/(?=^diff --git )/mu).find((value) => value.startsWith(`${header}\n`));
  assert.ok(block);
  const changes = [];
  let hunk;
  for (const line of block.split("\n")) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (match) {
      hunk = { start: Number(match[1]) - 1, lines: [] };
      changes.push(hunk);
    } else if (hunk && /^[ +\-]/u.test(line)) hunk.lines.push(line);
  }
  const lines = source.toString().split("\n");
  const output = [];
  let cursor = 0;
  for (const change of changes) {
    output.push(...lines.slice(cursor, change.start));
    cursor = change.start;
    for (const line of change.lines) {
      if (line[0] !== "-") assert.equal(lines[cursor++], line.slice(1));
      if (line[0] !== "+") output.push(line.slice(1));
    }
  }
  const result = Buffer.from([...output, ...lines.slice(cursor)].join("\n"));
  assert.equal(hash(result), file.originalSha256);
  return result;
}

async function withOwnedPackage(run, pristine = false) {
  const directory = await mkdtemp(join(tmpdir(), "unfreq-patch-test-"));
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "postgres", version: metadata.version }));
    for (const file of metadata.files) {
      const target = join(directory, file.path);
      await mkdir(dirname(target), { recursive: true });
      const installed = await readFile(join(root, "node_modules", "postgres", file.path));
      await writeFile(target, pristine ? originalSource(file, installed) : installed);
    }
    await run(directory);
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("unfreq-patch-test-")) {
      throw new Error("Refusing to remove an unowned patch-test directory.");
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test("installed ESM and CJS patch hashes verify and reapplying is idempotent", async () => {
  for (const file of metadata.files) {
    assert.equal(hash(await readFile(join(root, "node_modules", "postgres", file.path))), file.patchedSha256);
  }
  await withOwnedPackage(async (directory) => {
    await applyPostgresStartupPatch(directory);
    for (const file of metadata.files) assert.equal(hash(await readFile(join(directory, file.path))), file.patchedSha256);
    assert.deepEqual(await applyPostgresStartupPatch(directory), { package: "postgres", version: "3.4.9", applied: 0, verified: 4 });
  });
});

test("pristine registry source hashes take the real original-to-patched path", async () => {
  await withOwnedPackage(async (directory) => {
    assert.equal((await applyPostgresStartupPatch(directory)).applied, 4);
    for (const file of metadata.files) assert.equal(hash(await readFile(join(directory, file.path))), file.patchedSha256);
    assert.equal((await applyPostgresStartupPatch(directory)).applied, 0);
  }, true);
});

test("a known partially patched install can finish without guessing source versions", async () => {
  await withOwnedPackage(async (directory) => {
    const file = metadata.files[0];
    await writeFile(join(directory, file.path), await readFile(join(root, "node_modules", "postgres", file.path)));
    assert.equal((await applyPostgresStartupPatch(directory)).applied, 3);
    for (const target of metadata.files) assert.equal(hash(await readFile(join(directory, target.path))), target.patchedSha256);
  }, true);
});

test("source drift refuses the whole patch before changing any other target", async () => {
  await withOwnedPackage(async (directory) => {
    const target = join(directory, metadata.files.at(-1).path);
    await writeFile(target, `${await readFile(target, "utf8")}\n// unknown source\n`);
    const before = await Promise.all(metadata.files.map((file) => readFile(join(directory, file.path))));
    await assert.rejects(applyPostgresStartupPatch(directory), /unknown PostgreSQL source/);
    const after = await Promise.all(metadata.files.map((file) => readFile(join(directory, file.path))));
    assert.deepEqual(after, before);
  }, true);
});

test("an upstream version change requires explicit patch review", async () => {
  await withOwnedPackage(async (directory) => {
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "postgres", version: "0.0.0-unknown" }));
    await assert.rejects(applyPostgresStartupPatch(directory), /exact pinned package and lock integrity/);
  });
});
