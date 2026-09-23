import { useEffect, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNotificationSettings, notificationError, notificationRpc } from "./data";
import { disableCurrentPush, enablePush, pushSupport, reconcilePush } from "./push";
import { defaultPreferences, type CategoryPreference, type NotificationPreferences, type PushDevice } from "./types";
import "./notifications.css";
export default function NotificationSettings({ client, userId, publicKey = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY ?? "" }: { client: SupabaseClient; userId: string; publicKey?: string }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences), [categories, setCategories] = useState<CategoryPreference[]>([]), [choices, setChoices] = useState<{ key: string; label: string }[]>([]), [devices, setDevices] = useState<PushDevice[]>([]);
  const [currentDevice, setCurrentDevice] = useState<string | null>(null), [support, setSupport] = useState<ReturnType<typeof pushSupport> | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState(""), [label, setLabel] = useState("Cet appareil");
  async function load() {
    setLoading(true); setError("");
    try {
      setSupport(pushSupport());
      const result = await loadNotificationSettings(client);
      setPreferences(result.preferences); setCategories(result.categories); setChoices(result.choices); setDevices(result.devices);
      setCurrentDevice(await reconcilePush(client, userId));
    } catch (cause) { setError(notificationError(cause)); } finally { setLoading(false); window.dispatchEvent(new Event("chiro:push-state")); }
  }
  useEffect(() => { void load(); }, [client, userId]);
  async function action(run: () => Promise<void>, success: string) {
    if (busy) return; setBusy(true); setError(""); setFeedback("");
    try { await run(); setFeedback(success); await load(); }
    catch (cause) { setSupport(pushSupport()); setError(notificationError(cause)); }
    finally { setBusy(false); }
  }
  const savePreferences = (next = preferences) => notificationRpc(client, "save_notification_preferences", { details: next, categories });
  return <section class="admin-panel notification-settings" lang="fr"><h1>Paramètres</h1><h2>Notifications et rappels</h2>
    {loading && <p role="status">Chargement des réglages…</p>}{error && <p role="alert">{error} <button class="btn btn-light" type="button" disabled={busy} onClick={() => void load()}>Réessayer</button></p>}{feedback && <p role="status">{feedback}</p>}
    <form class="admin-subpanel" onSubmit={e => { e.preventDefault(); void action(async () => { await savePreferences(); }, "Préférences enregistrées."); }}><fieldset disabled={busy || loading}>
      <legend>Vos rappels</legend>
      {([["event_notifications_enabled", "Rappels Agenda"], ["task_notifications_enabled", "Rappels Tâches"], ["push_enabled", "Envoi Push sur mes appareils inscrits"], ["push_details", "Afficher les détails sur l’écran verrouillé"]] as const).map(([key, text]) => <label class="notification-check" key={key}><input type="checkbox" checked={preferences[key]} onChange={e => setPreferences(p => ({ ...p, [key]: e.currentTarget.checked }))} />{text}</label>)}
      <p>Le centre interne fonctionne sans Push. Désactiver Agenda ou Tâches désactive les rappels de ce module sur les deux canaux. Les détails Push sont masqués par défaut ; aucune notification Finance n’est envoyée.</p>
      <fieldset><legend>Catégories Agenda</legend>{choices.map(category => <label class="notification-check" key={category.key}><input type="checkbox" checked={categories.find(c => c.category_key === category.key)?.enabled ?? true} onChange={e => setCategories(current => [...current.filter(c => c.category_key !== category.key), { category_key: category.key, enabled: e.currentTarget.checked }])} />{category.label}</label>)}</fieldset>
      <button class="btn" type="submit">Enregistrer les préférences</button>
    </fieldset></form>
    <section class="admin-subpanel"><h2>Push sur cet appareil</h2>
      <p>État : {!publicKey ? "Non configuré" : !support?.supported ? "Non disponible" : support.permission === "denied" ? "Refusé" : support.permission === "granted" ? "Autorisé" : "Autorisation non demandée"} · {currentDevice ? "Appareil inscrit" : "Appareil non inscrit"}</p>
      {!publicKey && <p>La clé publique Push n’est pas configurée. Le centre de notifications interne reste disponible.</p>}
      {support?.ios && !support.installed && <p>Sur iPhone/iPad, ajoutez cette application à l’écran d’accueil depuis le menu de partage. Ouvrez-la depuis son icône, puis revenez ici pour activer les notifications.</p>}
      {support && !support.supported && <p>Les notifications Push ne sont pas disponibles sur cet appareil. Le centre interne reste accessible.</p>}
      {support?.permission === "denied" && <p>Les notifications sont refusées. Vous pouvez modifier cette autorisation dans les réglages du navigateur ou du système ; aucune nouvelle demande automatique ne sera faite.</p>}
      <label>Nom de cet appareil<input maxLength={80} value={label} onInput={e => setLabel(e.currentTarget.value)} /></label>
      <div class="notification-actions"><button class="btn" type="button" disabled={busy || loading || !publicKey || !support?.supported || support.permission === "denied" || support.ios && !support.installed} onClick={() => {
        // enablePush is called synchronously from this user gesture before any unrelated await.
        const enabled = enablePush(client, userId, publicKey, label);
        void action(async () => { await enabled; await savePreferences({ ...preferences, push_enabled: true }); }, "Appareil inscrit. Les notifications Push sont activées.");
      }}>Activer les notifications</button>
      <button class="btn btn-light" type="button" disabled={busy || loading || !currentDevice} onClick={() => void action(() => disableCurrentPush(client, userId), "Notifications désactivées sur cet appareil.")}>Désactiver sur cet appareil</button>
      <button class="btn btn-light" type="button" disabled={busy || loading || !currentDevice || support?.permission !== "granted" || !preferences.push_enabled} onClick={() => void action(async () => { await notificationRpc(client, "enqueue_my_notification_test", { subscription_id: currentDevice }); }, "Test mis en file. Il sera envoyé lors du prochain passage du serveur de notifications.")}>Envoyer une notification de test</button></div>
    </section>
    <section class="admin-subpanel"><h2>Mes appareils</h2><ul class="notification-list">{devices.map(device => <li key={device.id}><strong>{device.device_label}</strong> · {device.active ? "Inscrit" : "Désactivé"}{device.id === currentDevice ? " · cet appareil" : ""}
      {device.active && <button class="btn btn-light" type="button" disabled={busy} onClick={() => void action(async () => { if (device.id === currentDevice) await disableCurrentPush(client, userId); else await notificationRpc(client, "disable_push_subscription", { target_id: device.id }); }, "Appareil désactivé.")}>Désactiver {device.device_label}</button>}
    </li>)}</ul>{!devices.length && <p>Aucun appareil inscrit.</p>}</section>
  </section>;
}
