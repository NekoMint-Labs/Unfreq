import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The same cases can exercise the retained old and candidate dependency trees.
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const dependencyRoot = resolve(process.env.DEPENDENCY_TEST_ROOT ?? repositoryRoot);
const requireDependency = createRequire(resolve(dependencyRoot, "package.json"));
const Fastify = requireDependency("fastify");
const createRouter = requireDependency("find-my-way");
const { z } = requireDependency("zod");
const { SourceMapConsumer } = requireDependency("source-map-js");
const uri = requireDependency("fast-uri");

// https://github.com/fastify/fastify/commit/f02d8d4ab1ab208f10819c4dc213595b06497833
for (const collision of ["value", "error"]) {
  test(`async validation preserves a body containing ${collision}`, async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    app.post("/checked", {
      schema: {
        body: {
          $async: true,
          type: "object",
          required: ["checked"],
          additionalProperties: true,
          properties: { checked: { type: "string" } },
        },
      },
    }, async (request) => request.body);
    const control = await app.inject({ method: "POST", url: "/checked", payload: { checked: "valid" } });
    assert.equal(control.statusCode, 200);
    assert.deepEqual(control.json(), { checked: "valid" });
    const payload = { checked: "valid", [collision]: collision === "value" ? { checked: "different" } : "payload data" };
    const response = await app.inject({ method: "POST", url: "/checked", payload });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), payload);
  });
}

// https://github.com/fastify/fastify/commit/7de6e81697778f9f41bd327a3b1c5c9a0d9637b4
for (const part of ["body", "querystring", "query", "params", "headers"]) {
  test(`a false ${part} schema rejects before the handler`, async (t) => {
    const app = Fastify({ exposeHeadRoutes: false });
    t.after(() => app.close());
    let executions = 0;
    const method = part === "querystring" || part === "query" ? "GET" : "POST";
    const route = part === "params" ? "/denied/:id" : "/denied";
    app.route({
      method,
      url: route,
      schema: { [part]: false },
      handler: async () => { executions += 1; return { protectedAction: true }; },
    });
    app.get("/control", async () => ({ ok: true }));
    assert.deepEqual((await app.inject("/control")).json(), { ok: true });
    const response = await app.inject({
      method,
      url: part === "params" ? "/denied/1" : "/denied?x=1",
      ...(part === "body" ? { payload: {} } : {}),
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "FST_ERR_VALIDATION");
    assert.equal(executions, 0);
  });
}

// https://github.com/fastify/fastify/commit/179619c8e99d54924309b9933402151ef9af37e0
for (const form of ["canonical", "lowercase", "nested"]) {
  test(`header dependencies remain enforced in ${form} schemas`, async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    const trigger = form === "lowercase" ? "x-admin" : "X-Admin";
    const token = form === "lowercase" ? "x-admin-token" : "X-Admin-Token";
    const constraints = {
      properties: {
        [trigger]: { type: "string", const: "true" },
        [token]: { type: "string", const: "synthetic-token" },
      },
      dependencies: { [trigger]: [token] },
    };
    const headers = form === "nested"
      ? { type: "object", allOf: [constraints] }
      : { type: "object", ...constraints };
    const original = JSON.stringify(headers);
    let executions = 0;
    app.get("/protected", { schema: { headers } }, async () => {
      executions += 1;
      return { ok: true };
    });
    for (const supplied of [{ "X-Admin": "true" }, { "X-Admin": "true", "X-Admin-Token": "wrong" }]) {
      const denied = await app.inject({ method: "GET", url: "/protected", headers: supplied });
      assert.equal(denied.statusCode, 400);
      assert.equal(denied.json().code, "FST_ERR_VALIDATION");
    }
    assert.equal(executions, 0);
    const allowed = await app.inject({ method: "GET", url: "/protected", headers: {
      "X-Admin": "true", "X-Admin-Token": "synthetic-token",
    } });
    assert.equal(allowed.statusCode, 200);
    assert.deepEqual(allowed.json(), { ok: true });
    assert.equal(executions, 1);
    assert.equal(JSON.stringify(headers), original);
  });
}

// https://github.com/fastify/fastify/commit/93c239a380f3f2778bb7565fcdf777e91cfe1fbc
test("malformed paths cannot enter a sibling protected not-found handler", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const calls = { publicMissing: 0, privateGuard: 0, privateMissing: 0 };
  app.register(async (instance) => {
    instance.get("/present", async () => "public control");
    instance.setNotFoundHandler((_request, reply) => {
      calls.publicMissing += 1;
      return reply.code(404).send("public missing");
    });
  }, { prefix: "/public" });
  app.register(async (instance) => {
    instance.setNotFoundHandler({
      preHandler: (request, reply, done) => {
        calls.privateGuard += 1;
        if (request.headers.authorization !== "Bearer synthetic-token") reply.code(401).send("denied");
        done();
      },
    }, (_request, reply) => {
      calls.privateMissing += 1;
      return reply.send("private control");
    });
  }, { prefix: "/private" });
  const publicControl = await app.inject("/public/present");
  assert.equal(publicControl.statusCode, 200);
  assert.equal(publicControl.body, "public control");
  assert.equal((await app.inject({ method: "DELETE", url: "/private/missing" })).statusCode, 401);
  const authorized = await app.inject({ method: "DELETE", url: "/private/missing", headers: {
    authorization: "Bearer synthetic-token",
  } });
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.body, "private control");
  assert.deepEqual(calls, { publicMissing: 0, privateGuard: 2, privateMissing: 1 });
  const before = { ...calls };
  for (const path of ["/public/%c0", "/public/%world"]) {
    const malformed = await app.inject({ method: "DELETE", url: path });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json().code, "FST_ERR_BAD_URL");
    assert.deepEqual(calls, before);
  }
});

for (const method of ["constructor", "toString", "__proto__"]) {
  test(`router method ${method} does not resolve an Object prototype member`, () => {
    const router = createRouter();
    const handler = () => {};
    router.on("GET", "/normal", handler);
    assert.equal(router.find("GET", "/normal").handler, handler);
    assert.equal(router.find(method, "/normal"), null);
    assert.equal(router.find("GET", "/absent"), null);
  });
}

// https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd
for (const bound of ["max", "length"]) {
  test(`Zod ${bound} rejects excess array input before parsing its elements`, () => {
    let parsed = 0;
    const element = z.preprocess((value) => { parsed += 1; return value; }, z.string());
    const schema = z.array(element)[bound](2);
    assert.deepEqual(schema.parse(["one", "two"]), ["one", "two"]);
    parsed = 0;
    const oversized = schema.safeParse(Array(1000).fill(1));
    assert.equal(oversized.success, false);
    assert.equal(oversized.error.issues.length, 1);
    assert.equal(oversized.error.issues[0].code, "too_big");
    assert.deepEqual(oversized.error.issues[0].path, []);
    assert.equal(parsed, 0);
    const invalidElement = schema.safeParse([1, "valid"]);
    assert.equal(invalidElement.success, false);
    assert.equal(invalidElement.error.issues.length, 1);
    assert.equal(invalidElement.error.issues[0].code, "invalid_type");
    assert.deepEqual(invalidElement.error.issues[0].path, [0]);
  });
}

// https://github.com/7rulnik/source-map-js/commit/cf7658058ceeaa8619d5ae0ec90be6905209d016
const flatMap = () => ({ version: 3, sources: ["input.js"], names: [], mappings: "AAAA" });
const indexedMap = (offset, map = flatMap()) => ({ version: 3, sections: [{ offset, map }] });

for (const field of ["line", "column"]) {
  test(`source-map section ${field} rejects non-integer and non-numeric offsets`, () => {
    for (const value of [-1, 1.5, "1", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const offset = { line: 0, column: 0, [field]: value };
      assert.throws(() => new SourceMapConsumer(indexedMap(offset)), Error, `${field}=${String(value)}`);
    }
  });
}

test("source-map rejects huge and accumulated offsets without serializing them", () => {
  assert.throws(() => new SourceMapConsumer(indexedMap({ line: 10_000_001, column: 0 })), /must not exceed/);
  const nested = indexedMap({ line: 5_000_000, column: 0 }, indexedMap({ line: 5_000_000, column: 0 },
    indexedMap({ line: 5_000_000, column: 0 })));
  assert.throws(() => new SourceMapConsumer(nested), /including offsets of nested sections/);
});

test("source-map preserves ordinary indexed mappings", () => {
  const consumer = new SourceMapConsumer(indexedMap({ line: 1, column: 0 }));
  assert.deepEqual(consumer.originalPositionFor({ line: 2, column: 1 }), {
    source: "input.js", line: 1, column: 0, name: null,
  });
  assert.deepEqual(consumer.sources, ["input.js"]);
});

// https://github.com/fastify/fast-uri/security/advisories/GHSA-qw65-cvwx-89v3
for (const port of ["@127.0.0.1:8124", "?#"]) {
  for (const operation of ["serialize", "normalize", "equal"]) {
    test(`fast-uri ${operation} rejects authority delimiters in port ${JSON.stringify(port)}`, () => {
      const components = { scheme: "https", host: "trusted.example", path: "/app", port };
      if (operation === "equal") {
        assert.equal(uri.equal(components, components), false);
        assert.equal(uri.equal(components, "https://127.0.0.1:8124/app"), false);
      } else {
        assert.throws(() => uri[operation](components), { name: "TypeError", message: "URI port is malformed." });
      }
    });
  }
}

test("fast-uri keeps an ordinary HTTPS authority and numeric port", () => {
  const components = { scheme: "https", host: "trusted.example", path: "/app", port: 8080 };
  const serialized = "https://trusted.example:8080/app";
  assert.equal(uri.serialize(components), serialized);
  const normalized = uri.normalize(components);
  assert.equal(normalized.host, "trusted.example");
  assert.equal(normalized.port, 8080);
  assert.equal(normalized.path, "/app");
  assert.equal(uri.equal(components, serialized), true);
});
