import type {
  AdminChatProviderProfile,
  AdminProviderConfigKind,
  AdminProviderConfigRecord,
  AdminProviderConfigTestResult,
} from "@unfreq/contracts/admin";
import { ActionButton, AdminField } from "./admin-controls";
import {
  createEmptyProviderDraft,
  getProviderDraftKey,
  type ProviderConfigDraft,
} from "./provider-config-workflow";

const capabilityLabels: Record<"configured" | "degraded" | "disabled", string> = {
  configured: "可用",
  degraded: "降级",
  disabled: "关闭",
};

export const providerKindLabels: Record<AdminProviderConfigKind, string> = {
  chat: "Chat",
  embedding: "Embedding",
  reranker: "Reranker",
  tts: "TTS",
};

const providerSourceLabels: Record<AdminProviderConfigRecord["source"], string> = {
  database: "后台配置",
  environment: "环境变量",
};

const providerKinds: AdminProviderConfigKind[] = ["chat", "embedding", "reranker", "tts"];

const chatProviderProfileLabels: Record<AdminChatProviderProfile, string> = {
  default: "好模型",
  fast: "快模型",
};

export function ProviderConfigSection({
  addProviderConfig,
  createProviderConfig,
  deleteProviderConfig,
  pendingKey,
  providerConfigs,
  providerDrafts,
  providerTestResults,
  saveProviderConfig,
  testProviderConfig,
  updateProviderDraft,
}: {
  addProviderConfig: (kind: AdminProviderConfigKind) => Promise<void>;
  createProviderConfig: (kind: AdminProviderConfigKind) => void;
  deleteProviderConfig: (config: AdminProviderConfigRecord) => void;
  pendingKey?: string;
  providerConfigs: AdminProviderConfigRecord[];
  providerDrafts: Record<string, ProviderConfigDraft>;
  providerTestResults: Record<string, AdminProviderConfigTestResult>;
  saveProviderConfig: (config: AdminProviderConfigRecord) => Promise<void>;
  testProviderConfig: (kind: AdminProviderConfigKind, draftKey: string, config?: AdminProviderConfigRecord) => Promise<void>;
  updateProviderDraft: (draftKey: string, patch: Partial<ProviderConfigDraft>) => void;
}) {
  return (
    <div className="grid gap-5">
      {providerKinds.map((kind) => {
        const configs = providerConfigs.filter((config) => config.kind === kind);
        const newDraftKey = `new:${kind}`;
        const newDraft = providerDrafts[newDraftKey];

        return (
          <div className="grid gap-3" key={kind}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--radio-dim)]">
                  {providerKindLabels[kind]}
                </p>
                <p className="mt-1 text-sm text-[color:var(--radio-muted)]">
                  {configs.filter((config) => config.source === "database").length} 个后台备份
                </p>
              </div>
              <ActionButton
                disabled={pendingKey !== undefined}
                isPending={false}
                label="添加备份"
                onClick={() => createProviderConfig(kind)}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {configs.map((config) => (
                <ProviderConfigCard
                  config={config}
                  deleteProviderConfig={deleteProviderConfig}
                  draft={providerDrafts[getProviderDraftKey(config)] ?? createEmptyProviderDraft(config.kind)}
                  key={getProviderDraftKey(config)}
                  pendingKey={pendingKey}
                  saveProviderConfig={saveProviderConfig}
                  testProviderConfig={testProviderConfig}
                  testResult={providerTestResults[getProviderDraftKey(config)]}
                  updateProviderDraft={updateProviderDraft}
                />
              ))}

              {newDraft !== undefined ? (
                <ProviderConfigCard
                  addProviderConfig={addProviderConfig}
                  draft={newDraft}
                  kind={kind}
                  pendingKey={pendingKey}
                  testProviderConfig={testProviderConfig}
                  testResult={providerTestResults[`new:${kind}`]}
                  updateProviderDraft={updateProviderDraft}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProviderConfigCard({
  addProviderConfig,
  config,
  deleteProviderConfig,
  draft,
  kind,
  pendingKey,
  saveProviderConfig,
  testProviderConfig,
  testResult,
  updateProviderDraft,
}: {
  addProviderConfig?: (kind: AdminProviderConfigKind) => Promise<void>;
  config?: AdminProviderConfigRecord;
  deleteProviderConfig?: (config: AdminProviderConfigRecord) => void;
  draft: ProviderConfigDraft;
  kind?: AdminProviderConfigKind;
  pendingKey?: string;
  saveProviderConfig?: (config: AdminProviderConfigRecord) => Promise<void>;
  testProviderConfig: (kind: AdminProviderConfigKind, draftKey: string, config?: AdminProviderConfigRecord) => Promise<void>;
  testResult?: AdminProviderConfigTestResult;
  updateProviderDraft: (draftKey: string, patch: Partial<ProviderConfigDraft>) => void;
}) {
  const resolvedKind = config?.kind ?? kind;

  if (resolvedKind === undefined) {
    return null;
  }

  const draftKey = config === undefined ? `new:${resolvedKind}` : getProviderDraftKey(config);
  const isNew = config === undefined;
  const isEnvironment = config?.source === "environment";
  const saveKey = isNew ? `provider:${draftKey}:add` : `provider:${draftKey}:save`;
  const testKey = `provider:${draftKey}:test`;

  return (
    <div className="radio-surface grid gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--radio-dim)]">
            {isNew ? "NEW BACKUP" : `${providerSourceLabels[config.source]} · P${config.priority}`}
          </p>
          <p className="mt-2 text-sm text-[color:var(--radio-muted)]">
            {isNew
              ? "新增后台备份"
              : `${capabilityLabels[config.status]} · Key ${
                  config.keyState === "configured" ? `****${config.apiKeyLast4 ?? ""}` : "未配置"
                }`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isNew ? (
            <ActionButton
              disabled={pendingKey !== undefined}
              isPending={pendingKey === saveKey}
              label="添加"
              onClick={() => {
                void addProviderConfig?.(resolvedKind);
              }}
            />
          ) : (
            <ActionButton
              disabled={pendingKey !== undefined}
              isPending={pendingKey === saveKey}
              label={isEnvironment ? "保存为后台配置" : "保存"}
              onClick={() => {
                void saveProviderConfig?.(config);
              }}
            />
          )}
          <ActionButton
            disabled={pendingKey !== undefined}
            isPending={pendingKey === testKey}
            label="检测"
            onClick={() => {
              void testProviderConfig(resolvedKind, draftKey, config);
            }}
          />
          {!isNew && !isEnvironment ? (
            <ActionButton
              tone="danger"
              disabled={pendingKey !== undefined}
              isPending={pendingKey === `provider:${config.id}:delete`}
              label="删除备份"
              onClick={() => deleteProviderConfig?.(config)}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField
          label="Provider"
          onChange={(value) => updateProviderDraft(draftKey, { provider: value })}
          value={draft.provider}
        />
        <AdminField
          label="Model"
          onChange={(value) => updateProviderDraft(draftKey, { model: value })}
          value={draft.model}
        />
        <AdminField
          label="Priority"
          onChange={(value) => updateProviderDraft(draftKey, { priority: value })}
          value={draft.priority}
        />
        {resolvedKind === "chat" ? (
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--radio-dim)]">
              Chat Profile
            </span>
            <select
              className="radio-field min-h-11"
              onChange={(event) =>
                updateProviderDraft(draftKey, {
                  chatProfile: event.target.value as AdminChatProviderProfile,
                })
              }
              value={draft.chatProfile}
            >
              {(["default", "fast"] as const).map((profile) => (
                <option key={profile} value={profile}>
                  {chatProviderProfileLabels[profile]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="inline-flex min-h-10 items-center gap-2 self-end text-sm text-[color:var(--radio-muted)]">
          <input
            checked={draft.isEnabled}
            className="h-4 w-4 accent-white"
            onChange={(event) =>
              updateProviderDraft(draftKey, {
                isEnabled: event.target.checked,
              })
            }
            type="checkbox"
          />
          启用
        </label>
        <AdminField
          className="sm:col-span-2"
          label="Base URL"
          onChange={(value) => updateProviderDraft(draftKey, { baseUrl: value })}
          value={draft.baseUrl}
        />
        <AdminField
          className="sm:col-span-2"
          label="New API Key"
          onChange={(value) =>
            updateProviderDraft(draftKey, {
              apiKey: value,
              clearApiKey: value.trim().length > 0 ? false : draft.clearApiKey,
            })
          }
          type="password"
          value={draft.apiKey}
        />

        {resolvedKind === "embedding" ? (
          <>
            <AdminField
              label="Dimensions"
              onChange={(value) => updateProviderDraft(draftKey, { dimensions: value })}
              value={draft.dimensions}
            />
            <AdminField
              label="Version"
              onChange={(value) => updateProviderDraft(draftKey, { version: value })}
              value={draft.version}
            />
          </>
        ) : null}

        {resolvedKind === "tts" ? (
          <>
            <AdminField
              label="左声线"
              onChange={(value) => updateProviderDraft(draftKey, { voiceLeft: value })}
              value={draft.voiceLeft}
            />
            <AdminField
              label="右声线"
              onChange={(value) => updateProviderDraft(draftKey, { voiceRight: value })}
              value={draft.voiceRight}
            />
          </>
        ) : null}
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-[color:var(--radio-muted)]">
        <input
          checked={draft.clearApiKey}
          className="h-4 w-4 accent-white"
          disabled={draft.apiKey.trim().length > 0}
          onChange={(event) =>
            updateProviderDraft(draftKey, {
              clearApiKey: event.target.checked,
            })
          }
          type="checkbox"
        />
        清空已保存 Key
      </label>

      {testResult !== undefined ? (
        <div
          className="grid gap-1 border border-white/10 bg-black/20 p-3 text-xs text-[color:var(--radio-muted)]"
          role={testResult.status === "failed" ? "alert" : "status"}
        >
          <p className="font-mono uppercase tracking-[0.14em] text-[color:var(--radio-text)]">
            {testResult.status === "passed"
              ? "检测通过"
              : testResult.status === "unsupported"
                ? "暂不支持"
                : "检测失败"}{" "}
            · {testResult.reason}
          </p>
          <p>{testResult.detail}</p>
          {testResult.checkedUrl !== undefined ? (
            <p className="break-all font-mono text-[color:var(--radio-dim)]">
              {testResult.checkedUrl}
            </p>
          ) : null}
          <p className="font-mono text-[color:var(--radio-dim)]">
            {testResult.provider} / {testResult.model} / {testResult.durationMs}ms
          </p>
        </div>
      ) : null}
    </div>
  );
}
