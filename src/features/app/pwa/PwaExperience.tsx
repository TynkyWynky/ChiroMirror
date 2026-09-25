import { useEffect, useRef, useState } from "preact/hooks";
import { appleMobile, installedContext, registerAppWorker, appBuild } from "./environment";
import { captureInstallPrompt, dismissInstall, installDismissed, installState, promptInstall, watchInstall } from "./install";
import type { AppAccess } from "../types";
import "./pwa.css";
export default function PwaExperience({ settings, home, onNotifications, accountName = "", email = "", access }: { settings: boolean; home: boolean; onNotifications: () => void; accountName?: string; email?: string; access?: AppAccess }) {
  const [online,setOnline] = useState(true), [installed,setInstalled] = useState(false), [ios,setIos] = useState(false), [available,setAvailable] = useState(false), [dismissed,setDismissed] = useState(true);
  const [waiting,setWaiting] = useState<ServiceWorker | null>(null), [workerError,setWorkerError] = useState(""), [feedback,setFeedback] = useState(""), [installing,setInstalling] = useState(false), [updating,setUpdating] = useState(false);
  const reloadRequested = useRef(false), reloaded = useRef(false), registration = useRef<ServiceWorkerRegistration>();
  const [externalUpdate,setExternalUpdate] = useState(false);
  useEffect(() => {
    let active = true; const cleanups: (()=>void)[] = [];
    const network = () => setOnline(navigator.onLine);
    const install = () => { const state = installState(); setInstalled(installedContext() || state.installed); setAvailable(state.available); setIos(appleMobile()); };
    captureInstallPrompt(); install(); network(); setDismissed(installDismissed()); cleanups.push(watchInstall(install));
    const media = matchMedia("(display-mode: standalone)"); media.addEventListener("change",install);
    window.addEventListener("online",network);window.addEventListener("offline",network);window.addEventListener("focus",install);
    window.addEventListener("chiro:push-state",install);
    let hadController = Boolean(navigator.serviceWorker?.controller);
    const controller = () => {
      if (reloadRequested.current && !reloaded.current) { reloaded.current = true; location.reload(); }
      else if(hadController){setExternalUpdate(true);setWaiting(null);}
      hadController = true;
    };
    navigator.serviceWorker?.addEventListener("controllerchange",controller);
    void registerAppWorker().then(reg => {
      if (!active) return; registration.current = reg;
      const check = () => { if (active) setWaiting(reg.waiting); };
      const found = () => { const worker = reg.installing; if (worker) { worker.addEventListener("statechange",check);cleanups.push(()=>worker.removeEventListener("statechange",check)); } };
      check(); found(); reg.addEventListener("updatefound",found);cleanups.push(()=>reg.removeEventListener("updatefound",found));
      void reg.update().catch(()=>{ if(active && navigator.onLine) setWorkerError("Controleren op updates is niet beschikbaar. Probeer later opnieuw."); });
    }).catch(()=>{ if(active)setWorkerError("De serviceworker is niet beschikbaar. Je kunt de app online gebruiken; offline openen en pushmeldingen zijn mogelijk niet beschikbaar."); });
    return () => { active=false;cleanups.forEach(fn=>fn());media.removeEventListener("change",install);window.removeEventListener("online",network);window.removeEventListener("offline",network);window.removeEventListener("focus",install);window.removeEventListener("chiro:push-state",install);navigator.serviceWorker?.removeEventListener("controllerchange",controller); };
  }, []);
  async function install() {
    setInstalling(true);setFeedback("");
    try { const result = await promptInstall(); if(result === "dismissed") { dismissInstall();setDismissed(true);setFeedback("Installatie uitgesteld. Je kunt later terugkomen via Instellingen."); } else setFeedback("Aanvraag geaccepteerd. Voltooi de installatie in je browser."); }
    catch { setFeedback("Installatie is momenteel niet beschikbaar. Gebruik het browsermenu als die optie wordt aangeboden."); }
    finally {setInstalling(false);}
  }
  function update() {
    if((!waiting && !externalUpdate) || updating)return;
    if(!window.confirm("De nieuwe versie laden? Sla eerst je wijzigingen op."))return;
    reloadRequested.current=true;setUpdating(true);
    if(externalUpdate){if(!reloaded.current){reloaded.current=true;location.reload();}}else waiting?.postMessage({type:"ACTIVATE_UPDATE"});
  }
  return <div class="pwa-experience">
    {!online && <div class="pwa-banner" role="status"><strong>Verbinding verbroken</strong><p>Sommige acties zijn niet beschikbaar. De getoonde gegevens zijn mogelijk niet meer actueel.</p><button type="button" class="btn btn-light" onClick={()=>location.reload()}>Opnieuw proberen</button></div>}
    {(waiting || externalUpdate) && <div class="pwa-banner" role="status"><strong>Nieuwe versie beschikbaar</strong><p>Je invoer blijft open totdat je een keuze maakt.</p><button class="btn" type="button" disabled={updating} onClick={update}>{updating ? "Bijwerken…" : "Bijwerken"}</button></div>}
    {workerError && <p role="status">{workerError}</p>}
    {home && !installed && !dismissed && (available || ios) && <section class="admin-subpanel pwa-install-card"><strong>Installeer Chiro Negenmanneke</strong><p>Open sneller de agenda, je taken en je herinneringen.</p>{available && <button class="btn" type="button" disabled={installing} onClick={()=>void install()}>App installeren</button>}{ios && <p>Deelmenu → Zet op beginscherm → open via het pictogram.</p>}<button class="btn btn-light" type="button" onClick={()=>{dismissInstall();setDismissed(true);}}>Later</button></section>}
    {settings && <section class="admin-panel pwa-settings" aria-labelledby="pwa-settings-title"><h1 id="pwa-settings-title">Instellingen</h1><section class="admin-subpanel"><h2>Mijn account</h2><p><strong>{accountName || "Mijn account"}</strong>{email && <> · {email}</>}</p><p>Gekoppeld lid: {access?.member ? `${access.member.first_name} ${access.member.last_name}` : "Nog niet gekoppeld"}</p><p>APP-rollen: {access?.roles.map(role => role.label).join(", ") || "Leiding (basistoegang)"}</p></section><h2>Applicatie</h2><p>Installatie: {installed ? "Geïnstalleerd / geopend als app" : "Geopend in de browser"}</p><p>Meldingen beheer je hieronder.</p><p>Versie: <span data-app-version>{appBuild}</span></p>
      {!installed && available && <button class="btn" type="button" disabled={installing || !online} onClick={()=>void install()}>App installeren</button>}
      {!installed && ios && <section aria-label="Instructies voor iPhone en iPad"><h3>Chiro Negenmanneke installeren</h3><ol><li>Open het deelmenu van de browser.</li><li>Kies ‘Zet op beginscherm’ en indien beschikbaar ‘Open als webapp’.</li><li>Open de app daarna via het pictogram.</li></ol></section>}
      {!installed && !ios && !available && <p>Rechtstreeks installeren is hier niet beschikbaar. Controleer je browsermenu (‘App installeren’ of in Safari op Mac ‘Voeg toe aan Dock’). Je kunt de APP in dit tabblad blijven gebruiken.</p>}
      <button class="btn btn-light" type="button" onClick={onNotifications}>Meldingen beheren</button>
      <button class="btn btn-light" type="button" disabled={!online || !registration.current} onClick={()=>{void registration.current?.update().catch(()=>setWorkerError("Controleren op updates is niet beschikbaar."));}}>Controleren op updates</button>
    </section>}
    {feedback && <p role="status">{feedback}</p>}
  </div>;
}
