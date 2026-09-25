import { useEffect, useState } from "preact/hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNotificationSettings, notificationError, notificationRpc } from "./data";
import { disableCurrentPush, enablePush, inspectPushCapabilities, pushState, reconcilePush } from "./push";
import type { PushCapabilities } from "./push";
import { friendlyDeviceName } from "../pwa/device";
import { defaultPreferences, type CategoryPreference, type NotificationPreferences, type PushDevice } from "./types";
import "./notifications.css";
export default function NotificationSettings({ client, userId, publicKey = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY ?? "" }: { client: SupabaseClient; userId: string; publicKey?: string }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences), [categories, setCategories] = useState<CategoryPreference[]>([]), [choices, setChoices] = useState<{ key: string; label: string }[]>([]), [devices, setDevices] = useState<PushDevice[]>([]);
  const [currentDevice, setCurrentDevice] = useState<string | null>(null), [support, setSupport] = useState<PushCapabilities | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState(""), [label, setLabel] = useState(() => friendlyDeviceName());
  async function load() {
    setLoading(true); setError("");
    try {
      setSupport(await inspectPushCapabilities(publicKey));
      const result = await loadNotificationSettings(client);
      setPreferences(result.preferences); setCategories(result.categories); setChoices(result.choices); setDevices(result.devices);
      setCurrentDevice(await reconcilePush(client, userId));
    } catch (cause) { setError(notificationError(cause)); } finally { setLoading(false); window.dispatchEvent(new Event("chiro:push-state")); }
  }
  useEffect(() => { void load(); }, [client, userId]);
  async function action(run: () => Promise<void>, success: string) {
    if (busy) return; setBusy(true); setError(""); setFeedback("");
    try { await run(); setFeedback(success); await load(); }
    catch (cause) { setSupport(await inspectPushCapabilities(publicKey)); setError(notificationError(cause)); }
    finally { setBusy(false); }
  }
  const savePreferences = (next = preferences) => notificationRpc(client, "save_notification_preferences", { details: next, categories });
  const state = pushState(support, Boolean(currentDevice));
  const deviceStatus = state === "CHECKING" ? "Notificaties worden gecontroleerd…" : state === "SUBSCRIBED" ? "Notificaties zijn ingeschakeld op dit apparaat." : state === "DEVICE_UNSUPPORTED" ? "Pushmeldingen worden niet ondersteund op dit apparaat." : state === "PUSH_NOT_CONFIGURED" ? "Pushmeldingen zijn tijdelijk niet geconfigureerd." : state === "PERMISSION_DENIED" ? "Notificaties zijn geblokkeerd. Je kunt ze opnieuw toestaan via de instellingen van je browser of toestel." : state === "SERVICE_WORKER_ERROR" ? "De notificatieservice kon niet worden gestart. Vernieuw de app en probeer opnieuw." : "Notificaties zijn nog niet ingeschakeld op dit apparaat.";
  return <section class="admin-panel notification-settings" lang="nl"><h2>Notificaties</h2><h3>Meldingen en herinneringen</h3>
    {loading && <p role="status">Instellingen laden…</p>}{error && <p role="alert">{error} <button class="btn btn-light" type="button" disabled={busy} onClick={() => void load()}>Opnieuw proberen</button></p>}{feedback && <p role="status">{feedback}</p>}
    <form class="admin-subpanel" onSubmit={e => { e.preventDefault(); void action(async () => { await savePreferences(); }, "Voorkeuren opgeslagen."); }}><fieldset disabled={busy || loading}>
      <legend>Je herinneringen</legend>
      {([["event_notifications_enabled", "Agendaherinneringen"], ["task_notifications_enabled", "Taakherinneringen"], ["push_enabled", "Pushmeldingen op mijn geregistreerde apparaten"], ["push_details", "Details tonen op het vergrendelscherm"]] as const).map(([key, text]) => <label class="notification-check" key={key}><input type="checkbox" checked={preferences[key]} onChange={e => setPreferences(p => ({ ...p, [key]: e.currentTarget.checked }))} />{text}</label>)}
      <p>Het interne meldingencentrum werkt zonder pushmeldingen. Agenda of Taken uitschakelen schakelt de herinneringen van die module op beide kanalen uit. Pushdetails zijn standaard verborgen; er worden geen financiële meldingen verstuurd.</p>
      <fieldset><legend>Agendacategorieën</legend>{choices.map(category => <label class="notification-check" key={category.key}><input type="checkbox" checked={categories.find(c => c.category_key === category.key)?.enabled ?? true} onChange={e => setCategories(current => [...current.filter(c => c.category_key !== category.key), { category_key: category.key, enabled: e.currentTarget.checked }])} />{category.label}</label>)}</fieldset>
      <button class="btn" type="submit">Voorkeuren opslaan</button>
    </fieldset></form>
    <section class="admin-subpanel"><h2>Notificaties</h2>
      <p>Notificaties op dit apparaat: {deviceStatus}</p>
      {state === "PUSH_NOT_CONFIGURED" && <p>Het interne meldingencentrum blijft toegankelijk.</p>}
      {support?.ios && !support.installed && <p>Voeg op je iPhone/iPad deze app toe aan het beginscherm via het deelmenu. Open de app via het pictogram en kom hier terug om meldingen in te schakelen.</p>}
      <label>Naam van dit apparaat<input maxLength={80} value={label} onInput={e => setLabel(e.currentTarget.value)} /></label>
      <div class="notification-actions"><button class="btn" type="button" disabled={busy || loading || state !== "READY_TO_SUBSCRIBE" && state !== "PERMISSION_DEFAULT" || support?.ios && !support.installed} onClick={() => {
        // enablePush is called synchronously from this user gesture before any unrelated await.
        const enabled = enablePush(client, userId, publicKey, label);
        void action(async () => { await enabled; await savePreferences({ ...preferences, push_enabled: true }); }, "Apparaat geregistreerd. Pushmeldingen zijn ingeschakeld.");
      }}>Notificaties inschakelen</button>
      <button class="btn btn-light" type="button" disabled={busy || loading || !currentDevice} onClick={() => void action(() => disableCurrentPush(client, userId), "Notificaties uitgeschakeld op dit apparaat.")}>Uitschakelen op dit apparaat</button>
      <button class="btn btn-light" type="button" disabled={busy || loading || !currentDevice || support?.permission !== "granted" || !preferences.push_enabled} onClick={() => void action(async () => { await notificationRpc(client, "enqueue_my_notification_test", { subscription_id: currentDevice }); }, "Test ingepland. De melding wordt bij de volgende verwerking door de meldingenserver verstuurd.")}>Testnotificatie</button></div>
    </section>
    <section class="admin-subpanel"><h2>Mijn apparaten</h2><ul class="notification-list">{devices.map(device => <li key={device.id}><strong>{device.device_label}</strong> · {device.active ? "Geregistreerd" : "Uitgeschakeld"}{device.id === currentDevice ? " · dit apparaat" : ""}
      {device.active && <button class="btn btn-light" type="button" disabled={busy} onClick={() => void action(async () => { if (device.id === currentDevice) await disableCurrentPush(client, userId); else await notificationRpc(client, "disable_push_subscription", { target_id: device.id }); }, "Apparaat uitgeschakeld.")}>Uitschakelen {device.device_label}</button>}
    </li>)}</ul>{!devices.length && <p>Geen apparaten geregistreerd.</p>}</section>
  </section>;
}
