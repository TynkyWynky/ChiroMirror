/* One APP worker: Push + generic offline navigation only. Never cache private responses. */
const build = typeof APP_BUILD === "string" ? APP_BUILD : "local";
const scopePath = new URL(self.registration.scope).pathname;
const cachePrefix = `chiro-app-static:${scopePath}:`;
const cacheName = cachePrefix + build;
const offlineUrl = new URL("offline.html", self.registration.scope).href;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const receiptDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open("chiro-push-receipts", 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains("receipts")) request.result.createObjectStore("receipts", { keyPath: "id" }).createIndex("time", "time");
    if (!request.result.objectStoreNames.contains("device")) request.result.createObjectStore("device", { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error("RECEIPT_STORAGE"));
});
async function deviceState(next) {
  const db = await receiptDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("device", next ? "readwrite" : "readonly"), store = tx.objectStore("device");
    const request = next ? store.put({ id: "push", ...next }) : store.get("push");
    let result; request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(new Error("DEVICE_STORAGE")); };
  });
}
// Opaque delivery IDs and timestamps only: suppress retries even after a toast was dismissed.
async function reserveReceipt(id) {
  if (!id || !self.indexedDB) return true;
  try {
    const db = await receiptDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("receipts", "readwrite"), store = tx.objectStore("receipts");
      let fresh = true;
      const read = store.get(id);
      read.onsuccess = () => { if (read.result) fresh = false; else store.add({ id, time: Date.now() }); };
      let cleaned = 0;
      const cursor = store.index("time").openCursor(IDBKeyRange.upperBound(Date.now() - 7 * 86400000));
      cursor.onsuccess = () => { const item = cursor.result; if (item && cleaned++ < 250) { item.delete(); item.continue(); } };
      tx.oncomplete = () => { db.close(); resolve(fresh); };
      tx.onerror = () => { db.close(); reject(new Error("RECEIPT_STORAGE")); };
    });
  } catch { return true; }
}
async function forgetReceipt(id) {
  try { const db = await receiptDb(); const tx = db.transaction("receipts", "readwrite"); tx.objectStore("receipts").delete(id); tx.oncomplete = () => db.close(); } catch { /* Fallback deduplication still uses the notification tag. */ }
}
async function receivePush(event) {
  let value = {};
  try { const text = event.data?.text() ?? ""; if (text.length <= 4096) value = JSON.parse(text); } catch { /* Display a generic notification for malformed/empty pushes. */ }
  if (self.indexedDB) {
    // Only an opaque endpoint digest and opt-out flag, never an account or business payload.
    try { const device = await deviceState(); if (device?.locked || device?.deviceKey && device.deviceKey !== value?.deviceKey) return; }
    catch { return; } // Fail closed when device ownership cannot be checked.
  }
  const valid = value && typeof value === "object" && uuid.test(value.notificationId ?? "") && uuid.test(value.deliveryId ?? "");
  const id = valid ? value.deliveryId : null, notificationId = valid ? value.notificationId : null;
  const tag = id ? `chiro-${id}` : "chiro-reminder";
  if (id && (await self.registration.getNotifications({ tag })).length) return;
  if (!await reserveReceipt(id)) return;
  const title = valid && typeof value.title === "string" ? value.title.slice(0, 120) : "Chiro Negenmanneke";
  const body = valid && typeof value.body === "string" ? value.body.slice(0, 240) : "Un rappel vous attend dans l’application.";
  try { await self.registration.showNotification(title, { body, tag, renotify: false, data: { notificationId }, icon: "/assets/Chirologo_700px.png" }); }
  catch { if (id) await forgetReceipt(id); }
}
self.addEventListener("push", event => event.waitUntil(receivePush(event)));
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL(self.registration.scope); destination.searchParams.set("app", "notifications");
    const id = event.notification.data?.notificationId;
    if (uuid.test(id ?? "")) destination.searchParams.set("notification", id);
    // Never honor a payload-supplied URL: keep navigation within this APP scope.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) {
      try { const navigated = await existing.navigate(destination.href); await (navigated ?? existing).focus(); return; } catch { /* Open a fresh APP window when navigation is unavailable. */ }
    }
    await self.clients.openWindow(destination.href);
  })());
});
self.addEventListener("install", event => event.waitUntil((async () => {
  const response = await fetch(offlineUrl, { cache: "no-store", credentials: "omit", redirect: "error" });
  if (!response.ok || response.headers.get("X-Chiro-Offline") !== "1") throw new Error("OFFLINE_UNAVAILABLE");
  await (await caches.open(cacheName)).put(offlineUrl, response);
  // Updates wait. First installation activates normally without skipWaiting.
})()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(cachePrefix) && key !== cacheName) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== new URL(self.registration.scope).origin
    || ![scopePath, scopePath.replace(/\/$/, "")].includes(url.pathname)) return;
  event.respondWith((async () => {
    try { return await fetch(request, { cache: "no-store" }); } // Successful private HTML is NEVER stored.
    catch { return await (await caches.open(cacheName)).match(offlineUrl) ?? new Response("Connexion indisponible. Réessayez en ligne.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
  })());
});
self.addEventListener("message", event => {
  if (!event.source?.url?.startsWith(self.registration.scope)) return;
  if (event.data?.type === "ACTIVATE_UPDATE") { event.waitUntil(self.skipWaiting()); return; }
  const type = event.data?.type, deviceKey = event.data?.deviceKey;
  if (type !== "PUSH_LOCK" && !(type === "PUSH_BIND" && /^[a-f0-9]{64}$/.test(deviceKey ?? ""))) return;
  event.waitUntil((async () => {
    try {
      await deviceState(type === "PUSH_LOCK" ? { locked: true } : { locked: false, deviceKey });
      if (type === "PUSH_LOCK") for (const notification of await self.registration.getNotifications()) notification.close();
      event.ports[0]?.postMessage({ ok: true });
    } catch { event.ports[0]?.postMessage({ ok: false }); }
  })());
});
