import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const dependencyRoot = resolve(process.env.DEPENDENCY_TEST_ROOT ?? repositoryRoot);
const lock = JSON.parse(readFileSync(join(dependencyRoot, "package-lock.json"), "utf8"));
const legacyCore = join(dependencyRoot, "node_modules/@esbuild-kit/core-utils");
const legacyLoader = join(dependencyRoot, "node_modules/@esbuild-kit/esm-loader/dist/index.js");
const instances = new Map();
for (const location of Object.keys(lock.packages).filter((name) => /(?:^|\/)esbuild$/.test(name))) {
  const packageRoot = resolve(dependencyRoot, location);
  const requirePackage = createRequire(join(packageRoot, "package.json"));
  const entry = realpathSync(requirePackage.resolve(packageRoot));
  const version = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
  const instance = instances.get(entry) ?? { entry, version, locations: [] };
  instance.locations.push(location);
  instances.set(entry, instance);
}
assert.ok(instances.size > 0, "No installed esbuild instances were found.");

const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]);
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toUpperCase())));
// Legacy transforms must not create a shared cache outside the owned fixture.
childEnv.ESBK_DISABLE_CACHE = "1";
childEnv.TSX_DISABLE_CACHE = "1";

function checkChild(source, { args = [], cwd = process.cwd() } = {}) {
  const child = spawnSync(process.execPath, ["--no-warnings", "--max-old-space-size=128", ...args,
    "--input-type=commonjs", "-e", source], {
    cwd, env: childEnv, encoding: "utf8", timeout: 20_000,
    killSignal: "SIGKILL", maxBuffer: 32_768, windowsHide: true,
  });
  const detail = `${child.error?.message ?? ""}\nstatus=${child.status}, signal=${child.signal}\n${child.stdout ?? ""}\n${child.stderr ?? ""}`.slice(0, 32_768);
  assert.equal(child.error, undefined, detail);
  assert.equal(child.signal, null, detail);
  assert.equal(child.status, 0, detail);
  assert.equal(child.stderr, "", detail);
  assert.equal(child.stdout, "ok\n", detail);
}

function removeFixture(directory) {
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("unfreq-esbuild-"));
  rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 20 });
}

test("legacy core-utils preserves synchronous CJS and asynchronous ESM TypeScript transforms", () => {
  // These are the actual public APIs used by the archived loader, not a stub:
  // esbuild-kit/core-utils@6756a9a/src/transform/index.ts.
  const source = `
    const assert = require('node:assert/strict');
    const { pathToFileURL } = require('node:url');
    const { join } = require('node:path');
    const core = require(${JSON.stringify(legacyCore)});
    (async () => {
      const file = join(process.cwd(), 'ordinary 资料.ts');
      const sync = core.transformSync('export const answer: number = 42; export default import.meta.url;', file);
      const result = { exports: {} };
      new Function('module', 'exports', 'require', sync.code)(result, result.exports, require);
      assert.equal(result.exports.answer, 42);
      assert.equal(result.exports.default, pathToFileURL(file).href);
      const syncMap = typeof sync.map === 'string' ? JSON.parse(sync.map) : sync.map;
      assert.equal(syncMap.version, 3);
      const asyncResult = await core.transform('export const answer: number = 42; export default "普通文本";', file);
      const esm = await import('data:text/javascript;base64,' + Buffer.from(asyncResult.code).toString('base64'));
      assert.equal(esm.answer, 42);
      assert.equal(esm.default, '普通文本');
      const asyncMap = typeof asyncResult.map === 'string' ? JSON.parse(asyncResult.map) : asyncResult.map;
      assert.equal(asyncMap.version, 3);
      process.stdout.write('ok\\n');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  checkChild(source);
});

for (const extension of ["ts", "mts"]) {
  test(`legacy ESM loader executes an ordinary .${extension} module and TypeScript sibling import`, () => {
    const directory = mkdtempSync(join(tmpdir(), "unfreq-esbuild-loader-"));
    try {
      writeFileSync(join(directory, "package.json"), '{"type":"module"}\n', { flag: "wx" });
      writeFileSync(join(directory, "value.ts"), "export const value: number = 21;\n", { flag: "wx" });
      const entry = join(directory, `ordinary.${extension}`);
      writeFileSync(entry, "import { value } from './value.js';\nif (value * 2 !== 42) throw new Error('ordinary import failed');\nprocess.stdout.write('ok\\n');\n", { flag: "wx" });
      checkChild(`import(${JSON.stringify(pathToFileURL(entry).href)}).catch(error => { console.error(error); process.exitCode = 1; });`, {
        args: ["--loader", pathToFileURL(legacyLoader).href], cwd: directory,
      });
    } finally {
      removeFixture(directory);
    }
  });
}

// Every installed copy is exercised, including the legacy loader's private copy
// and tsx's private copy when npm does not deduplicate them. All server data is
// synthetic and remains inside this test's owned temporary root.
function serveCheck(instance, body) {
  const source = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const http = require('node:http');
    const esbuild = require(${JSON.stringify(instance.entry)});
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unfreq-esbuild-serve-'));
    const servedir = path.join(directory, 'public');
    fs.mkdirSync(servedir);
    const publicText = 'ordinary synthetic public control\\n';
    const outsideText = 'UNFREQ_SYNTHETIC_OUTSIDE_TOKEN_42\\n';
    fs.writeFileSync(path.join(servedir, 'inside.txt'), publicText, { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'outside-token.txt'), outsideText, { flag: 'wx' });
    let context;
    const deadline = setTimeout(() => { console.error('esbuild fixture exceeded its deadline'); process.exit(1); }, 15_000);
    function request(port, requestPath, headers = {}, headersOnly = false) {
      return new Promise((resolve, reject) => {
        let completed = false;
        const finish = (error, result) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          if (error) reject(error); else resolve(result);
        };
        // node:http preserves the raw backslashes and percent encodings. URL
        // constructors/fetch would normalize the very input under test.
        const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, headers, agent: false }, res => {
          const chunks = [];
          let bytes = 0;
          const result = () => ({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
          if (headersOnly) { finish(undefined, result()); res.destroy(); return; }
          res.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > 8192) { finish(new Error('HTTP response exceeded fixture bound')); res.destroy(); }
            else chunks.push(chunk);
          });
          res.on('end', () => finish(undefined, result()));
          res.on('error', error => finish(error));
          res.on('aborted', () => finish(new Error('HTTP response aborted')));
        });
        const timer = setTimeout(() => { finish(new Error('HTTP request exceeded fixture deadline')); req.destroy(); }, 2000);
        req.on('error', error => finish(error));
        req.end();
      });
    }
    (async () => {
      try {
        context = await esbuild.context({ stdin: { contents: 'export const answer: number = 42;', loader: 'ts', sourcefile: 'control.ts' },
          outfile: path.join(servedir, 'bundle.js'), write: false, logLevel: 'silent' });
        const server = await context.serve({ host: '127.0.0.1', port: 0, servedir });
        const ordinary = await request(server.port, '/inside.txt');
        assert.equal(ordinary.status, 200);
        assert.equal(ordinary.body, publicText);
        const bundle = await request(server.port, '/bundle.js');
        assert.equal(bundle.status, 200);
        assert.match(bundle.body, /42/);
        ${body}
      } finally {
        try {
          if (context) await Promise.race([context.dispose(), new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error('esbuild dispose exceeded fixture deadline')), 2000);
            timer.unref();
          })]);
        } finally {
          if (typeof esbuild.stop === 'function') esbuild.stop();
          assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
          assert.ok(path.basename(directory).startsWith('unfreq-esbuild-serve-'));
          fs.rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 20 });
          clearTimeout(deadline);
        }
      }
      process.stdout.write('ok\\n');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  checkChild(source);
}

for (const instance of instances.values()) {
  const label = `${instance.version} (${instance.locations.join(", ")})`;
  // https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99
  test(`esbuild ${label} does not authorize hostile origins for files, output, or event streams`, () => {
    serveCheck(instance, `
      const violations = [];
      for (const origin of ['http://attacker.invalid', 'http://ATTACKER.invalid:80', 'https://attacker.invalid:443', 'null']) {
        for (const resource of ['/inside.txt', '/bundle.js', '/esbuild']) {
          const response = await request(server.port, resource, { origin, ...(resource === '/esbuild' ? { accept: 'text/event-stream' } : {}) }, resource === '/esbuild');
          assert.equal(response.status, 200);
          if (response.headers['access-control-allow-origin'] !== undefined) violations.push({ origin, resource, allowed: response.headers['access-control-allow-origin'] });
        }
      }
      assert.deepEqual(violations, [], 'Untrusted websites can read esbuild resources.');
    `);
  });

  // https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr
  test(`esbuild ${label} rejects raw and encoded Windows traversal outside servedir`, { skip: process.platform !== "win32" }, () => {
    serveCheck(instance, `
      const violations = [];
      const paths = ['/..\\\\outside-token.txt', '/..%5coutside-token.txt', '/..%5Coutside-token.txt',
        '/%2e%2e%5coutside-token.txt', '/nested/..\\\\..\\\\outside-token.txt'];
      for (const requestPath of paths) {
        const response = await request(server.port, requestPath);
        const exposedSyntheticToken = response.body.includes(outsideText);
        if (![400, 404].includes(response.status) || exposedSyntheticToken) violations.push({ requestPath, status: response.status, exposedSyntheticToken });
      }
      assert.deepEqual(violations, [], 'Windows traversal escaped the synthetic servedir.');
    `);
  });
}
