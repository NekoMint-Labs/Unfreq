import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const dependencyRoot = resolve(process.env.DEPENDENCY_TEST_ROOT ?? repositoryRoot);

// Execute in the caller's disposable checkout. DEPENDENCY_TEST_ROOT selects
// dependencies to read; it must never become a PoC's working/output directory.
function checkMinimatch(body, { platform, parser = false } = {}) {
  const source = `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const path = require('node:path');
    const fs = require('node:fs');
    const { tmpdir } = require('node:os');
    const { pathToFileURL } = require('node:url');
    const requireRoot = createRequire(${JSON.stringify(resolve(dependencyRoot, "package.json"))});
    const requireEstree = createRequire(requireRoot.resolve('@typescript-eslint/typescript-estree/package.json'));
    const nested = requireEstree('minimatch');
    (async () => {
      ${body}
      process.stdout.write('ok\\n');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toUpperCase())));
  // This upstream testing switch sets the matcher platform before it is loaded.
  // No other inherited Node options, credentials or application config reach it.
  if (platform) env.__MINIMATCH_TESTING_PLATFORM__ = platform;
  const child = spawnSync(process.execPath, [
    `--max-old-space-size=${parser ? 384 : 128}`, "--input-type=commonjs", "-e", source,
  ], {
    cwd: process.cwd(), env, encoding: "utf8", timeout: parser ? 20_000 : 10_000,
    killSignal: "SIGKILL", maxBuffer: 32_768, windowsHide: true,
  });
  const detail = `status=${child.status}, signal=${child.signal}\n${child.error?.message ?? ""}\nstdout=${child.stdout ?? ""}\nstderr=${child.stderr ?? ""}`.slice(0, 32_768);
  // Exceeding the execution budget fails the test; it never counts as rejection.
  assert.equal(child.error, undefined, detail);
  assert.equal(child.signal, null, detail);
  assert.equal(child.status, 0, detail);
  assert.equal(child.stderr, "", detail);
  assert.equal(child.stdout, "ok\n", detail);
}

test("ESLint's root minimatch retains callable/default, class and makeRe APIs", () => {
  checkMinimatch(`
    const legacy = requireRoot('minimatch');
    assert.equal(typeof legacy, 'function');
    const imported = await import(pathToFileURL(requireRoot.resolve('minimatch')).href);
    assert.equal(imported.default, legacy);
    assert.equal(imported.default('config/tool.js', '*.js', { matchBase: true }), true);
    assert.equal(legacy('config/tool.js', '*.js'), false);
    const matcher = new legacy.Minimatch('config/{tool,eslint}.js', { dot: true });
    assert.equal(matcher.match('config/tool.js'), true);
    assert.equal(matcher.match('config/other.js'), false);
    const re = legacy.makeRe('@scope/package/*');
    assert.equal(re instanceof RegExp, true);
    assert.equal(re.test('@scope/package/internal'), true);
    assert.equal(re.test('@scope/other/internal'), false);
  `);
});

test("ESLint's root minimatch preserves partial directory traversal", () => {
  checkMinimatch(`
    const { Minimatch } = requireRoot('minimatch');
    const matcher = new Minimatch('src/*/entry.js', { dot: true });
    // ESLint's file enumerator uses .match(directory, true) before descending.
    assert.equal(matcher.match('src', true), true);
    assert.equal(matcher.match('src/tools', true), true);
    assert.equal(matcher.match('other', true), false);
    assert.equal(matcher.match('src/tools/entry.js'), true);
    assert.equal(matcher.match('src/tools/other.js'), false);
    assert.equal(matcher.match('src/tools/deep/entry.js'), false);
  `);
});

for (const platform of ["linux", "win32"]) {
  test(`typescript-estree's named minimatch keeps allowDefaultProject matching on ${platform}`, () => {
    checkMinimatch(`
      assert.equal(typeof nested.minimatch, 'function');
      const match = (file, pattern) => nested.minimatch(file, pattern, { dot: true });
      const cases = [
        ['eslint.config.js', '*.js', true],
        ['.config.js', '*.js', true],
        ['config/tool.js', '*.js', false],
        ['config/tool.js', 'config/*.js', true],
        ['config/deep/tool.js', 'config/*.js', false],
        ['tool.config.mjs', '{eslint,tool}.config.{js,mjs}', true],
        ['eslint.config.mjs', '+(eslint|tool).config.@(js|mjs)', true],
        ['other.config.mjs', '+(eslint|tool).config.@(js|mjs)', false],
        ['excluded.js', '!excluded.js', false],
        ['allowed.js', '!excluded.js', true],
        ['file.js', '#file.js', false],
        ['scripts/config-2.js', 'scripts/config-{1..3}.js', true],
        ['a[1].js', 'a\\\\[1\\\\].js', true],
        ['é.js', '[[:alpha:]].js', true],
        ['e\\u0301.js', 'é.js', false],
        ['config.js', '*{*,x}/config.js', true],
        ['src/config.js', '*{*,x}/config.js', true],
      ];
      for (const [file, pattern, expected] of cases) {
        assert.equal(match(file, pattern), expected, JSON.stringify({ file, pattern }));
      }
      const paths = path[${JSON.stringify(platform === "win32" ? "win32" : "posix")}];
      const root = ${JSON.stringify(platform === "win32" ? "C:\\repo" : "/repo")};
      const relative = paths.relative(root, paths.resolve(root, 'config', 'tool.js'));
      assert.equal(match(relative, 'config/*.js'), true);
      const outside = paths.relative(root, paths.resolve(root, '..', 'other', 'tool.js'));
      assert.equal(match(outside, '../other/*.js'), true);
      assert.equal(match(relative, 'config/other.js'), false);
    `, { platform });
  });
}

test("projectService accepts an allowlisted out-of-project file and rejects another", () => {
  checkMinimatch(`
    const parser = requireRoot('@typescript-eslint/parser');
    const tempRoot = path.resolve(tmpdir());
    const fixture = fs.mkdtempSync(path.join(tempRoot, 'unfreq-minimatch-'));
    assert.equal(path.dirname(fixture), tempRoot);
    try {
      fs.mkdirSync(path.join(fixture, 'src'));
      fs.writeFileSync(path.join(fixture, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2020', allowJs: true },
        include: ['src/*.ts'],
      }));
      const includedPath = path.join(fixture, 'src', 'included.ts');
      const allowedPath = path.join(fixture, 'allowed.config.js');
      const deniedPath = path.join(fixture, 'outside.js');
      fs.writeFileSync(includedPath, 'export const value = 1;');
      fs.writeFileSync(allowedPath, 'module.exports = { value: 1 };');
      fs.writeFileSync(deniedPath, 'module.exports = { value: 2 };');
      const options = {
        tsconfigRootDir: fixture,
        projectService: { allowDefaultProject: ['*.config.js'] },
      };
      const allowed = parser.parseForESLint(fs.readFileSync(allowedPath, 'utf8'), {
        ...options, filePath: allowedPath,
      });
      assert.ok(allowed.services.program, 'allowlisted file must receive a TypeScript program');
      assert.ok(allowed.services.program.getSourceFile(allowedPath));
      assert.throws(() => parser.parseForESLint(fs.readFileSync(deniedPath, 'utf8'), {
        ...options, filePath: deniedPath,
      }), /was not found by the project service[\\s\\S]*allowDefaultProject[\\s\\S]*does not match/);
      const included = parser.parseForESLint(fs.readFileSync(includedPath, 'utf8'), {
        ...options, filePath: includedPath,
      });
      assert.ok(included.services.program.getSourceFile(includedPath));
    } finally {
      parser.clearCaches();
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  `, { parser: true });
});

// GHSA-g3hv-75wg-m249 and upstream 77a0f5c (test/preprocess-limits.ts).
// set is documented publicly. Only its expansion count is asserted, never
// whether its individual path portions use RegExp or the newer Matcher.
test("nested minimatch bounds opt2 globparts expansion through class and defaults", () => {
  checkMinimatch(`
    const pattern = Array(9).fill('**/../a/b').join('/');
    const options = { optimizationLevel: 2, braceExpandMax: 64 };
    const direct = new nested.Minimatch(pattern, options);
    assert.ok(direct.set.length > 0 && direct.set.length <= 64,
      'opt2 expansion must honor braceExpandMax');
    assert.equal(direct.match('ordinary/no-match.js'), false);
    assert.equal(nested.minimatch('ordinary/no-match.js', pattern, options), false);
    const defaults = nested.defaults(options);
    assert.equal(typeof defaults, 'function');
    const configured = new defaults.Minimatch(pattern);
    assert.ok(configured.set.length > 0 && configured.set.length <= 64);
    assert.equal(defaults('ordinary/no-match.js', pattern), false);
    const control = new nested.Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
    assert.equal(control.match('../a/b/../c/d'), true);
    assert.equal(control.match('x/a/b/y/c/d'), true);
    assert.equal(control.match('x/a/b/y/c/other'), false);
  `);
});

test("nested minimatch bounds brace-created globstars without losing ordinary matches", () => {
  checkMinimatch(`
    // This accepted raw spelling has no '**', but brace expansion creates it.
    const pattern = Array(9).fill('*{*,x}/../a/b').join('/');
    assert.equal(pattern.includes('**'), false);
    const options = { optimizationLevel: 2, braceExpandMax: 16 };
    const matcher = new nested.Minimatch(pattern, options);
    assert.ok(matcher.set.length > 0 && matcher.set.length <= 16);
    assert.equal(matcher.match('ordinary/no-match.js'), false);
    assert.equal(nested.minimatch('ordinary/no-match.js', pattern, options), false);
    const control = '*{*,x}/config.js';
    assert.equal(nested.minimatch('src/config.js', control, { dot: true }), true);
    assert.equal(nested.minimatch('src/other.js', control, { dot: true }), false);
  `);
});
