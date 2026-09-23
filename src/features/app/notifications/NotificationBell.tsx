import { useEffect, useRef, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import AdminIcon from "../../../components/admin/AdminIcon";
import { formatDay, formatTime, instantToLocal } from "../events/dates";
import { notificationError, notificationRpc, notificationsPage, unreadCount } from "./data";
import { reconcilePush } from "./push";
import type { AppNotification, NotificationTarget } from "./types";
import "./notifications.css";
export default function NotificationBell({ client, userId, onTarget }: { client: SupabaseClient; userId: string; onTarget: (target: NotificationTarget) => void }) {
  const [count, setCount] = useState<number | null>(null), [rows, setRows] = useState<AppNotification[]>([]), [page, setPage] = useState(0), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), deepHandled = useRef("");
  useEffect(() => {
    let active = true;
    const refresh = () => { void unreadCount(client).then(value => { if (active) setCount(value); }).catch(() => { if (active) setCount(null); }); };
    refresh(); void reconcilePush(client, userId).catch(() => { /* Settings exposes actionable reconciliation errors. */ });
    const timer = window.setInterval(refresh, 60000); // Refresh the badge only; never schedules reminders.
    window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [client, userId]);
  async function load(nextPage = page) {
    setLoading(true); setError("");
    try { const [notifications, unread] = await Promise.all([notificationsPage(client, nextPage), unreadCount(client)]); setRows(notifications); setCount(unread); setPage(nextPage); }
    catch (cause) { setError(notificationError(cause)); } finally { setLoading(false); }
  }
  async function openNotification(notification: AppNotification) {
    try {
      await notificationRpc(client, "mark_notifications_read", { target_id: notification.id });
      setCount(await unreadCount(client));
      if (notification.source_type === "EVENT" || notification.source_type === "TASK") {
        dialog.current?.close(); onTarget({ type: notification.source_type, id: notification.source_id, occurrence: notification.source_occurrence_key || undefined });
      } else await load();
    } catch (cause) { setError(notificationError(cause)); }
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("notification");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || deepHandled.current === id) return;
    deepHandled.current = id; let active = true;
    void client.from("notifications").select("*").eq("id", id).maybeSingle().then(({ data, error: cause }) => {
      if (!active) return;
      const url = new URL(location.href); url.searchParams.delete("notification"); history.replaceState(null, "", url);
      if (cause || !data) { dialog.current?.showModal(); setError("Cette notification n’est pas accessible avec votre compte."); }
      else void openNotification(data as AppNotification);
    });
    return () => { active = false; };
  }, [client, userId]);
  const close = () => { dialog.current?.close(); trigger.current?.focus(); };
  return <>
    <button ref={trigger} class="admin-icon-button notification-bell" type="button" aria-label={`Notifications${count === null ? "" : ` : ${count} non lues`}`} onClick={() => { dialog.current?.showModal(); void load(0); }}>
      <AdminIcon name="notifications" />{Boolean(count) && <span class="notification-badge" aria-hidden="true">{count! > 99 ? "99+" : count}</span>}
    </button>
    <dialog class="notification-dialog" ref={dialog} aria-labelledby="notification-center-title" lang="fr" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <section class="notification-center"><div class="notification-actions"><h2 id="notification-center-title">Notifications</h2><button class="btn btn-light" type="button" onClick={close}>Fermer</button></div>
        <div class="notification-actions"><button class="btn btn-light" type="button" disabled={loading || !count} onClick={() => { void notificationRpc(client, "mark_notifications_read", { target_id: null }).then(() => load()).catch(cause => setError(notificationError(cause))); }}>Tout marquer comme lu</button><button class="btn btn-light" type="button" disabled={loading} onClick={() => void load()}>Actualiser</button></div>
        {error && <p role="alert">{error}</p>}{loading ? <p role="status">Chargement…</p> : <>
          {!rows.length && !error && <p>Aucune notification sur cette page.</p>}
          <ul class="notification-list">{rows.map(row => <li key={row.id}><button class="notification-item" type="button" onClick={() => void openNotification(row)}><span>{row.read_at ? "Lue" : "Non lue"}</span><strong>{row.title}</strong><span>{row.body}</span><small>{formatDay(instantToLocal(row.created_at).slice(0, 10), false)} à {formatTime(row.created_at)}</small></button></li>)}</ul>
          <div class="notification-actions"><button class="btn btn-light" type="button" disabled={!page} onClick={() => void load(page - 1)}>Précédentes</button><span>Page {page + 1}</span><button class="btn btn-light" type="button" disabled={rows.length < 30} onClick={() => void load(page + 1)}>Suivantes</button></div>
        </>}
      </section>
    </dialog>
  </>;
}
