export const AUTH_ACTION_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = 15000;

/** Bound the whole operation, including SDK locks and response parsing. */
export function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

/** Abort stalled requests too, so retries do not leave network work running. */
export function createTimedFetch(fetcher: typeof fetch = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const source = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort(source?.reason);
    if (source?.aborted) abort();
    else source?.addEventListener("abort", abort, { once: true });
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // File uploads can legitimately take longer than login and database queries.
    const timeout = /\/storage\/v1\/object\//.test(url) ? Math.max(timeoutMs, 60000) : timeoutMs;
    const timer = setTimeout(() => controller.abort(new Error("De verbinding reageert niet. Controleer je internetverbinding en probeer opnieuw.")), timeout);
    try {
      const response = await fetcher(input, { ...init, signal: controller.signal });
      if (!response.body) return response;
      // Supabase consumes JSON or blobs; include body download in the deadline.
      // A server sending headers and then stalling must not freeze a loader.
      const body = await withTimeout(response.arrayBuffer(), timeout,
        "De verbinding reageert niet. Controleer je internetverbinding en probeer opnieuw.");
      const buffered = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperties(buffered, {
        url: { value: response.url },
        redirected: { value: response.redirected },
        type: { value: response.type }
      });
      return buffered;
    } finally {
      clearTimeout(timer);
      source?.removeEventListener("abort", abort);
    }
  };
}

type AuthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Private browsing can expose Storage while refusing its methods. */
export function createSafeAuthStorage(resolveStorage: () => AuthStorage | null): AuthStorage {
  const memory = new Map<string, string>();
  let useMemory = false;
  return {
    getItem(key) {
      if (!useMemory) {
        try {
          const storage = resolveStorage();
          return storage ? storage.getItem(key) : memory.get(key) ?? null;
        }
        catch { useMemory = true; }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      if (!useMemory) {
        try { resolveStorage()?.setItem(key, value); }
        catch { useMemory = true; }
      }
    },
    removeItem(key) {
      memory.delete(key);
      // Always attempt removal, even after an earlier failed write.
      try { resolveStorage()?.removeItem(key); }
      catch { useMemory = true; }
    }
  };
}
