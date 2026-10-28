export const runtimeEntryRelative: string;
export const runtimeArtifactPaths: readonly string[];
export const runtimeEntryRelatives: Readonly<{ generation: string; abuse: string }>;
export const runtimeSourcePaths: readonly string[];
export type IntegrationRuntime = {
  runId: string;
  runDirectory: string;
  runtimeDirectory: string;
  ownershipToken: string;
  entryPath: string;
  entrySha256: string;
};
export function prepareIntegrationRuntime(options: {
  repositoryRoot: string;
  runDirectory: string;
  runId: string;
  compile: (runtimeDirectory: string) => Promise<unknown>;
}): Promise<IntegrationRuntime>;
export function verifyIntegrationRuntime(options: {
  repositoryRoot?: string;
  runId: string;
  runtimeDirectory: string;
  ownershipToken: string;
  executingEntry?: string;
  entry?: "generation" | "abuse";
}): Promise<IntegrationRuntime>;
