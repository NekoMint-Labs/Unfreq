import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const imageName = "moby/buildkit:buildx-stable-1";
const ownerLabel = "com.unfreq.web-image-builder.run";
const memory = 2 * 1024 ** 3;
const memorySwap = 3 * 1024 ** 3;
const configText = "[worker.oci]\n  max-parallelism = 1\n";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const localEndpoint = (value) => /^npipe:\/{4}\.\/pipe\/[a-z0-9_.-]+$/iu.test(value) || /^unix:\/\/\/[^/?#\0][^?#\0]*$/u.test(value);
const lines = (value) => value.trim().split(/\r?\n/).filter(Boolean);

// The Docker callback must already pin every call to the supplied local
// endpoint. This factory does no work until start(), so a failed start still
// leaves a handle whose cleanup() can validate and remove its own resources.
export function createOwnedWebBuilder({ docker, env, directory, runId, endpoint, record = {} }) {
  assert.equal(typeof docker, "function");
  assert.match(runId, /^[a-f0-9]{24}$/);
  assert.ok(localEndpoint(endpoint), "A fixed local Docker endpoint is required");
  assert.ok(path.isAbsolute(directory));
  const name = `unfreq-web-${runId}`;
  const containerName = `buildx_buildkit_${name}0`;
  const volumeName = `${containerName}_state`;
  const configDirectory = path.join(directory, "buildx-config");
  const configPath = path.join(directory, "buildkitd.toml");
  const childEnv = Object.fromEntries(Object.entries(env ?? {}).filter(([key]) =>
    !["DOCKER_HOST", "DOCKER_CONTEXT", "BUILDX_CONFIG", "BUILDX_BUILDER"].includes(key.toUpperCase())));
  childEnv.BUILDX_CONFIG = configDirectory;
  Object.assign(record, { kind: "isolated docker-container", name, containerName, volumeName, endpoint,
    configDirectory, configPath, maxParallelism: 1, memoryBytes: memory, memorySwapBytes: memorySwap,
    restartPolicy: "no", privileged: true, created: false, ready: false, cleanupFailures: [] });
  let startAttempted = false;
  let preflightPassed = false;
  let volumeOwned = false;
  let builderCreated = false;
  let metadataRemoved = false;
  let containerId;
  let containerImageId;
  let volumeFingerprint;
  let resolvedImage;
  const invoke = (args, options = {}) => docker(args, { ...options, childEnv });
  const ids = async (kind) => lines((await invoke(kind === "container"
    ? ["container", "ls", "--all", "--quiet", "--filter", `name=^/${containerName}$`]
    : ["volume", "ls", "--quiet", "--filter", `name=^${volumeName}$`])).stdout);
  const inspect = async (kind, nameOrId) => {
    const values = JSON.parse((await invoke([kind, "inspect", nameOrId])).stdout);
    assert.equal(values.length, 1, "Expected one owned resource");
    return values[0];
  };
  const volumeIdentity = (value) => JSON.stringify({ Name: value.Name, Driver: value.Driver, Scope: value.Scope,
    Mountpoint: value.Mountpoint, CreatedAt: value.CreatedAt, Labels: value.Labels, Options: value.Options });
  async function captureVolumeOwnership(recovered = false) {
    assert.ok(preflightPassed, "State volume absence was not established before creation");
    const value = await inspect("volume", volumeName);
    assert.equal(value.Name, volumeName);
    assert.equal(value.Driver, "local");
    assert.equal(value.Scope, "local");
    assert.equal(value.Labels?.[ownerLabel], runId, "Refusing an existing or raced state volume");
    volumeFingerprint = digest(volumeIdentity(value));
    volumeOwned = true;
    record.volume = { ...value, identitySha256: volumeFingerprint };
    if (recovered) record.recoveredOwnership = { volume: { name: volumeName, identitySha256: volumeFingerprint,
      basis: "Preflight absence, exact random name, run label, local driver and local scope." } };
    return value;
  }
  async function validateVolume() {
    assert.ok(volumeOwned, "State volume ownership was not established");
    const value = await inspect("volume", volumeName);
    assert.equal(value.Name, volumeName);
    assert.equal(value.Driver, "local");
    assert.equal(value.Scope, "local");
    assert.equal(value.Labels?.[ownerLabel], runId, "State volume ownership label changed");
    assert.equal(digest(volumeIdentity(value)), volumeFingerprint, "State volume identity changed");
    return value;
  }
  async function validateContainer() {
    assert.ok(preflightPassed && builderCreated, "Builder creation ownership was not established");
    const value = await inspect("container", containerId ?? containerName);
    assert.match(value.Id, /^[a-f0-9]{64}$/);
    assert.equal(value.Name, `/${containerName}`);
    if (containerId) assert.equal(value.Id, containerId, "Builder container identity changed");
    assert.equal(value.Config.Image, resolvedImage, "Builder image reference changed");
    assert.match(value.Image, /^sha256:[a-f0-9]{64}$/);
    if (containerImageId) assert.equal(value.Image, containerImageId, "Builder image ID changed");
    assert.equal(value.HostConfig.Privileged, true);
    assert.equal(value.HostConfig.Memory, memory);
    assert.equal(value.HostConfig.MemorySwap, memorySwap);
    assert.equal(value.HostConfig.RestartPolicy?.Name, "no");
    assert.equal(value.Mounts.length, 1, "Builder must have one state mount only");
    const mount = value.Mounts[0];
    assert.equal(mount.Type, "volume");
    assert.equal(mount.Name, volumeName);
    assert.equal(mount.Destination, "/var/lib/buildkit");
    assert.equal(mount.RW, true);
    await validateVolume();
    containerId ??= value.Id;
    containerImageId ??= value.Image;
    record.container = { id: value.Id, name: value.Name, imageReference: value.Config.Image, imageId: value.Image,
      privileged: value.HostConfig.Privileged, memoryBytes: value.HostConfig.Memory,
      memorySwapBytes: value.HostConfig.MemorySwap, restartPolicy: value.HostConfig.RestartPolicy,
      mounts: value.Mounts, running: value.State.Running };
    return value;
  }
  async function start() {
    assert.equal(startAttempted, false, "A builder handle can only start once");
    startAttempted = true;
    // Exclusive creation prevents reusing someone else's persistent builder
    // selection or overwriting an earlier run's evidence.
    await mkdir(configDirectory);
    await writeFile(configPath, configText, { flag: "wx" });
    record.configSha256 = digest(configText);
    const builders = lines((await invoke(["buildx", "ls", "--format", "{{json .}}"])).stdout).map((line) => JSON.parse(line));
    assert.ok(!builders.some((value) => value.Name?.replace(/\*$/, "") === name), "Builder name already exists");
    assert.deepEqual(await ids("container"), [], "Builder container name already exists");
    assert.deepEqual(await ids("volume"), [], "Builder state volume name already exists");
    preflightPassed = true;
    record.preflightAbsent = true;
    const descriptor = JSON.parse((await invoke(["buildx", "imagetools", "inspect", imageName,
      "--format", "{{json .Manifest}}"], { timeoutMs: 120_000 })).stdout);
    assert.match(descriptor.digest, /^sha256:[a-f0-9]{64}$/);
    resolvedImage = `${imageName}@${descriptor.digest}`;
    record.image = { reference: resolvedImage, descriptor };
    // Precreate the otherwise implicit state volume with an ownership label.
    // The automatically created Buildx container has no such run label.
    assert.equal((await invoke(["volume", "create", "--label", `${ownerLabel}=${runId}`, volumeName])).stdout.trim(), volumeName);
    await captureVolumeOwnership();
    const created = await invoke(["buildx", "create", "--name", name, "--driver", "docker-container",
      "--driver-opt", `image=${resolvedImage}`, "--driver-opt", `memory=${memory}`,
      "--driver-opt", `memory-swap=${memorySwap}`, "--driver-opt", "restart-policy=no",
      "--buildkitd-config", configPath, endpoint]);
    assert.equal(created.stdout.trim(), name, "Unexpected builder creation response");
    builderCreated = true;
    record.created = true;
    await invoke(["buildx", "inspect", name, "--bootstrap"], { timeoutMs: 300_000 });
    const container = await validateContainer();
    assert.equal(container.State.Running, true, "Builder did not stay running");
    const image = await inspect("image", resolvedImage);
    assert.equal(image.Id, container.Image, "Loaded BuildKit image does not match its container");
    assert.equal(image.Os, "linux");
    assert.equal(image.Architecture, "amd64");
    record.image.id = image.Id;
    record.ready = true;
    return record;
  }
  async function build(args, options = {}) {
    assert.equal(record.ready, true, "Builder is not ready");
    assert.ok(Array.isArray(args));
    assert.ok(!args.some((value) => value === "--builder" || value.startsWith("--builder=") || value === "--use"),
      "Caller-selected builders are refused");
    return invoke(["buildx", "build", "--builder", name, ...args], options);
  }
  async function cleanup() {
    record.cleanupFailures = [];
    const attempt = async (code, action) => {
      try { return await action(); }
      catch (error) { record.cleanupFailures.push({ code, message: error.message }); return undefined; }
    };
    // No Docker resources can be ours before preflight; a collision must never
    // cause cleanup to adopt or delete the pre-existing resource.
    if (!preflightPassed) { record.cleaned = true; return true; }
    // Docker can commit volume creation before a disconnected CLI acknowledges
    // it, or the first inspect can fail. Recover only the explicitly labelled
    // volume whose exact random name was absent during this run's preflight.
    const initialVolumes = await attempt("VOLUME_DISCOVERY_FAILED", () => ids("volume"));
    if (initialVolumes?.length && !volumeOwned) await attempt("VOLUME_OWNERSHIP_RECOVERY_FAILED", () => captureVolumeOwnership(true));
    let ownedContainer;
    const existing = await attempt("CONTAINER_DISCOVERY_FAILED", () => ids("container"));
    if (existing?.length) ownedContainer = await attempt("CONTAINER_OWNERSHIP_FAILED", validateContainer);
    if (builderCreated && !metadataRemoved) await attempt("BUILDER_METADATA_REMOVAL_FAILED", async () => {
      await invoke(["buildx", "rm", "--keep-daemon", "--keep-state", name]);
      metadataRemoved = true;
      record.metadataRemoved = true;
    });
    if (ownedContainer) await attempt("CONTAINER_REMOVAL_FAILED", async () => {
      const current = await validateContainer();
      if (current.State.Running) await invoke(["stop", "--time", "15", current.Id]);
      const stopped = await validateContainer();
      assert.equal(stopped.State.Running, false);
      await invoke(["container", "rm", stopped.Id]);
    });
    const volumes = await attempt("VOLUME_DISCOVERY_FAILED", () => ids("volume"));
    if (volumes?.length) await attempt("VOLUME_REMOVAL_FAILED", async () => {
      await validateVolume();
      const users = lines((await invoke(["container", "ls", "--all", "--quiet", "--filter", `volume=${volumeName}`])).stdout);
      assert.deepEqual(users, [], "Builder state volume is still used by a container");
      await invoke(["volume", "rm", volumeName]);
    });
    await attempt("CLEANUP_READBACK_FAILED", async () => {
      assert.deepEqual(await ids("container"), []);
      assert.deepEqual(await ids("volume"), []);
    });
    record.cleaned = record.cleanupFailures.length === 0;
    record.ready = false;
    return record.cleaned;
  }
  return { start, build, cleanup, record };
}
