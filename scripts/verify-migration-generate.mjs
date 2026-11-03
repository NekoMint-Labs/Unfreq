import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const folder = path.join(root, "apps/api/src/db/migrations");
const journal = JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8"));
const inputs = ["package.json", "package-lock.json", "apps/api/package.json", "apps/api/src/db/schema.ts",
  "apps/api/src/db/migrations/meta/_journal.json", ...journal.entries.map((entry) => `apps/api/src/db/migrations/${entry.tag}.sql`)];
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async (name) => [name,
  createHash("sha256").update(await readFile(path.join(root, name))).digest("hex")])));
const before = await hashes();
const directory = await mkdtemp(path.join(tmpdir(), "unfreq-migration-generate-"));
try {
  const config = path.join(directory, "drizzle.config.ts");
  const output = path.join(directory, "output");
  await writeFile(config, `export default ${JSON.stringify({ dialect: "postgresql", schema: path.join(root, "apps/api/src/db/schema.ts"), out: output })};\n`, { flag: "wx" });
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  const kit = path.join(path.dirname(require.resolve("drizzle-kit/package.json")), "bin.cjs");
  const result = spawnSync(process.execPath, [kit, "generate", `--config=${config}`], { cwd: root, env,
    encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 1_048_576 });
  assert.equal(result.error, undefined, "Development generation failed to run.");
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, "Development generation failed.");
  const sql = (await readdir(output)).filter((name) => name.endsWith(".sql"));
  assert.equal(sql.length, 1);
  const bytes = await readFile(path.join(output, sql[0]));
  assert.match(bytes.toString("utf8"), /CREATE TABLE "users"/u);
  assert.deepEqual(await hashes(), before, "Generation modified the committed migration inputs.");
  console.log(JSON.stringify({ passed: true, sqlFiles: sql.length, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), existingMigrationsUnchanged: true }));
} finally {
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("unfreq-migration-generate-"));
  await rm(directory, { recursive: true, force: true });
}
