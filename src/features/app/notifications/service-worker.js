/* Push only. No fetch handler, CacheStorage, offline assets, Auth or business data storage. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const receiptDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open("chiro-push-receipts", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("receipts", { keyPath: "id" }).createIndex("time", "time");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error("RECEIPT_STORAGE"));
});
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
    const destination = new URL(self.registration.scope);
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
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
