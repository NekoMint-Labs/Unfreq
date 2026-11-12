import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Run real module loading outside Vitest's ESM transform. No query or socket is
// started: constructing a pool and attaching Drizzle are lazy operations.
for (const mode of ["module", "commonjs"]) {
  test(`locked postgres v4 loads through plain Node ${mode} and accepts Drizzle`, () => {
    const imports = mode === "module"
      ? 'import postgres from "postgres"; import { drizzle } from "drizzle-orm/postgres-js"; import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'
      : 'const postgres = require("postgres").default; const { drizzle } = require("drizzle-orm/postgres-js");';
    const result = spawnSync(process.execPath, ["--input-type", mode, "--eval", `${imports}
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const path = require("node:path");
      const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
      const entry = require.resolve("postgres");
      const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), "..", "package.json"), "utf8"));
      assert.equal(lock.packages["node_modules/postgres"].version, "4.0.0");
      assert.equal(metadata.version, "4.0.0");
      assert.ok(entry.split(path.sep).join("/").endsWith("/postgres/src/index.js"));
      assert.equal(typeof postgres, "function");
      const client = postgres({ host: "127.0.0.1", port: 9, infer: true });
      assert.equal(client.options.infer, true);
      assert.equal(drizzle(client).$client, client);
      client.end({ timeout: 0 }).then(() => process.stdout.write("postgres-v4-module-ok"));
    `], { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "postgres-v4-module-ok");
  });
}
