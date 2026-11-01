import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const helperPath = path.join(repository, "apps/web/src/lib/og-local-fonts.ts");
const fontAssets = [
  ["Unfreq Sans", "@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff"],
  ["Unfreq Mono", "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff"],
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function childEnvironment() {
  // No NODE_OPTIONS, preload/compile cache, application .env, credentials or
  // service URLs are passed to the compiler/probes. They have no network work.
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
    "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
}

test("the bundled OG helper resolves real installed fonts outside the repository cwd with current and legacy Node loaders", { timeout: 90_000 }, async (t) => {
  const root = await realpath(repository);
  const results = path.join(root, "test-results");
  await mkdir(results, { recursive: true });
  const resultsReal = await realpath(results);
  assert.ok(inside(root, resultsReal), "Refusing evidence outside this repository.");
  const images = path.join(resultsReal, "images");
  await mkdir(images, { recursive: true });
  const imagesReal = await realpath(images);
  assert.ok(inside(resultsReal, imagesReal), "Refusing a redirected image evidence directory.");
  const directory = await mkdtemp(path.join(imagesReal, "og-webpack-"));
  const reportPath = path.join(directory, "result.json");
  const report = { node: process.version, directory, passed: false, children: [] };
  const persist = () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  // Keep successful and failed build/probe evidence. Never remove caller data.
  t.diagnostic(`OG Webpack evidence: ${path.relative(root, directory)}`);

  const runOwned = async (label, args, cwd, timeout) => {
    const child = spawnSync(process.execPath, args, {
      cwd, env: childEnvironment(), windowsHide: true, encoding: "utf8",
      timeout, killSignal: "SIGKILL", maxBuffer: 256 * 1024,
    });
    await writeFile(path.join(directory, `${label}.stdout.log`), child.stdout ?? "");
    await writeFile(path.join(directory, `${label}.stderr.log`), child.stderr ?? "");
    report.children.push({ label, pid: child.pid, exitCode: child.status, signal: child.signal,
      errorCode: child.error?.code ?? null, timeoutMs: timeout });
    await persist();
    // spawnSync waits for the owned process to end, including after SIGKILL;
    // no timeout Promise can return with compilation or font reads escaping.
    assert.equal(child.error, undefined, `${label} could not finish; inspect its retained evidence.`);
    assert.equal(child.signal, null, `${label} was terminated; inspect its retained evidence.`);
    assert.equal(child.status, 0, `${label} failed; inspect its retained stderr.`);
    return child.stdout;
  };

  try {
    const source = await readFile(helperPath);
    report.helperSha256 = hash(source);
    const ts = require("typescript");
    const entry = path.join(directory, "entry.mjs");
    await writeFile(entry, ts.transpileModule(source.toString("utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText);
    const output = path.join(directory, "output");
    const bundle = path.join(output, "fonts.cjs");
    const statsPath = path.join(directory, "webpack-stats.json");
    const compilerPath = path.join(directory, "compile.mjs");
    await writeFile(compilerPath, `
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
if (process.argv.length !== 2) throw new Error("OG_COMPILE_ACCEPTS_NO_ARGUMENTS");
globalThis.fetch = async () => { throw new Error("OG_COMPILE_NETWORK_BLOCKED"); };
const webpack = createRequire(${JSON.stringify(path.join(root, "package.json"))})("next/dist/compiled/webpack/webpack").webpack;
const compiler = webpack({ mode: "production", target: "node22", context: ${JSON.stringify(root)}, entry: ${JSON.stringify(entry)},
  output: { path: ${JSON.stringify(output)}, filename: "fonts.cjs", library: { type: "commonjs2" } },
  optimization: { minimize: false }, node: { __dirname: false, __filename: false } });
try {
  const stats = await new Promise((resolve, reject) => compiler.run((error, value) => error ? reject(error) : resolve(value)));
  const result = stats.toJson({ all: false, errors: true, warnings: true });
  await writeFile(${JSON.stringify(statsPath)}, JSON.stringify(result, null, 2));
  if ((result.errors?.length ?? 0) || (result.warnings?.length ?? 0)) process.exitCode = 1;
} finally { await new Promise((resolve, reject) => compiler.close((error) => error ? reject(error) : resolve())); }
`);
    await persist();
    await runOwned("compile", [compilerPath], root, 45_000);
    const stats = JSON.parse(await readFile(statsPath, "utf8"));
    assert.deepEqual(stats.errors ?? [], [], "OG Webpack compilation must have no errors.");
    assert.deepEqual(stats.warnings ?? [], [], "A dynamic font context warning is not an acceptable build.");
    assert.ok(!(await readFile(bundle, "utf8")).includes("webpackEmptyContext"), "OG fonts must not resolve through an empty Webpack context.");
    report.webpack = { errors: 0, warnings: 0, emptyContext: false };

    const expectedFonts = await Promise.all(fontAssets.map(async ([name, asset]) => {
      const bytes = await readFile(require.resolve(asset));
      return { name, bytes: bytes.length, sha256: hash(bytes) };
    }));
    const foreignCwd = await realpath(tmpdir());
    assert.ok(!inside(root, foreignCwd), "The runtime probe must execute outside the repository cwd.");
    const probePath = path.join(directory, "probe.mjs");
    await writeFile(probePath, `
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const mode = process.argv[2];
if (process.argv.length !== 3 || !["current", "legacy"].includes(mode)) throw new Error("INVALID_OG_FONT_PROBE");
if (mode === "legacy") process.getBuiltinModule = undefined;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts += 1; throw new Error("OG_FONT_PROBE_NETWORK_BLOCKED"); };
const module = createRequire(import.meta.url)(${JSON.stringify(bundle)});
const typography = await module.getLocalOgTypography();
const fonts = typography.fonts.map((font) => {
  if (!Buffer.isBuffer(font.data)) throw new Error("OG_FONT_BYTES_NOT_LOADED");
  return { name: font.name, bytes: font.data.length, sha256: createHash("sha256").update(font.data).digest("hex") };
});
process.stdout.write(JSON.stringify({ mode, getterAvailable: typeof process.getBuiltinModule === "function",
  fonts, text: typography.formatCardText("合成中文 FM 78.23").text, networkAttempts }));
`);
    report.probes = [];
    for (const mode of ["current", "legacy"]) {
      const probe = JSON.parse(await runOwned(mode, [probePath, mode], foreignCwd, 15_000));
      assert.equal(probe.mode, mode);
      assert.deepEqual(probe.fonts, expectedFonts, "Bundled OG must read the actual installed font files.");
      assert.equal(probe.text, "合成中文 FM 78.23");
      assert.equal(probe.networkAttempts, 0);
      if (mode === "legacy") assert.equal(probe.getterAvailable, false);
      else assert.equal(probe.getterAvailable, typeof process.getBuiltinModule === "function");
      report.probes.push(probe);
    }
    assert.equal(hash(await readFile(helperPath)), report.helperSha256, "OG source changed during its bundle regression.");
    report.passed = true;
  } finally { await persist(); }
});
