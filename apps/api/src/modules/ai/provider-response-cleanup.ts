// Every attempt owns its transport through body consumption or cancellation.
// Abort first so even a body cancellation error cannot retain the HTTP request.
export async function disposeProviderResponse(
  response: Response | undefined,
  controller: AbortController | undefined,
): Promise<void> {
  controller?.abort();
  if (response?.body == null || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // Aborted/errored bodies may reject cancellation. Preserve the original
    // HTTP, parsing or execution error rather than replacing it with cleanup.
  }
}
