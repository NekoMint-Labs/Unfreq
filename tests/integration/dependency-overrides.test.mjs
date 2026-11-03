import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const parserRequire = createRequire(path.join(root, "node_modules/@typescript-eslint/typescript-estree/package.json"));
const loaderRequire = createRequire(path.join(root, "node_modules/@esbuild-kit/core-utils/package.json"));

test("the parser's glob matcher bounds optimization amplification", () => {
  const { Minimatch } = parserRequire("minimatch");
  const matcher = new Minimatch(Array(7).fill("**/../a/b").join("/"), {
    optimizationLevel: 2, braceExpandMax: 64,
  });
  assert.ok(matcher.set.length <= 64);
});

test("parser glob matching preserves dotfiles and platform path controls", () => {
  const { minimatch } = parserRequire("minimatch");
  for (const platform of ["linux", "win32"]) {
    assert.equal(minimatch("src/.config.ts", "src/*.ts", { dot: true, platform }), true);
    assert.equal(minimatch("src/deep/test.ts", "src/*.ts", { dot: true, platform }), false);
    assert.equal(minimatch("src/deep/test.ts", "src/**/*.ts", { dot: true, platform }), true);
    assert.equal(minimatch("src/test.ts", "src\\*.ts", { dot: true, platform, windowsPathsNoEscape: true }), true);
    assert.equal(minimatch("C:/repo/src/test.ts", "C:/repo/**/*.ts", { dot: true, platform }), true);
  }
});

test("legacy ESLint consumers retain callable, class and regexp APIs", () => {
  const minimatch = require("minimatch");
  assert.equal(minimatch("src/test.ts", "src/*.ts"), true);
  assert.equal(new minimatch.Minimatch("src/*.ts").match("src/test.ts"), true);
  assert.equal(minimatch.makeRe("src/**/*.ts").test("src/deep/test.ts"), true);
  assert.equal(minimatch("test.ts", " test.ts "), true);
});

test("the old loader uses a CORS-safe esbuild and still transforms TypeScript", { timeout: 10_000 }, async () => {
  const esbuild = loaderRequire("esbuild");
  const context = await esbuild.context({
    stdin: { contents: 'console.log("synthetic-dependency-control")', sourcefile: "entry.ts" },
    write: false, outfile: "out.js", logLevel: "silent",
  });
  try {
    const { port } = await context.serve({ host: "127.0.0.1", port: 0 });
    for (const origin of ["https://untrusted.invalid", "null"]) {
      const response = await fetch(`http://127.0.0.1:${port}/out.js`, {
        headers: { Origin: origin }, signal: AbortSignal.timeout(3_000),
      });
      await response.arrayBuffer();
      assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
      assert.notEqual(response.headers.get("access-control-allow-origin"), origin);
    }
    const response = await fetch(`http://127.0.0.1:${port}/out.js`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /synthetic-dependency-control/u);
  } finally {
    await context.dispose();
  }
  const loader = loaderRequire("@esbuild-kit/core-utils");
  const source = "const answer: number = 42; export default answer;";
  for (const transform of [loader.transform, loader.transformSync]) {
    const result = await transform(source, "fixture.ts", { tsconfigRaw: { compilerOptions: { target: "ES2020" } } });
    assert.match(result.code, /42/u);
    assert.doesNotMatch(result.code, /: number/u);
    assert.ok(result.map);
  }
});
