import assert from "node:assert/strict";
import { test } from "node:test";
import { createSafeAuthStorage, createTimedFetch, withTimeout } from "../src/lib/auth/client.ts";

test("auth deadline rejects a stalled operation and preserves resolved/rejected results", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10, "login stalled"), /login stalled/);
  assert.equal(await withTimeout(Promise.resolve("session"), 100, "timeout"), "session");
  await assert.rejects(withTimeout(Promise.reject(new Error("invalid credentials")), 100, "timeout"), /invalid credentials/);
});

test("Supabase transport aborts stalled requests and preserves caller cancellation", async () => {
  let signal: AbortSignal | null | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    signal = init?.signal;
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
    });
  };
  const request = createTimedFetch(fetcher, 10);
  await assert.rejects(request("https://example.test/auth/v1/token"), /verbinding/);
  assert.equal(signal?.aborted, true);
  const controller = new AbortController();
  const pending = createTimedFetch(fetcher, 1000)(new Request("https://example.test/rest/v1/profiles", { signal: controller.signal }));
  controller.abort(new Error("screen closed"));
  await assert.rejects(pending, /screen closed/);
});

test("successful Supabase requests release the deadline without aborting the response", async () => {
  let signal: AbortSignal | null | undefined;
  const request = createTimedFetch(async (_input, init) => {
    signal = init?.signal;
    return new Response("ok");
  }, 5);
  assert.equal(await (await request("https://example.test/rest/v1/profiles")).text(), "ok");
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(signal?.aborted, false);
});

test("Supabase transport also times out when headers arrive but the response body stalls", async () => {
  const request = createTimedFetch(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); }
  })), 10);
  await assert.rejects(request("https://example.test/rest/v1/profiles"), /verbinding/);
});

test("blocked browser storage still permits an in-memory login and clears it on logout", () => {
  const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  const storage = createSafeAuthStorage(() => blocked);
  assert.equal(storage.getItem("session"), null);
  storage.setItem("session", "private-token");
  assert.equal(storage.getItem("session"), "private-token");
  storage.removeItem("session");
  assert.equal(storage.getItem("session"), null);
});

test("logout from another tab never restores a stale in-memory session", () => {
  const values = new Map<string, string>();
  const browser = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const storage = createSafeAuthStorage(() => browser);
  storage.setItem("session", "private-token");
  values.delete("session");
  assert.equal(storage.getItem("session"), null);
});

test("quota errors use memory until logout without reviving an older stored session", () => {
  const browser = { getItem: () => "old-session", setItem() { throw new Error("quota"); }, removeItem() {} };
  const storage = createSafeAuthStorage(() => browser);
  storage.setItem("session", "new-session");
  assert.equal(storage.getItem("session"), "new-session");
  storage.removeItem("session");
  assert.equal(storage.getItem("session"), null);
});
