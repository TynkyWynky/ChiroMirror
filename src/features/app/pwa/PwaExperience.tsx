import { useEffect, useRef, useState } from "preact/hooks";
import { appleMobile, installedContext, registerAppWorker, appBuild } from "./environment";
import { captureInstallPrompt, dismissInstall, installDismissed, installState, promptInstall, watchInstall } from "./install";
import "./pwa.css";
export default function PwaExperience({ settings, home, onNotifications }: { settings: boolean; home: boolean; onNotifications: () => void }) {
  const [online,setOnline] = useState(true), [installed,setInstalled] = useState(false), [ios,setIos] = useState(false), [available,setAvailable] = useState(false), [dismissed,setDismissed] = useState(true);
  const [waiting,setWaiting] = useState<ServiceWorker | null>(null), [workerError,setWorkerError] = useState(""), [feedback,setFeedback] = useState(""), [installing,setInstalling] = useState(false), [updating,setUpdating] = useState(false);
  const reloadRequested = useRef(false), reloaded = useRef(false), registration = useRef<ServiceWorkerRegistration>();
  const [permission,setPermission] = useState("Non disponible");
  const [externalUpdate,setExternalUpdate] = useState(false);
  useEffect(() => {
    let active = true; const cleanups: (()=>void)[] = [];
    const network = () => setOnline(navigator.onLine);
    const install = () => { const state = installState(); setInstalled(installedContext() || state.installed); setAvailable(state.available); setIos(appleMobile()); setPermission("Notification" in window ? Notification.permission === "granted" ? "Autorisées sur cet appareil" : Notification.permission === "denied" ? "Refusées sur cet appareil" : "Autorisation non demandée" : "Non disponibles"); };
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
      void reg.update().catch(()=>{ if(active && navigator.onLine) setWorkerError("La vérification de version est indisponible. Réessayez plus tard."); });
    }).catch(()=>{ if(active)setWorkerError("Le service worker est indisponible. L’application reste utilisable en ligne ; l’ouverture hors ligne et le Push peuvent être indisponibles."); });
    return () => { active=false;cleanups.forEach(fn=>fn());media.removeEventListener("change",install);window.removeEventListener("online",network);window.removeEventListener("offline",network);window.removeEventListener("focus",install);window.removeEventListener("chiro:push-state",install);navigator.serviceWorker?.removeEventListener("controllerchange",controller); };
  }, []);
  async function install() {
    setInstalling(true);setFeedback("");
    try { const result = await promptInstall(); if(result === "dismissed") { dismissInstall();setDismissed(true);setFeedback("Installation reportée. Vous pourrez revenir dans Paramètres."); } else setFeedback("Demande acceptée. Terminez l’installation proposée par le navigateur."); }
    catch { setFeedback("Installation indisponible pour le moment. Utilisez le menu de votre navigateur si cette option est proposée."); }
    finally {setInstalling(false);}
  }
  function update() {
    if((!waiting && !externalUpdate) || updating)return;
    if(!window.confirm("Recharger la nouvelle version ? Enregistrez vos saisies avant de continuer."))return;
    reloadRequested.current=true;setUpdating(true);
    if(externalUpdate){if(!reloaded.current){reloaded.current=true;location.reload();}}else waiting?.postMessage({type:"ACTIVATE_UPDATE"});
  }
  return <div class="pwa-experience">
    {!online && <div class="pwa-banner" role="status"><strong>Connexion perdue</strong><p>Certaines actions sont indisponibles. Les données affichées peuvent ne plus être à jour.</p><button type="button" class="btn btn-light" onClick={()=>location.reload()}>Réessayer</button></div>}
    {(waiting || externalUpdate) && <div class="pwa-banner" role="status"><strong>Nouvelle version disponible</strong><p>Vos saisies restent ouvertes jusqu’à votre décision.</p><button class="btn" type="button" disabled={updating} onClick={update}>{updating ? "Mise à jour…" : "Mettre à jour"}</button></div>}
    {workerError && <p role="status">{workerError}</p>}
    {home && !installed && !dismissed && (available || ios) && <section class="admin-subpanel pwa-install-card"><strong>Installe Chiro Negenmanneke</strong><p>Accède plus rapidement à l’agenda, tes tâches et tes rappels.</p>{available && <button class="btn" type="button" disabled={installing} onClick={()=>void install()}>Installer l’application</button>}{ios && <p>Menu Partager → Sur l’écran d’accueil → ouvrir depuis l’icône.</p>}<button class="btn btn-light" type="button" onClick={()=>{dismissInstall();setDismissed(true);}}>Plus tard</button></section>}
    {settings && <section class="admin-panel pwa-settings" aria-labelledby="pwa-settings-title"><h2 id="pwa-settings-title">Application</h2><p>Installation : {installed ? "Installée / ouverte en mode application" : "Ouverte dans le navigateur"}</p><p>Notifications : {permission}. Les réglages d’envoi sont disponibles ci-dessous.</p><p>Version : <span data-app-version>{appBuild}</span></p>
      {!installed && available && <button class="btn" type="button" disabled={installing || !online} onClick={()=>void install()}>Installer l’application</button>}
      {!installed && ios && <section aria-label="Instructions iPhone et iPad"><h3>Installer Chiro Negenmanneke</h3><ol><li>Ouvre le menu Partager du navigateur.</li><li>Choisis « Sur l’écran d’accueil » et, si proposé, « Ouvrir comme app web ».</li><li>Ouvre ensuite l’application depuis son icône.</li></ol></section>}
      {!installed && !ios && !available && <p>L’installation directe n’est pas disponible ici. Vérifiez le menu de votre navigateur (« Installer l’application », ou Safari sur Mac : « Ajouter au Dock »). Vous pouvez continuer à utiliser l’APP dans cet onglet.</p>}
      <button class="btn btn-light" type="button" onClick={onNotifications}>Gérer les notifications</button>
      <button class="btn btn-light" type="button" disabled={!online || !registration.current} onClick={()=>{void registration.current?.update().catch(()=>setWorkerError("La vérification de version est indisponible."));}}>Vérifier les mises à jour</button>
    </section>}
    {feedback && <p role="status">{feedback}</p>}
  </div>;
}
