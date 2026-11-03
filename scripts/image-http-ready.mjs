// AbortSignal.timeout() uses an unref'ed timer. A host verifier waiting only
// on fetch can therefore exit with an unsettled top-level await before its
// timeout fires. Keep this deadline referenced, including response predicates.
export async function runWithReferencedTimeout(work, timeoutMs) {
  if (typeof work !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new TypeError("A work function and a bounded positive timeout are required.");
  }
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Owned image HTTP request timed out.");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}
