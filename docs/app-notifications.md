# APP — Notifications et rappels (Phase 5)

La DB est la source de vérité. Agenda et Tâches enregistrent leurs définitions de rappel
avec la modification métier, dans une seule transaction. Les triggers invalident les anciens
jobs et marquent la source à reconstruire. Aucun minuteur navigateur ne programme de rappel.
Le rafraîchissement de la cloche toutes les 60 secondes ne fait que lire un compteur.

## Modèle et droits

| Table | Rôle |
| --- | --- |
| `notifications` | Centre privé, lu/non lu, lien par type/id/occurrence, un enregistrement par job |
| `notification_preferences` | Push désactivé par défaut ; Agenda/Tâches activés ; détails Push masqués |
| `notification_category_preferences` | Préférence par catégorie réelle de l’Agenda, activée si absente |
| `push_subscriptions` | Plusieurs appareils par compte, endpoint et clés sensibles, activité/dernière présence |
| `notification_rebuild_queue` | Une source à reconstruire, révision, prochain passage, bail et jeton |
| `notification_jobs` | Rappel utilisateur persistant, instant UTC, expiration, statut |
| `notification_deliveries` | État, tentatives, bail et résultat de chaque appareil |

Les quatre tables utilisateur ont une RLS propriétaire `auth.uid() = user_id`, avec accès APP.
`APP_ADMIN`, SITE admin et trésorier ne voient pas les données des autres. Les écritures
passent par des RPC dont l’acteur est dérivé du JWT. Les tables système et helpers sont
inaccessibles au client. Seules les RPC du worker sont accordées à `service_role`.
Les tests de notification sont limités au compte courant, à un abonnement actif lui appartenant
et à un test par minute. Aucun rôle ne reçoit de pouvoir d’envoi vers un autre utilisateur.

## Agenda et Tâches

Agenda ALL cible les membres actifs, liés à un compte doté de `app.access` et `events.read`.
SELECTED ajoute le filtre des participants. Les préférences du module et de la catégorie
effective de chaque occurrence s’appliquent, y compris si une exception change la catégorie.
Les membres archivés et les comptes sans accès ne reçoivent plus de nouveaux rappels.

La fenêtre contient les rappels dus dans les 90 prochains jours, étendue toutes les six heures.
Pour inclure un rappel très anticipé, l’expansion des occurrences va jusqu’à 456 jours,
sans jamais produire plus de 20 000 jobs pour une source. Dépasser ce plafond échoue
explicitement (`PLAN_FAILED`) : surveiller ce code, réduire la source ou adapter le traitement
avant une forte volumétrie. La borne de dates de l’Agenda existant reste applicable.
Déplacement, annulation, modification de série, participants et rappels invalident les anciens
jobs dans la transaction métier. La clé d’occurrence reste sa date originale.

Tâches PERSONAL : propriétaire Auth et membre toujours liés. TEAM : participants actifs
avec `work_status = TODO`. Le DONE individuel cesse les rappels pour cette personne ; les
autres continuent. DONE/CANCELLED global, deadline supprimée ou modifiée invalident les
rappels concernés. Les droits existants propriétaire/LEAD/gestionnaire gouvernent l’édition.
Les rappels restent attachés à la tâche, pas à une récurrence de tâches.

Les formulaires proposent des presets puis une édition lisible : jours avant à une heure locale,
minutes avant ou instant personnalisé. Activité : J−1 à 19 h ; weekend : J−7/J−1 ; camp :
J−14/J−7/J−1. Une deadline Tâches datée propose J−1 à 19 h, une deadline horaire 24 h avant.
Les IDs existants sont conservés lors de l’édition. Maximum 10 définitions, doublons refusés.
Les rappels absolus ne sont pas autorisés sur les séries : choisir un rappel relatif.

## Europe/Brussels

`@js-temporal/polyfill` calcule les jours civils puis 19:00 en Europe/Brussels. Ce calcul
n’est pas une soustraction de 24 heures. Les offsets sont des durées appliquées à l’instant
de début/deadline ; la deadline date seule inclut toute la journée locale.
Les `due_at` sont des instants UTC. Les transitions DST conservent l’heure locale.
Pour une heure locale de rappel ambiguë/inexistante, la résolution Temporal est `later` ;
l’éditeur d’instants absolus réutilise la validation Agenda des heures ambiguës/inexistantes.
Le rattrapage est limité à 24 h, avec expiration au plus tard 15 minutes après l’événement
ou la deadline. Cette petite grâce permet aussi un offset nul malgré la granularité du cron.
Une indisponibilité prolongée peut donc faire expirer des rappels sans notification tardive.

## Centre et appareils

Cloche uniquement dans APP, badge accessible, dialogue clavier, état lu/non lu textuel,
lecture individuelle/tout marquer, pages de 30. Un clic résout la tâche ou l’occurrence
dans les données actuellement autorisées. Un lien Push transporte uniquement l’UUID de
notification ; il est résolu après login avec RLS, puis retiré de l’URL. Un lien inaccessible
affiche une erreur sans divulguer la ressource.

APP → Paramètres expose les canaux, catégories, détails sur écran verrouillé, permission
et appareils. Le montage ne demande jamais de permission. Seul le bouton d’activation
appelle `requestPermission()`. Un refus reste expliqué sans sollicitation répétée.
La réconciliation consulte le navigateur et touche uniquement un abonnement déjà actif
appartenant au compte. Elle ne réactive pas un appareil désactivé à distance. Un ancien
abonnement absent du navigateur est désactivé via son ID mémorisé, sans fingerprinting.
Un navigateur partagé doit changer explicitement d’abonnement avant de l’associer à un
autre compte. Le nom d’appareil est modifiable, le User-Agent n’est pas enregistré.

Désactivation : DB et navigateur sont tentés indépendamment ; une erreur partielle est
signalée et l’ID local est conservé pour réconciliation. La déconnexion tente ce nettoyage
pendant au plus cinq secondes, sans empêcher de se déconnecter en cas de panne.
Un transport déjà accepté par le fournisseur ne peut pas être rappelé après logout/opt-out.

## Web Push et confidentialité

`web-push` **3.6.7** (`@types/web-push` 3.6.4 en développement), importé uniquement par
le code serveur. VAPID standard, aucune crypto maison. Le contenu par défaut est générique ;
les détails nécessitent un opt-in explicite. Aucune donnée Finance, email ou SMS.
Les logs ne contiennent que compteurs/codes sûrs. Les erreurs frontend n’exposent jamais
les exceptions réseau brutes. Les pages d’appareils ne sélectionnent pas leurs clés/endpoints.
L’allowlist HTTPS des fournisseurs Chrome/Firefox/Apple/Windows bloque les endpoints arbitraires
(SSRF). Un nouveau fournisseur nécessitera une extension revue de cette liste.

Le worker Push est servi à `/<ADMIN_PATH_SLUG>/push-sw.js`, scope `/<ADMIN_PATH_SLUG>/`,
sans cache HTTP. Même une entrée APP sans slash final conserve ce scope. Il ne possède
aucun handler `fetch`, aucune CacheStorage et aucune donnée métier/Auth hors ligne.
Un manifeste minimal dans ce même scope permet l’usage standalone requis sur iOS.
Le worker valide le payload, limite le texte, affiche puis ouvre/focalise une fenêtre APP.
Il ignore tout chemin/URL arbitraire fourni dans un payload.

Sur un navigateur compatible desktop/Android, HTTPS et permission utilisateur sont requis.
Sur iOS/iPadOS 16.4+, le Web Push vise une web app ajoutée à l’écran d’accueil, puis ouverte
depuis son icône ; l’UX explique ces étapes. La détection combine capacités et contexte
standalone, sans contourner le système. La réception système dépend aussi de ses réglages.
Référence : [WebKit, Web Push sur iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Idempotence, concurrence et retries

UNIQUE sur utilisateur/type/source/occurrence/rappel/instant ; UNIQUE notification/job ;
UNIQUE livraison/job/appareil. Matérialisation interne et création des deliveries dans une
transaction PostgreSQL, `FOR UPDATE SKIP LOCKED`, claims à jeton, bail planner de 2 min,
bail delivery de 90 s. Un ancien worker ne peut pas valider un nouveau bail. Révisions et
droits/préférences sont revalidés au commit du plan, au claim, puis juste avant transport.
Un changement propre à un utilisateur préserve les deliveries des autres destinataires.
Une modification métier invalide les transports encore en attente pour éviter l’ancien rappel.

Chaque appareil a au plus quatre tentatives : après échec temporaire, +1 min, +5 min,
+15 min. 429/5xx et erreurs réseau sont temporaires ; 404/410 désactivent l’abonnement.
Une erreur d’un appareil ne bloque pas les autres. Aucun appareil ou Push désactivé
n’empêche la notification interne. VAPID absent : seul le canal interne est traité, sans
consommer les tentatives Push ; les deliveries expirent selon les règles du job.

L’unicité interne est garantie en DB. **Le transport externe ne permet pas une garantie
exactly-once absolue** : un crash après acceptation Push et avant accusé DB peut causer une
nouvelle tentative. Les retries réutilisent le même ID/tag/topic. Le service worker déduplique
avec les notifications actives et des reçus IndexedDB contenant uniquement un ID opaque de
delivery et un timestamp, purgés après 7 jours par lots de 250. Aucun titre/contenu/compte
n’est stocké dans ces reçus. Si ce stockage est indisponible/effacé, seul le tag reste ; un
crash entre réservation du reçu et affichage peut perdre le toast. Le centre interne conserve
la notification. Un push en cours d’envoi ne peut pas être annulé rétroactivement.

PGlite valide les RPC atomiques et deux demandes de claim concurrentes, mais sérialise
ses requêtes embarquées : un stress test multi-connexions PostgreSQL reste à faire en staging.

## Netlify et exploitation

`netlify/functions/notifications-tick.ts` : cron `* * * * *`, **UTC**, activé uniquement si
`NOTIFICATIONS_ENABLED=true`. 5 sources, 30 jobs internes, 10 deliveries (5 en parallèle),
budget de travail nominal de 22 s. Appels Supabase timeout 4 s, transport Push timeout 3 s.
Ces marges visent la limite Netlify Scheduled Functions de 30 s, à mesurer en staging.
Les baux permettent la reprise après interruption. Le travail restant attend le prochain tick.
En régime sans backlog, un job déjà planifié attend normalement moins d’une minute plus
le temps de traitement. Il n’existe pas de retard maximal garanti en cas de backlog, panne,
retry ou bail expiré. TTL fournisseur 60 s ; un appareil longtemps hors réseau peut manquer
le toast mais retrouve son centre interne.

Les schedules fonctionnent sur les déploiements publiés, pas automatiquement sur les Deploy
Previews. Vérifier l’activation et les quotas du plan effectif ; ne pas supposer une recette
du cron parce qu’un preview fonctionne. Référence :
[Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/).

Configuration : générer une paire **une seule fois** avec
`npx web-push generate-vapid-keys`. Conserver la clé privée dans le gestionnaire de secrets,
jamais dans Git ni dans un nom `PUBLIC_*`. Aucun secret réel n’a été généré ici.

| Variable | Disponibilité |
| --- | --- |
| `PUBLIC_VAPID_PUBLIC_KEY` | Build frontend ET runtime Functions, même paire |
| `VAPID_PRIVATE_KEY` | Runtime Functions seulement |
| `VAPID_SUBJECT` | Runtime Functions, adresse `mailto:` de contact valide |
| `PUBLIC_SUPABASE_URL` | Build ET runtime Functions du staging ciblé |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime serveur seulement |
| `NOTIFICATIONS_ENABLED` | `true` uniquement dans l’environnement publié voulu |
| `ADMIN_PATH_SLUG` | Chemin APP existant, conservé pour le scope des abonnements |

Changer le slug ou la paire VAPID nécessite une recette de réinscription des appareils.
Un sujet VAPID `https://localhost` n’est pas adapté à Safari ; utiliser un vrai contact.
Référence : [web-push API](https://github.com/web-push-libs/web-push/blob/master/README.md).

Chaque tick purge au plus 200 notifications lues depuis plus de 365 jours, 200 jobs terminaux
créés depuis plus de 180 jours, 50 subscriptions inactives depuis plus de 90 jours.
Les notifications non lues sont conservées, même lorsque leur ancien job est purgé.
La fenêtre de rattrapage empêche de recréer d’anciens rappels après cette rétention.
Les changements de préférences reconstruisent les sources Agenda pertinentes globalement,
avec isolation des envois des autres utilisateurs ; cette stratégie reste adaptée à une
petite association. Surveiller la file, `PLAN_FAILED`, l’âge du plus ancien job dû et le taux
d’échec avant d’augmenter la volumétrie. Aucun tableau de supervision additionnel ici.

## Migration et recette staging (aucun déploiement effectué)

Migration additive `20260923000400_app_notifications.sql`, après Finance ; bootstrap synchronisé.
Exécutée uniquement dans des bases éphémères de test, jamais sur une base distante.

1. Sur un staging Supabase autorisé, appliquer les migrations manquantes dans l’ordre.
2. Configurer la paire VAPID et les variables côté build/runtime, avec un vrai contact.
3. Publier un site de staging HTTPS utilisant exclusivement cette base ; activer le worker.
4. Ouvrir APP avec deux comptes et plusieurs appareils. Activer manuellement un abonnement.
5. Envoyer le test à soi-même, lancer **Run Now** puis vérifier le tick planifié suivant.
6. Vérifier le centre, le toast réel et son clic après fermeture/reconnexion ; contrôler qu’un
   second tick ne duplique pas la notification interne. Tester un refus, un opt-out, un appareil
   désactivé et une erreur temporaire. Vérifier qu’un compte ne lit jamais l’autre.
7. Créer un rappel proche, déplacer/annuler une occurrence, terminer une tâche individuellement
   puis globalement, supprimer une deadline et vérifier les jobs/notifications attendus.
8. Tester iPhone/iPad installé, Android et au moins Chrome/Firefox/Safari pris en charge,
   notamment app fermée, appareil hors ligne et réglages de confidentialité d’écran verrouillé.
9. Mesurer durée réelle, backlog, cadence et claims sur plusieurs connexions PostgreSQL.

**Web Push réel : non réalisé ; à valider en staging HTTPS.** Les tests locaux ne contactent
aucun fournisseur Push, aucune DB distante et ne déploient rien.

## Validation locale

Tests unitaires Temporal/DST, séries/overrides/catégories, tâches, payload/clic SW/allowlist ;
tests SQL/RLS et worker avec vrai PostgreSQL PGlite, transport Push simulé ; parcours Edge
desktop/mobile avec composants réels, SQL/RLS réel et API de permission/subscription simulée.
Les tests navigateur existants Agenda, Tâches et Comptes restent exécutés.

Commandes : `npm test`, `npm run check`, `npm run build`, `npm run test:smoke`,
`npm run test:agenda:browser`, `npm run test:tasks:browser`, `npm run test:finance:browser`,
`npm run test:notifications:browser`, `git diff --check`.
Résultats locaux : **56 tests réussis** ; Astro check **142 fichiers, zéro erreur/warning/hint** ;
build standard et build APP complet avec valeurs factices réussis ; **18 contrôles HTTP** ;
les quatre parcours navigateur réussis ; `git diff --check` réussi. Compilation séparée du
worker et mode désactivé vérifiés. Le bundle client complet contient la configuration publique
Push, sans les marqueurs factices de clé privée/service role ni le package serveur `web-push`.
Les lancements Node/Edge et le build ont nécessité des relances autorisées hors bac à sable
Windows (restrictions de processus/résolution de modules), sans accès distant ni déploiement.
Captures locales ignorées par Git
dans `.test-artifacts/`. Les notifications système natives, le cron Netlify et l’installation
iOS réelle ne sont pas validés par ces mocks.

## Suite

Recette HTTPS avant activation en production. Puis phase PWA/installabilité prudente,
avec décision explicite sur ce qui peut être mis en cache. Aucun cache privé, synchronisation
offline, install prompt complexe ou moteur Finance de notifications n’est ajouté ici.
