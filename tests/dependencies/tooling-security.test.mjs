import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const filename = fileURLToPath(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const dependencyRoot = resolve(process.env.DEPENDENCY_TEST_ROOT ?? repositoryRoot);
const requireDependency = createRequire(resolve(dependencyRoot, "package.json"));
const requireVitest = createRequire(requireDependency.resolve("vitest/package.json"));
const packageVersion = (loader, name) => JSON.parse(readFileSync(loader.resolve(`${name}/package.json`), "utf8")).version;
const loadModule = (loader, name) => import(pathToFileURL(loader.resolve(name)).href);

// Each case runs in a separate, bounded process. Only synthetic fixtures are
// read, every server binds to loopback on an ephemeral port, and no generated
// mock code is evaluated. DEPENDENCY_TEST_ROOT also permits old-tree baselines.
function checkChild(t, caseName) {
  const fixture = mkdtempSync(join(tmpdir(), "unfreq-tooling-security-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toUpperCase())));
  Object.assign(env, {
    DEPENDENCY_TEST_ROOT: dependencyRoot,
    UNFREQ_TOOLING_FIXTURE: fixture,
    NODE_ENV: "test",
    CI: "1",
  });
  const child = spawnSync(process.execPath, ["--max-old-space-size=192", filename, "--tooling-security-worker", caseName], {
    cwd: process.cwd(), env, encoding: "utf8", timeout: 15_000,
    killSignal: "SIGKILL", maxBuffer: 65_536, windowsHide: true,
  });
  if (child.stdout?.trim()) t.diagnostic(child.stdout.trim().slice(0, 2500));
  const detail = `${child.error?.message ?? ""}\n${child.stderr ?? ""}`.slice(0, 3000);
  assert.equal(child.error, undefined, `tooling subprocess exceeded its execution boundary: ${detail}`);
  assert.equal(child.signal, null, `tooling subprocess was terminated: ${detail}`);
  assert.equal(child.status, 0, `tooling subprocess failed: ${detail}`);
}

async function redirectCase(caseName, fixture) {
  const { createServer } = await loadModule(requireVitest, "vite");
  const { interceptorPlugin } = await loadModule(requireVitest, "@vitest/mocker/node");
  const { WebSocket } = requireDependency("ws");
  const root = join(fixture, "root");
  mkdirSync(root);
  const control = "unfreq-synthetic-in-root-control";
  const outside = "unfreq-synthetic-outside-root";
  const denied = "unfreq-synthetic-denied-env";
  writeFileSync(join(root, "ordinary.js"), `export const value = ${JSON.stringify(control)};`);
  writeFileSync(join(fixture, "outside.js"), `export const value = ${JSON.stringify(outside)};`);
  writeFileSync(join(root, ".env"), `export const value = ${JSON.stringify(denied)};`);
  const id = "/unfreq-synthetic-mock";
  let socket;
  const server = await createServer({
    root, configFile: false, envDir: false, cacheDir: join(fixture, "vite-cache"), logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0, strictPort: true, watch: null, fs: { allow: [root], deny: ["**/.env"] } },
    plugins: [
      { name: "unfreq-synthetic-module", enforce: "pre", resolveId: (requested) => requested === id ? id : undefined },
      interceptorPlugin(),
    ],
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.equal(address.address, "127.0.0.1");
    assert.ok(address.port > 0);
    const redirect = {
      "redirect-parent": "traversal:../outside.js",
      "redirect-backslash": "traversal:..\\outside.js",
      "redirect-denied": "traversal:.env",
      "redirect-control": "traversal:ordinary.js",
    }[caseName];
    // This is Vite's fresh synthetic fixture token, never a user credential.
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/?token=${encodeURIComponent(server.config.webSocketToken)}`, "vite-hmr");
    await new Promise((resolveRegistration, reject) => {
      const timeout = setTimeout(() => reject(new Error("synthetic mock registration timed out")), 4000);
      socket.on("error", (error) => { clearTimeout(timeout); reject(error); });
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === "custom" && message.event === "vitest:interceptor:register:result") {
          clearTimeout(timeout);
          resolveRegistration();
        }
      });
      socket.on("open", () => socket.send(JSON.stringify({
        type: "custom", event: "vitest:interceptor:register",
        data: { type: "redirect", raw: id, id, url: id, redirect },
      })));
    });
    const result = await server.transformRequest(id).catch(() => null);
    const observed = result?.code ?? null;
    process.stdout.write(`${JSON.stringify({ caseName, returnedSyntheticContent: observed })}\n`);
    if (caseName === "redirect-control") {
      assert.ok(observed?.includes(control), "an ordinary in-root redirect must remain available");
    } else {
      assert.equal(result, null, "a disallowed redirect must not be registered or read");
    }
  } finally {
    socket?.terminate();
    await server.close();
  }
}

async function manualCase(caseName) {
  const { createManualModuleSource } = await loadModule(requireVitest, "@vitest/mocker/node");
  const { parse } = requireDependency("@babel/parser");
  const moduleUrl = caseName === "manual-injection"
    ? 'x"); globalThis.UNFREQ_SYNTHETIC_INJECTED = 1; void("'
    : caseName === "manual-escapes" ? 'module\\name"\nnext-line' : "/ordinary-module.js";
  const exportNames = caseName === "manual-escapes" ? ["default", 'quoted"\\name\nline'] : ["default", "answer"];
  const source = createManualModuleSource(moduleUrl, exportNames);
  let ast;
  try {
    ast = parse(source, { sourceType: "module" });
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ caseName, generatedModuleParses: false })}\n`);
    throw error;
  }
  const call = ast.program.body[0]?.declarations?.[0]?.init?.argument;
  const assignments = [];
  const memberReads = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "AssignmentExpression") assignments.push(node);
    if (node.type === "MemberExpression" && node.computed && node.property.type === "StringLiteral"
      && ["__factoryModule__", "resolvedModule"].includes(node.object.name)) memberReads.push(node.property.value);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast.program);
  const injectedAssignment = assignments.some((node) => node.left.type === "MemberExpression"
    && node.left.object.name === "globalThis" && node.left.property.name === "UNFREQ_SYNTHETIC_INJECTED");
  process.stdout.write(`${JSON.stringify({
    caseName, generatedModuleParses: true, factoryArgument: call?.arguments?.[0]?.value, injectedAssignment,
  })}\n`);
  assert.equal(injectedAssignment, false, "URL text must not become an executable global assignment");
  assert.equal(call?.type, "CallExpression");
  assert.equal(call.callee.property.name, "getFactoryModule");
  assert.equal(call.arguments.length, 1);
  assert.equal(call.arguments[0].type, "StringLiteral");
  assert.equal(call.arguments[0].value, moduleUrl, "the complete URL must remain one string argument");
  assert.equal(assignments.length, exportNames.length, "only generated export updates may be assignments");
  assert.ok(assignments.every((node, index) => node.left.type === "Identifier" && node.left.name === `__${index}`));
  assert.deepEqual(memberReads, [...exportNames, ...exportNames]);
  assert.deepEqual(ast.program.body.filter((node) => node.type === "ExportNamedDeclaration")
    .map((node) => node.specifiers[0].exported.value), exportNames);
}

function babelCase(caseName, fixture) {
  const babel = requireDependency("@babel/core");
  const { parse } = requireDependency("@babel/parser");
  const fs = requireDependency("node:fs");
  const root = join(fixture, "project");
  const sourceDir = join(root, "src");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(root, "package.json"), '{"name":"unfreq-synthetic-fixture","private":true}');
  const sentinel = "unfreq-synthetic-source-map-content";
  const map = { version: 3, sources: ["original.js"], sourcesContent: [`const answer = 42; // ${sentinel}`], names: [], mappings: "AAAA" };
  const outsideMap = join(fixture, "outside.map");
  writeFileSync(outsideMap, JSON.stringify(map));
  writeFileSync(join(sourceDir, "ordinary.map"), JSON.stringify(map));
  writeFileSync(join(root, "ordinary.map"), JSON.stringify(map));
  const mapUrl = {
    "babel-parent": "../../outside.map",
    "babel-disguised-parent": "sub/../../../outside.map",
    "babel-absolute": outsideMap,
    "babel-map-control": "ordinary.map",
    "babel-parent-control": "../ordinary.map",
  }[caseName];
  const source = `const answer = 42;${mapUrl ? `\n//# sourceMappingURL=${mapUrl}` : ""}`;
  const inputFilename = join(sourceDir, "input.js");
  const ast = parse(source, { sourceType: "module", sourceFilename: inputFilename });
  // Matches the hooks plugin's transformFromAstSync entry point, with source
  // maps enabled only here so attempted file disclosure is observable.
  let outsideReads = 0;
  const readFile = fs.readFileSync;
  fs.readFileSync = function (path, ...args) {
    if (typeof path === "string" && resolve(path) === outsideMap) outsideReads += 1;
    return readFile.call(this, path, ...args);
  };
  let result;
  try {
    result = babel.transformFromAstSync(ast, source, {
      filename: inputFilename, root, configFile: false, babelrc: false, sourceMaps: true,
    });
  } finally {
    fs.readFileSync = readFile;
  }
  const loadedSyntheticMap = result.map.sourcesContent.some((content) => content?.includes(sentinel));
  process.stdout.write(`${JSON.stringify({ caseName, outsideReads, loadedSyntheticMap, ordinaryCode: result.code })}\n`);
  assert.match(result.code, /const answer = 42/);
  assert.equal(outsideReads, 0, "the external synthetic map must not be read at all");
  if (["babel-map-control", "babel-parent-control"].includes(caseName)) {
    assert.equal(loadedSyntheticMap, true, "a legitimate map inside the package must still be applied");
  } else {
    assert.equal(loadedSyntheticMap, false, "a map outside the package must not be read into the result");
  }
}

if (process.argv[2] === "--tooling-security-worker") {
  const caseName = process.argv[3];
  process.stdout.write(`${JSON.stringify({
    vitest: packageVersion(requireDependency, "vitest"), mocker: packageVersion(requireVitest, "@vitest/mocker"),
    vite: packageVersion(requireVitest, "vite"), babel: packageVersion(requireDependency, "@babel/core"),
  })}\n`);
  try {
    const fixture = process.env.UNFREQ_TOOLING_FIXTURE;
    assert.ok(fixture && resolve(fixture) === fixture);
    if (caseName.startsWith("redirect-")) await redirectCase(caseName, fixture);
    else if (caseName.startsWith("manual-")) await manualCase(caseName);
    else if (caseName.startsWith("babel-")) babelCase(caseName, fixture);
    else throw new Error(`unknown tooling security case: ${caseName}`);
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  }
} else {
  // GHSA-82fw-gwwq-j7x9: the standalone plugin's actual registration/load path.
  for (const name of ["parent", "backslash", "denied", "control"]) {
    test(`mocker redirect ${name} respects the Vite file boundary`, (t) => checkChild(t, `redirect-${name}`));
  }
  // GHSA-qxg6-89mg-rqv8: inspect the generated module's AST without evaluating it.
  for (const name of ["injection", "escapes", "control"]) {
    test(`manual mock ${name} keeps URL and exports in string positions`, (t) => checkChild(t, `manual-${name}`));
  }
  // GHSA-4x5r-pxfx-6jf8: the public AST transform entry point used by React lint.
  for (const name of ["parent", "disguised-parent", "absolute", "map-control", "parent-control", "plain-control"]) {
    test(`Babel ${name} keeps source-map reads within its package`, (t) => checkChild(t, `babel-${name}`));
  }
}
