import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const dependencyRoot = resolve(process.env.DEPENDENCY_TEST_ROOT ?? repositoryRoot);
const requireDependency = createRequire(resolve(dependencyRoot, "package.json"));
const lock = JSON.parse(readFileSync(resolve(dependencyRoot, "package-lock.json"), "utf8"));
const bracePaths = new Map();
for (const [location, entry] of Object.entries(lock.packages)) {
  if (/(?:^|\/)brace-expansion$/.test(location)) {
    const family = entry.version.split(".")[0];
    if ((family === "1" || family === "5") && !bracePaths.has(family)) bracePaths.set(family, location);
  }
}

test("both supported brace-expansion dependency lines are present", () => {
  assert.deepEqual([...bracePaths.keys()].sort(), ["1", "5"]);
});

// These bounded subprocesses avoid running a hostile recursive parser in the
// test coordinator. Inputs here cannot produce an OOM-sized result; the heap
// and wall-clock ceilings are additional guards, not a performance benchmark.
function checkBrace(location, body) {
  const packagePath = resolve(dependencyRoot, location);
  const source = `
    const assert = require('node:assert/strict');
    const loaded = require(${JSON.stringify(packagePath)});
    const expand = typeof loaded === 'function' ? loaded : loaded.expand;
    assert.equal(typeof expand, 'function');
    ${body}
    process.stdout.write('ok');
  `;
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toUpperCase())));
  const child = spawnSync(process.execPath, ["--max-old-space-size=96", "--input-type=commonjs", "-e", source], {
    cwd: process.cwd(), env, encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL",
    maxBuffer: 65_536, windowsHide: true,
  });
  const detail = `${child.error?.message ?? ""}\n${child.stderr ?? ""}`.slice(0, 1500);
  assert.equal(child.error, undefined, `brace subprocess exceeded its execution boundary: ${detail}`);
  assert.equal(child.signal, null, `brace subprocess was terminated: ${detail}`);
  assert.equal(child.status, 0, `brace subprocess failed: ${detail}`);
  assert.equal(child.stdout, "ok");
}

// Cases follow the publisher's v1.1.21 / v5.0.12 tests and advisories:
// GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-3jxr-9vmj-r5cp,
// GHSA-mh99-v99m-4gvg and GHSA-rgw5-rvv9-x895.
for (const [family, location] of bracePaths) {
  test(`brace-expansion ${family}.x keeps ordinary sequences and nesting`, () => {
    checkBrace(location, `
      assert.deepEqual(expand('part-{1..3}-{x,y}'), [
        'part-1-x', 'part-1-y', 'part-2-x', 'part-2-y', 'part-3-x', 'part-3-y',
      ]);
      assert.deepEqual(expand('{a,b{1..3},c}'), ['a', 'b1', 'b2', 'b3', 'c']);
      assert.deepEqual(expand('{09..11}'), ['09', '10', '11']);
    `);
  });

  test(`brace-expansion ${family}.x honors an explicit nesting budget`, () => {
    checkBrace(location, `
      assert.deepEqual(expand('{{a,b}}', { maxDepth: 0 }), ['{{a,b}}']);
      const nested = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000);
      assert.deepEqual(expand(nested, { maxDepth: 32 }), [nested]);
    `);
  });

  test(`brace-expansion ${family}.x parses a long comma-group chain without stack exhaustion`, () => {
    checkBrace(location, `
      const pattern = '{' + '{a},'.repeat(10_000) + 'b}';
      const expanded = expand(pattern, { max: 1, maxLength: 16 });
      assert.ok(expanded.length > 0 && expanded.length <= 1);
      assert.ok(expanded.reduce((sum, value) => sum + value.length, 0) <= 16);
    `);
  });

  test(`brace-expansion ${family}.x leaves consecutive non-expanding groups literal`, () => {
    checkBrace(location, `
      const pattern = 'a' + Array(30).fill('{}').join(',');
      assert.deepEqual(expand(pattern), [pattern]);
    `);
  });

  test(`brace-expansion ${family}.x bounds combined sequences and alternatives`, () => {
    checkBrace(location, `
      const combined = expand('{1..10}'.repeat(4), { max: 10, maxLength: 32 });
      assert.ok(combined.length > 0 && combined.length <= 10);
      assert.ok(combined.every(value => /^[0-9]+$/.test(value)));
      assert.ok(combined.reduce((sum, value) => sum + value.length, 0) <= 32);
      const alternatives = '{' + Array(40).fill('{1..5}').join(',') + '}';
      const bounded = expand(alternatives, { max: 20, maxLength: 12 });
      assert.ok(bounded.length > 0 && bounded.length <= 20);
      assert.ok(bounded.every(value => /^[1-5]$/.test(value)));
      assert.ok(bounded.reduce((sum, value) => sum + value.length, 0) <= 12);
    `);
  });

  test(`brace-expansion ${family}.x applies the length bound during a numeric range`, () => {
    checkBrace(location, `
      const expanded = expand('{1..10000}', { max: 10, maxLength: 8 });
      assert.ok(expanded.length > 0 && expanded.length <= 10);
      assert.ok(expanded.every(value => /^[0-9]+$/.test(value)));
      assert.ok(expanded.reduce((sum, value) => sum + value.length, 0) <= 8);
      assert.deepEqual(expand('{1..3}', { max: 10, maxLength: 8 }), ['1', '2', '3']);
    `);
  });
}

const yaml = requireDependency("js-yaml");

// https://github.com/nodeca/js-yaml/security/advisories/GHSA-52cp-r559-cp3m
test("YAML merge chains consume the shared merge-key budget", () => {
  const source = "a: &a {one: 1}\nb: &b {<<: *a, two: 2}\nc: &c {<<: *b, three: 3}\nresult: {<<: *c}\n";
  assert.throws(() => yaml.load(source, { maxTotalMergeKeys: 4 }), /maxTotalMergeKeys/);
  const allowed = yaml.load(source, { maxTotalMergeKeys: 16 });
  assert.deepEqual(allowed.result, { one: 1, two: 2, three: 3 });
});

// https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh
test("empty YAML merge sources also consume the budget", () => {
  const source = "sources: &sources [{}, {}, {}, {}]\nresult: {<<: *sources}\n";
  assert.throws(() => yaml.load(source, { maxTotalMergeKeys: 2 }), /maxTotalMergeKeys/);
  assert.deepEqual(yaml.load(source, { maxTotalMergeKeys: 8 }).result, {});
});

test("ordinary YAML aliases and merge overrides remain intact", () => {
  const source = "base: &base {one: 1, two: 2}\ncopy: {<<: *base, two: 20, three: 3}\nalias: *base\n";
  const result = yaml.load(source, { maxTotalMergeKeys: 16 });
  assert.deepEqual(result.base, { one: 1, two: 2 });
  assert.deepEqual(result.copy, { one: 1, two: 20, three: 3 });
  assert.equal(result.alias, result.base);
});

const browserslist = requireDependency("browserslist");

// https://github.com/browserslist/browserslist/security/advisories/GHSA-73wf-gq98-2v4g
for (const key of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"]) {
  test(`custom browser statistics safely accept the key ${key}`, (t) => {
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
    t.after(() => {
      browserslist.clearCaches();
      assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototype);
    });
    const stats = JSON.parse(JSON.stringify({ [key]: { sample: 5 }, chrome: { "100": 50 } }));
    const before = JSON.stringify(stats);
    browserslist.clearCaches();
    const result = browserslist("chrome 100", { stats, path: dependencyRoot });
    assert.deepEqual(result, ["chrome 100"]);
    assert.equal(JSON.stringify(stats), before);
    assert.equal(Object.getPrototypeOf(stats), Object.prototype);
  });
}

test("ordinary browser queries and custom usage selection remain intact", () => {
  browserslist.clearCaches();
  const stats = { chrome: { "100": 50 } };
  assert.deepEqual(browserslist("chrome 100", { stats, path: dependencyRoot }), ["chrome 100"]);
  assert.deepEqual(browserslist("> 1% in my stats", { stats, path: dependencyRoot }), ["chrome 100"]);
  browserslist.clearCaches();
});
