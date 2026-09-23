# Phase 6 — PWA, installation et expérience mobile

La PWA concerne uniquement l’espace interne. Le site public conserve ses pages et sa navigation
ordinaires. Aucun déploiement, accès production, migration DB ou test physique n’a été effectué.

## Identité et manifeste

Un seul manifeste dynamique, `/<ADMIN_PATH_SLUG>/manifest.webmanifest`, évolue depuis celui
de la Phase 5. Nom **Chiro Negenmanneke**, nom court **Negenmanneke**, `display: standalone`,
langue `fr-BE`, couleur système `#bd3037` et fond `#fafafb` issus du shell existant.
Son ID `/chiro-negenmanneke-app` est stable et indépendant du slug. Un ID de manifeste
n’a pas besoin d’être une page servie ni d’appartenir au scope, mais reste same-origin.
[Référence MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id).

`start_url = /<slug>/?app=home`, `scope = /<slug>/`. Raccourcis Agenda, Tâches et Comptes
utilisent les mêmes liens authentifiés. Aucun identifiant utilisateur, email, membre ou secret
dans le manifeste. Pas de verrouillage d’orientation ; portrait/paysage restent disponibles.
Pas de `display_override`, screenshots promotionnels ou faux splash JS : le manifeste fournit
les éléments de lancement aux plateformes qui les utilisent.

Le logo existant `public/assets/Chirologo_700px.png` mesure 700×700. Les icônes PNG sont
des réductions proportionnelles sur fond blanc : 192×192, 512×512, apple-touch-icon 180×180.
La maskable 512×512 place le logo complet dans un carré central de 280×280, contenu dans
le cercle de sécurité de rayon 40 % de l’image. Aucun nouveau logo ni génération IA.
Reproduction : `node scripts/generate-pwa-icons.mjs` avec Sharp déjà fourni par Astro.
Les fichiers générés sont versionnés, pas recréés à chaque build.

La page interne seule lie manifeste, theme-color et apple-touch-icon. Son viewport ajoute
`viewport-fit=cover`, sans interdire le zoom. Le titre indique Chiro Negenmanneke.

### Passage depuis la Phase 5 et changement futur du slug

La Phase 5 utilisait le chemin admin comme ID. Les rares installations préexistantes de cette
phase peuvent donc être considérées comme une autre application : vérifier et réinstaller
une fois si nécessaire. À partir de cette phase, conserver l’ID stable.
Un futur changement de slug modifie start_url/scope/script URL : l’actualisation de l’icône
installée dépend du navigateur. Recetter lancement, réinscription Push et retrait de l’ancienne
installation/registration. Aucun nettoyage automatique de registrations étrangères ou d’un
ancien scope n’est exécuté. L’ancien cache ne contient que du HTML générique.

## Navigation et authentification

Convention : `/<slug>/?app=home|agenda|tasks|finance|members|settings|notifications`.
Ressources : `?app=tasks&task=<uuid>` ou `?app=agenda&event=<uuid>&occurrence=YYYY-MM-DD`.
Les liens Push `?notification=<uuid>` restent compatibles : résolution avec RLS après login,
puis remplacement par le lien de la ressource. Les paramètres sont une liste fermée, les UUID
et dates sont validés. Aucun paramètre `next` externe n’est utilisé.

Le hook de navigation utilise History API et URLSearchParams, sans routeur supplémentaire.
Rechargement, liens directs et retour navigateur restaurent la destination. Ouvrir une fiche
met son identifiant dans l’URL ; fermer revient à sa liste. Ces identifiants peuvent donc rester
dans l’historique du navigateur, sans titre ni contenu privé. Ils n’accordent aucun droit.
Les écrans valident les permissions, puis lisent les données par RLS. Une ressource inaccessible
produit une erreur générique. Une rubrique interdite revient vers une destination autorisée.

Le manifeste lance explicitement APP Accueil, même pour un administrateur SITE. Sans session,
le login garde la destination en URL ; après authentification, l’écran autorisé est retrouvé.
Le nettoyage des paramètres Auth conserve les paramètres APP valides. Une expiration détectée
ramène au login avec un message et verrouille les Push locaux. Les anciennes réponses d’un
chargement du shell sont ignorées après changement de compte/déconnexion.

Le fonctionnement du stockage Supabase existant est conservé : sessionStorage par défaut,
localStorage avec « Onthoud mij op dit toestel » (se souvenir). Si un support est inaccessible,
le code existant peut utiliser l’autre support, puis un stockage mémoire en dernier recours.
La préférence « se souvenir » et l’email mémorisé restent dans localStorage, comme avant cette
phase. Une session persistante permet de rouvrir l’app ; sans cette option, la conservation
de session après fermeture dépend du cycle de vie du navigateur/standalone. Pas de promesse
de connexion permanente sur iOS. Le logout retire les clés Auth des deux supports.

## Installation et réglages Application

Le listener `beforeinstallprompt` est capturé tôt sur la page interne et retenu en mémoire.
Aucune UI d’installation ne s’affiche avant l’espace APP authentifié. Le prompt est appelé
uniquement par un clic sur un bouton disponible ; l’événement est consommé une seule fois.
Acceptation, refus, `appinstalled` et événement invalide ont des états distincts.
[Référence Chromium/web.dev](https://web.dev/articles/customize-install).

La carte discrète sur Accueil apparaît seulement si un prompt existe ou si une aide Apple
est pertinente. Un refus/« Plus tard » masque cette suggestion pendant 30 jours via une
simple date locale `chiro.app.install-dismissed`. Paramètres reste accessible pour une
demande volontaire. Aucun prompt automatique ou analytics.

Paramètres → Application affiche contexte installé/navigateur, autorisation Notifications,
version, installation/aide adaptée et vérification de mise à jour. Les préférences réelles
d’envoi Push restent dans le panneau Notifications immédiatement suivant.
Le helper central `installedContext()` combine display-mode standalone et navigator.standalone.
Un onglet ordinaire n’affirme pas que l’application est désinstallée : il affiche « Ouverte dans
le navigateur », car une autre fenêtre installée peut exister.

Sur iPhone/iPad : aide Partager → Sur l’écran d’accueil → ouvrir depuis l’icône ; si proposé,
conserver « Ouvrir comme app web ». Pas de faux bouton JS prétendant déclencher l’installation
Apple. L’aide disparaît en contexte installé. Safari 26 étend cette expérience d’ajout :
[WebKit](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/).
Sur macOS Safari, indiquer le menu Ajouter au Dock lorsqu’aucun prompt n’existe :
[aide Apple](https://support.apple.com/en-us/104996).
Android, Samsung et desktop utilisent les capacités standards. Aucun code Samsung spécifique.
Firefox ou tout navigateur sans événement reçoit des explications, pas un bouton garanti.

## Un seul service worker

Script conservé : `/<slug>/push-sw.js`. Scope : `/<slug>/`. Pages contrôlables : sous ce chemin,
jamais le site public à la racine. L’enregistrement est partagé par PWA et Push, déclenché
dans le shell APP authentifié sans demander d’autorisation Notifications. La désactivation
Push ne supprime pas le worker, qui sert aussi le fallback générique.

Le handler fetch ne répond qu’aux navigations GET same-origin vers la racine APP (avec/sans
slash). Il essaie le réseau avec `cache: no-store` puis utilise le fallback uniquement si la
requête réseau échoue. **Il ne copie jamais la réponse HTML réussie dans Cache Storage.**
Les réponses HTTP d’erreur ne sont pas transformées en fausses réussites offline.
Les navigations vers auth-action, les API, autres chemins, requêtes POST et sous-ressources
ne sont pas interceptées. Supabase reste réseau uniquement, quel que soit son domaine.

### Liste exhaustive du cache SW

Une seule entrée : `/<slug>/offline.html`, HTML générique autonome avec styles et bouton
Réessayer. Aucun nom, compte, titre métier, montant ou notification privée. Même les icônes
et bundles JS ne sont pas précachés dans cette version. Les caches HTTP ordinaires d’assets
publics sont indépendants ; les routes internes restent `Cache-Control: no-store`.

Nom : `chiro-app-static:<scope>:<build>`. Installation par téléchargement sans credentials
avec contrôle du marqueur `X-Chiro-Offline: 1`. L’activation retire uniquement les anciennes
versions du même préfixe/scope ; les caches étrangers restent intacts. En cas d’échec de
précache, la nouvelle installation échoue et l’ancien worker continue.

**Finance, Tasks, Events, Members, Notifications, profils, HTML authentifié et réponses Auth/API
ne sont jamais mis en cache par le service worker.** Aucune mutation locale, Background Sync,
file de paiements ou création de tâche différée.

## Offline et erreurs

Après une première visite online ayant installé le worker, une ouverture/recharge offline
montre le fallback générique. Un appareil jamais venu en ligne ne peut évidemment pas avoir
ce fallback installé. Le bouton Réessayer recharge la même URL pour retrouver la destination
après reconnexion/authentification.

Dans une APP déjà ouverte, la bannière « Connexion perdue » garde l’interface en mémoire et
précise que les données peuvent être anciennes. Les services de mutation et les formulaires
du shell refusent les enregistrements lorsque navigator.onLine est false. Aucun faux succès.
Ce signal ne prouve pas la joignabilité de Supabase : les erreurs réseau réelles restent
traitées. Une interruption après envoi peut laisser un résultat serveur incertain ; le message
invite à vérifier les données avant de recommencer, sans réessai automatique de mutation.
Les erreurs de session, installation et worker sont présentées sans détails techniques bruts.

## Mise à jour et version

L’identifiant `app-<12 caractères hex>` est calculé depuis les sources, assets, configuration
et lockfile dans astro.config.mjs. La même valeur est injectée dans le client et dans le worker.
Pas de secret CI, email ou variable privée dans cet identifiant, pas de timestamp changeant
à chaque requête. Le numéro package.json n’est pas traité comme une version de release.

Une nouvelle installation attend ; aucun skipWaiting automatique. Le shell détecte le worker
waiting et affiche « Nouvelle version disponible ». Après clic et confirmation de sauvegarde
des saisies, il envoie `ACTIVATE_UPDATE`. Le worker active, nettoie ses anciens caches puis
claim ses clients. Seule la fenêtre ayant demandé l’activation recharge, une fois, sur
controllerchange. Les autres fenêtres proposent de recharger sans interrompre leurs saisies.
La première prise de contrôle ne déclenche pas de reload.

## Push, logout et changement de compte

Push, notificationclick, VAPID et deliveries restent ceux de la Phase 5. Le clic ouvre le
centre APP puis résout la ressource autorisée. Aucun lien externe fourni dans le payload.

Le sender ajoute un digest SHA-256 opaque de l’endpoint (`deviceKey`) au payload. Après
vérification serveur que l’abonnement appartient au compte connecté, le navigateur transmet
ce digest au worker. Un payload lié à un ancien endpoint est rejeté après changement
d’abonnement. Ce digest n’est pas une preuve Auth : c’est une défense locale complémentaire
à l’unicité/ownership DB et aux revalidations serveur existantes.

Logout : verrou Push local d’abord, désactivation DB de l’abonnement courant, unsubscribe
navigateur, fermeture des toasts puis fin de session locale. Les opérations de nettoyage
sont bornées et chacune est tentée ; le logout reste disponible en cas de panne.
En cas d’échec partiel, un message explicite après logout recommande de désactiver aussi
les Notifications dans le navigateur sur un appareil partagé. Pas de message contenant
endpoint ou clés. Le blocage local subsiste tant qu’un abonnement authentifié n’est pas
de nouveau lié explicitement/vérifié avec succès.

Hors ligne, la désactivation serveur peut rester non confirmée. Le worker verrouillé filtre
les nouveaux Push et le navigateur tente unsubscribe. L’ID opaque déjà mémorisé est conservé
pour désactivation à la prochaine ouverture online du même compte. **Ce n’est pas une file
de mutations métier**. Si le stockage local et unsubscribe échouent tous deux, aucune garantie
de blocage local n’est prétendue : l’avertissement demande le retrait de permission système.
Un toast déjà livré par le système ne peut pas être rappelé de manière absolue.

Sur un appareil partagé, la réconciliation ne transfère jamais un endpoint : un abonnement
inconnu du nouveau compte est verrouillé et désabonné. L’activation manuelle crée ensuite
son abonnement propre. Le serveur conserve l’unicité de l’endpoint et refuse un autre propriétaire.
Lors de la transition depuis un ancien worker Push, activer la mise à jour proposée pour
bénéficier du verrou local. Les payloads Phase 5 déjà en transit sans digest seront filtrés
après liaison Phase 6 ; leurs notifications internes restent accessibles.

### Stockages locaux conservés

- Auth existante : sessionStorage/localStorage/mémoire suivant le choix et la disponibilité.
- LocalStorage existant : préférence login, email mémorisé et ID opaque de device par compte.
- Nouveau localStorage : uniquement date de refus de suggestion d’installation.
- IndexedDB `chiro-push-receipts` : reçus Phase 5 (delivery UUID + timestamp) et un état device
  (`locked`, digest opaque de l’endpoint courant). Aucun contenu de notification, compte,
  profil ou donnée métier. Le verrou reste durable après logout pour empêcher une reprise
  involontaire. Les reçus anciens conservent leur nettoyage de Phase 5.
- Cache Storage : exclusivement le fallback public générique décrit ci-dessus.

## Mobile et liens

Sous 900 px, APP dispose d’une barre Accueil/Agenda/Tâches/Comptes/Plus, filtrée avec les
mêmes définitions et permissions que la sidebar desktop. Plus donne accès aux autres écrans,
au SITE autorisé et au logout. Labels, aria-current, focus visible et cibles de 44 px minimum.
Safe areas top/bottom/left/right sans espace forcé si nulles. Une saisie focus masque la barre
inférieure via CSS pour laisser la place au clavier ; pas de détection fragile de sa hauteur.
Les dialogs et le contenu restent scrollables. Le site public conserve sa navigation existante.
« Voir le site » utilise `_blank` avec `noopener noreferrer`, ce qui demande une ouverture
externe ; la présentation finale dépend du système. Les liens APP restent dans leur scope.

## Validation automatisée

`tests/pwa.test.ts` : manifeste/icônes réelles, URLs, validation d’entrée, absence d’open redirect,
gardes offline, réseau/fallback, cache strict, exclusion API/Auth/site public, activation contrôlée.
Les tests Push existants vérifient aussi verrou local et rejet d’un ancien deviceKey.

`scripts/test-pwa-browser.mjs` monte **le vrai AdminApp**. Auth et transport HTTP sont simulés,
mais chaque lecture métier applique le SQL/RLS PostgreSQL PGlite et le service worker tourne
réellement dans Edge. Parcours : login administrateur SITE → APP Home ; tous les écrans +
refresh ; notification → fiche ; tâche privée refusée à l’autre compte ; capabilities install
refus/acceptation/invalidation ; navigation mobile ; offline pendant session/rechargement/
nouvelle fenêtre ; blocage des formulaires ; inspection du cache ; update réelle avec un seul
reload ; logout online/offline, verrou IndexedDB, réconciliation et aide Apple simulée.

Commandes finales : `npm test`, `npm run check`, `npm run build`, `npm run test:smoke`,
`npm run test:agenda:browser`, `npm run test:tasks:browser`, `npm run test:finance:browser`,
`npm run test:notifications:browser`, `npm run test:pwa:browser`, `git diff --check`.
Les captures et mesures de bundles sont dans `.test-artifacts/` ignoré par Git.
Lighthouse n’est pas ajouté pour cette phase. Aucun nouveau package runtime ; les modules
métier conservent leur lazy loading. Les tailles de chunks sont des mesures gzip de fichiers,
pas une estimation de tout le téléchargement initial incluant les dépendances partagées.

## Recette staging et appareils physiques — à effectuer

1. Publier un staging HTTPS autorisé, avec une base staging et VAPID configurés. Tester les
   URLs, manifeste, icônes, slug personnalisé, absence de promotion sur le site public.
2. Sur deux comptes aux droits différents, ouvrir chaque shortcut/deep link avant login,
   recharger, utiliser Retour, tester une tâche privée inaccessible et l’expiration de session.
3. iPhone **et** iPad réels : Partager → écran d’accueil, lancement standalone, icône, session
   avec/sans « se souvenir », safe areas, clavier, navigation, fermeture/réouverture, Push réel,
   clic de notification et logout online/offline. Vérifier que l’aide disparaît en standalone.
4. Android/Chrome et Samsung Internet réels : prompt lorsqu’offert, installation, lancement,
   clavier, barre inférieure, Push, logout et update pendant une saisie.
5. Windows/macOS : Edge/Chrome compatibles ; Safari Ajouter au Dock ; comportement sans API
   d’installation (notamment Firefox selon version). Ne pas déduire le support du seul UA.
6. Préinstaller online puis couper le réseau : nouvelle fenêtre et reload doivent afficher
   seulement le fallback générique. Inspecter Cache Storage après visite Finance/Tâches,
   après logout et après changement de compte. Aucun montant/titre privé dans le fallback.
7. Publier une seconde version staging : vérifier waiting, consentement, un seul reload,
   ancien cache retiré, cache étranger conservé et Push toujours fonctionnel. Tester plusieurs
   fenêtres sans reload forcé de celle contenant une saisie.
8. Vérifier les quotas/durées/cron et vraies réceptions Push de la recette Notifications.

**Aucun test physique iPhone/iPad/Android/Samsung/Windows installé/macOS installé, aucune
réception Web Push réelle et aucun déploiement Netlify ne sont validés par le test local.**
Playwright desktop/mobile et capacités simulées ne remplacent pas cette recette.

Prochaine phase recommandée : **staging + recette multi-comptes + sécurité + déploiement**,
avec autorisation séparée. Elle n’est pas exécutée ici.
