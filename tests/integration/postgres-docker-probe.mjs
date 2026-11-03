import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The workflow mounts only this read-only probe into the real dependency image.
assert.equal(process.platform, "linux");
assert.equal(process.cwd(), "/app");
const require = createRequire("/app/package.json");
const entry = require.resolve("postgres");
const postgres = (await import(pathToFileURL(entry).href)).default;
assert.equal(require("postgres").default, postgres);
const metadata = JSON.parse(await readFile("patches/postgres-4.0.0-lifecycle.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
assert.equal(lock.packages["node_modules/postgres"].version, "4.0.0");
assert.equal(lock.packages["node_modules/postgres"].integrity, metadata.integrity);
const packageRoot = path.dirname(path.dirname(entry));
assert.equal(JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version, metadata.version);
assert.equal(metadata.files.length, 2);
for (const file of metadata.files) {
  const target = path.resolve(packageRoot, file.path);
  assert.ok(target.startsWith(packageRoot + path.sep));
  assert.equal(createHash("sha256").update(await readFile(target)).digest("hex"), file.patchedSha256);
}
const { drizzle } = require("drizzle-orm/postgres-js");
const client = postgres({ host: "127.0.0.1", port: 9, infer: true });
assert.equal(client.options.infer, true);
assert.equal(drizzle(client).$client, client);
await client.end({ timeout: 0 });
console.log(JSON.stringify({ node: process.version, platform: process.platform,
  postgres: metadata.version, patchedFiles: metadata.files.length,
  commonJsAndEsmShared: true, drizzleLazyLoad: true,
  scope: "Real Dockerfile dependency stage; no SQL, API runner, browser, migration or production acceptance." }));
