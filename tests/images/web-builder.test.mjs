import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOwnedWebBuilder } from "../../scripts/web-image-builder.mjs";

const runId = "1234567890abcdef12345678";
const endpoint = "unix:///var/run/docker.sock";
const name = `unfreq-web-${runId}`;
const containerName = `buildx_buildkit_${name}0`;
const volumeName = `${containerName}_state`;
const containerId = "b".repeat(64);
const imageId = `sha256:${"c".repeat(64)}`;
const imageReference = `moby/buildkit:buildx-stable-1@sha256:${"a".repeat(64)}`;

async function harness(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "unfreq-web-builder-test-"));
  const calls = [];
  const state = { container: undefined, volume: undefined, unavailable: false, volumeInspectCalls: 0 };
  const result = (value) => ({ stdout: typeof value === "string" ? value : JSON.stringify(value), stderr: "" });
  const container = () => ({ Id: containerId, Name: `/${containerName}`, Config: { Image: imageReference }, Image: imageId,
    HostConfig: { Privileged: true, Memory: 2 * 1024 ** 3, MemorySwap: 3 * 1024 ** 3, RestartPolicy: { Name: "no", MaximumRetryCount: 0 } },
    Mounts: [{ Type: "volume", Name: volumeName, Destination: "/var/lib/buildkit", RW: true }], State: { Running: true } });
  const docker = async (args, invocationOptions) => {
    calls.push({ args, options: invocationOptions });
    if (state.unavailable) throw new Error("Synthetic Engine unavailable");
    assert.equal(invocationOptions.childEnv.BUILDX_CONFIG, path.join(directory, "buildx-config"));
    assert.equal(invocationOptions.childEnv.DOCKER_CONTEXT, undefined);
    assert.equal(invocationOptions.childEnv.DOCKER_HOST, undefined);
    assert.equal(invocationOptions.childEnv.BUILDX_BUILDER, undefined);
    if (args[0] === "buildx" && args[1] === "ls") return result(options.builderCollision ? JSON.stringify({ Name: name }) : "");
    if (args[0] === "buildx" && args[1] === "imagetools") return result({ digest: `sha256:${"a".repeat(64)}`, mediaType: "application/vnd.oci.image.index.v1+json" });
    if (args[0] === "buildx" && args[1] === "create") {
      if (options.createFailure) throw new Error("Synthetic create failure");
      return result(name);
    }
    if (args[0] === "buildx" && args[1] === "inspect") {
      if (!options.bootstrapBeforeContainerFailure) state.container = container();
      if (options.bootstrapFailure || options.bootstrapBeforeContainerFailure) throw new Error("Synthetic bootstrap failure");
      return result("Synthetic builder ready");
    }
    if (args[0] === "buildx" && args[1] === "build") return result("Synthetic build complete");
    if (args[0] === "buildx" && args[1] === "rm") {
      assert.ok(args.includes("--keep-daemon"));
      assert.ok(args.includes("--keep-state"));
      return result(name);
    }
    if (args[0] === "container" && args[1] === "ls") {
      if (args.at(-1) === `volume=${volumeName}`) return result(state.container || options.foreignVolumeUser ? containerId : "");
      assert.equal(args.at(-1), `name=^/${containerName}$`);
      return result(state.container || options.containerCollision ? containerId : "");
    }
    if (args[0] === "container" && args[1] === "inspect") {
      assert.ok(state.container, "A nonexistent container must not be adopted");
      assert.ok([containerId, containerName].includes(args[2]));
      return result([state.container]);
    }
    if (args[0] === "image" && args[1] === "inspect") {
      assert.equal(args[2], imageReference);
      return result([{ Id: imageId, Os: "linux", Architecture: "amd64" }]);
    }
    if (args[0] === "stop") {
      assert.deepEqual(args, ["stop", "--time", "15", containerId]);
      state.container.State.Running = false;
      return result(containerId);
    }
    if (args[0] === "container" && args[1] === "rm") {
      assert.equal(args[2], containerId);
      assert.equal(state.container.State.Running, false);
      state.container = undefined;
      return result(containerId);
    }
    if (args[0] === "volume" && args[1] === "ls") {
      assert.equal(args.at(-1), `name=^${volumeName}$`);
      return result(state.volume || options.volumeCollision ? volumeName : "");
    }
    if (args[0] === "volume" && args[1] === "create") {
      state.volume = { Name: volumeName, Driver: "local", Scope: "local", Mountpoint: `/var/lib/docker/volumes/${volumeName}/_data`,
        CreatedAt: "2026-11-01T00:00:00Z", Labels: { "com.unfreq.web-image-builder.run": options.volumeRace ? "someone-else" : runId }, Options: null };
      if (options.volumeCreateResponseLost) throw new Error("Synthetic volume create response lost after creation");
      return result(volumeName);
    }
    if (args[0] === "volume" && args[1] === "inspect") {
      assert.equal(args[2], volumeName);
      assert.ok(state.volume);
      state.volumeInspectCalls += 1;
      if (options.volumeInspectFailureOnce && state.volumeInspectCalls === 1) throw new Error("Synthetic first volume inspect failure");
      return result([state.volume]);
    }
    if (args[0] === "volume" && args[1] === "rm") {
      assert.equal(args[2], volumeName);
      assert.equal(state.container, undefined);
      assert.equal(options.foreignVolumeUser, undefined);
      state.volume = undefined;
      return result(volumeName);
    }
    throw new Error(`Unexpected synthetic Docker protocol: ${args.join(" ")}`);
  };
  const record = {};
  const builder = createOwnedWebBuilder({ docker, directory, runId, endpoint, record,
    env: { PATH: "synthetic", DOCKER_CONTEXT: "remote-context", DOCKER_HOST: "tcp://remote.invalid", BUILDX_CONFIG: "old-config", BUILDX_BUILDER: "old-builder" } });
  return { directory, calls, state, record, builder, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test("the owned builder pins its image, endpoint, limits and independent config without changing selection", async () => {
  const h = await harness();
  try {
    assert.equal(h.calls.length, 0, "Factory creation must allow cleanup before startup");
    await h.builder.start();
    const create = h.calls.find(({ args }) => args[0] === "buildx" && args[1] === "create").args;
    assert.equal(create.at(-1), endpoint);
    assert.ok(create.includes(`image=${imageReference}`));
    for (const option of ["memory=2147483648", "memory-swap=3221225472", "restart-policy=no"]) assert.ok(create.includes(option));
    assert.ok(!create.includes("--use"));
    assert.equal(await readFile(h.record.configPath, "utf8"), "[worker.oci]\n  max-parallelism = 1\n");
    assert.equal(h.record.container.id, containerId);
    assert.equal(h.record.container.imageId, imageId);
    assert.equal(h.record.container.privileged, true);
    assert.equal(h.record.container.mounts[0].Name, volumeName);
    assert.equal(h.record.ready, true);
    await h.builder.build(["--target", "runner", "--load", "/synthetic/context"], { timeoutMs: 1234 });
    const build = h.calls.at(-1);
    assert.deepEqual(build.args, ["buildx", "build", "--builder", name, "--target", "runner", "--load", "/synthetic/context"]);
    assert.equal(build.options.timeoutMs, 1234);
    await assert.rejects(h.builder.build(["--builder=another-builder"]), /Caller-selected builders/);
    assert.equal(await h.builder.cleanup(), true);
    assert.equal(h.state.container, undefined);
    assert.equal(h.state.volume, undefined);
    const metadataRemovals = h.calls.filter(({ args }) => args[0] === "buildx" && args[1] === "rm").length;
    assert.equal(await h.builder.cleanup(), true, "Successful cleanup must remain safe to repeat");
    assert.equal(h.calls.filter(({ args }) => args[0] === "buildx" && args[1] === "rm").length, metadataRemovals);
    assert.ok(!h.calls.some(({ args }) => args.includes("prune")));
  } finally { await h.dispose(); }
});

test("pre-existing builder, container or volume names are never adopted or removed", async (t) => {
  for (const option of ["builderCollision", "containerCollision", "volumeCollision"]) await t.test(option, async () => {
    const h = await harness({ [option]: true });
    try {
      await assert.rejects(h.builder.start(), /already exists/);
      assert.equal(await h.builder.cleanup(), true);
      assert.ok(!h.calls.some(({ args }) => ["create", "rm", "stop"].includes(args[1]) || args[0] === "stop"));
    } finally { await h.dispose(); }
  });
});

test("failed startup still cleans its verified state volume and any bootstrapped container", async (t) => {
  for (const option of ["createFailure", "bootstrapBeforeContainerFailure", "bootstrapFailure"]) await t.test(option, async () => {
    const h = await harness({ [option]: true });
    try {
      await assert.rejects(h.builder.start(), /Synthetic/);
      assert.equal(await h.builder.cleanup(), true);
      assert.equal(h.state.container, undefined);
      assert.equal(h.state.volume, undefined);
    } finally { await h.dispose(); }
  });
});

test("a state volume raced by another owner is preserved after startup refusal", async () => {
  const h = await harness({ volumeRace: true });
  try {
    await assert.rejects(h.builder.start(), /existing or raced/);
    assert.equal(await h.builder.cleanup(), false);
    assert.ok(h.state.volume);
    assert.ok(!h.calls.some(({ args }) => args[1] === "rm"));
  } finally { await h.dispose(); }
});

test("cleanup recovers its labelled volume after a lost creation receipt or first inspection failure", async (t) => {
  for (const option of ["volumeCreateResponseLost", "volumeInspectFailureOnce"]) await t.test(option, async () => {
    const h = await harness({ [option]: true });
    try {
      await assert.rejects(h.builder.start(), /Synthetic/);
      assert.ok(h.state.volume, "Docker side effect must actually have occurred before the failure");
      assert.equal(h.record.volume, undefined, "Startup did not establish ownership before its failure");
      assert.equal(await h.builder.cleanup(), true);
      assert.equal(h.state.volume, undefined);
      assert.equal(h.record.recoveredOwnership.volume.name, volumeName);
      assert.match(h.record.recoveredOwnership.volume.identitySha256, /^[a-f0-9]{64}$/);
      assert.ok(!h.calls.some(({ args }) => args[0] === "buildx" && args[1] === "create"),
        "The interrupted volume phase must not have created a builder");
    } finally { await h.dispose(); }
  });
});

test("lost creation receipts never authorize recovery of an unknown volume label, driver or scope", async (t) => {
  const changes = [
    (value) => { value.Labels["com.unfreq.web-image-builder.run"] = "someone-else"; },
    (value) => { value.Driver = "foreign-driver"; },
    (value) => { value.Scope = "global"; },
    (value) => { value.Name = "some-other-volume"; },
  ];
  for (const [index, change] of changes.entries()) await t.test(`unproved volume ${index + 1}`, async () => {
    const h = await harness({ volumeCreateResponseLost: true });
    try {
      await assert.rejects(h.builder.start(), /Synthetic/);
      change(h.state.volume);
      assert.equal(await h.builder.cleanup(), false);
      assert.ok(h.state.volume);
      assert.equal(h.record.recoveredOwnership, undefined);
      assert.ok(!h.calls.some(({ args }) => args[0] === "volume" && args[1] === "rm"));
    } finally { await h.dispose(); }
  });
});

test("container identity, image, privilege, limits and extra-mount drift prevent destructive cleanup", async (t) => {
  const changes = [
    (value) => { value.Id = "d".repeat(64); },
    (value) => { value.Config.Image = "some-other-image"; },
    (value) => { value.Image = `sha256:${"d".repeat(64)}`; },
    (value) => { value.HostConfig.Privileged = false; },
    (value) => { value.HostConfig.Memory += 1; },
    (value) => { value.HostConfig.MemorySwap += 1; },
    (value) => { value.HostConfig.RestartPolicy.Name = "always"; },
    (value) => { value.Mounts.push({ Type: "bind", Source: "/someone-elses-data", Destination: "/data" }); },
  ];
  for (const [index, change] of changes.entries()) await t.test(`ownership drift ${index + 1}`, async () => {
    const h = await harness();
    try {
      await h.builder.start();
      change(h.state.container);
      assert.equal(await h.builder.cleanup(), false);
      assert.ok(h.state.container);
      assert.ok(h.state.volume);
      assert.ok(!h.calls.some(({ args }) => args[0] === "stop" || args[0] === "container" && args[1] === "rm" || args[0] === "volume" && args[1] === "rm"));
    } finally { await h.dispose(); }
  });
});

test("volume replacement and another container's volume use prevent volume deletion", async (t) => {
  await t.test("replacement", async () => {
    const h = await harness();
    try {
      await h.builder.start();
      h.state.volume.CreatedAt = "2026-11-02T00:00:00Z";
      assert.equal(await h.builder.cleanup(), false);
      assert.ok(h.state.volume);
      assert.ok(!h.calls.some(({ args }) => args[0] === "volume" && args[1] === "rm"));
    } finally { await h.dispose(); }
  });
  await t.test("other consumer", async () => {
    const h = await harness({ foreignVolumeUser: true });
    try {
      await h.builder.start();
      assert.equal(await h.builder.cleanup(), false);
      assert.equal(h.state.container, undefined);
      assert.ok(h.state.volume);
    } finally { await h.dispose(); }
  });
});

test("cleanup reports Engine failure without throwing and leaves a retryable ownership record", async () => {
  const h = await harness();
  try {
    await h.builder.start();
    h.state.unavailable = true;
    assert.equal(await h.builder.cleanup(), false);
    assert.ok(h.record.cleanupFailures.length > 0);
    h.state.unavailable = false;
    assert.equal(await h.builder.cleanup(), true);
  } finally { await h.dispose(); }
});

test("an unstarted handle needs no Docker and unsafe endpoint or run names are refused", async () => {
  const h = await harness();
  try {
    assert.equal(await h.builder.cleanup(), true);
    assert.equal(h.calls.length, 0);
    assert.throws(() => createOwnedWebBuilder({ docker() {}, directory: h.directory, runId, endpoint: "tcp://remote.invalid:2375" }), /fixed local/);
    assert.throws(() => createOwnedWebBuilder({ docker() {}, directory: h.directory, runId: "existing-builder", endpoint }), /match/);
  } finally { await h.dispose(); }
});
