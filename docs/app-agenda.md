# Phase 2 — Agenda interne

> Phase 5 : les rappels sont désormais éditables et exploités par un planner serveur et Web Push.
> Voir [Notifications](app-notifications.md) pour l’état actuel ; les mentions « sans moteur » ci-dessous décrivent la Phase 2.

> Rapport historique de Phase 2. La [Phase 3 Tâches](app-tasks.md) ajoute les tâches
> et leurs liens aux événements ; les limites de périmètre ci-dessous décrivent la Phase 2.

## Périmètre livré

APP → Accueil / Agenda / Membres, avec libellés APP français et shell SITE conservé.
L’Agenda propose Mois et Liste, filtres par catégorie, affichage optionnel des annulations,
création, fiche, modification et annulation. La liste est la vue initiale sous 900 px.
Les catégories sont textuelles, avec une différenciation de couleur complémentaire.

Aucun module de tâches, finances, documents, présence, inscription, Push ou PWA.
Le créateur n’inscrit pas les participants : il indique simplement les personnes concernées.

## Tables et relations

- `event_categories(key, label)` : ACTIVITY, MEETING, EVENT, WEEKEND, CAMP, DEADLINE, OTHER.
  Ajouter une ligne système permet d’ajouter une catégorie, affichée automatiquement avec
  son libellé français ; aucune énumération TypeScript fermée ni palette obligatoire.
- `events` : définition d’événement simple ou de série ; titre, description, catégorie,
  lieu, dates typées, fuseau, audience, répétition, statut, acteurs et horodatages d’audit,
  révision monotone. `events.id` est une identité métier stable.
- `event_participants(event_id, member_id)` : PK composée, FK vers `events` et `members`,
  index inverse par membre. Pas de relation participant → Auth.
- `event_occurrence_overrides(event_id, occurrence_date)` : exception complète et typée
  pour une occurrence. La clé est la **date locale d’origine**, même après déplacement.
  Contient titre, description, type, lieu, dates, statut et dernier acteur de modification.
- `event_reminders` : données de rappel, FK événement, modes relatifs ou absolus ; aucun envoi.

Indexes sur départs horaires/civils, catégorie/statut, participants, départs des exceptions
et rappels. Les FK métier utilisent RESTRICT ; aucune suppression physique n’est exposée.
Supprimer un compte Auth conserve les événements et met ses références d’audit à NULL.

## Dates et fuseau

Tout le module passe par `events/dates.ts`, fondé sur `@js-temporal/polyfill`.

- Toute la journée : `start_date`/`end_date` en PostgreSQL `date`, **fin incluse**.
  Aucun passage artificiel par minuit UTC. Les colonnes horaires restent NULL.
- Avec heure : `starts_at`/`ends_at` en `timestamptz`, instants sérialisés avec offset/UTC,
  et `timezone = Europe/Brussels`. Les colonnes civiles restent NULL.
- Les deux modèles autorisent plusieurs jours et une fin égale au début. La DB valide
  les couples exclusifs, leur ordre et les bornes ; le client reprend ces validations.
- Les dates saisissables sont bornées à 2000–2100 pour borner aussi les calculs de récurrence.
- La saisie horaire est locale à Bruxelles, quel que soit le fuseau du navigateur.
  Les heures inexistantes ou ambiguës aux transitions DST sont refusées à la saisie,
  avec explication ; choisir une autre heure. Les instants API explicitement zonés restent non ambigus.
- Une série avance en jours civils locaux, puis convertit ses deux extrémités en instants.
  Une réunion à 14:00 reste à 14:00 avant/après les passages été/hiver.
- Si une occurrence tombe à une heure problématique, la règle est déterministe :
  `later` (seconde heure lors du recul ; décalage vers l’avant dans le trou de printemps).
  Cette convention concorde avec la conversion PostgreSQL utilisée lors des annulations.
  Si le déplacement du départ dépasse exceptionnellement la fin, la durée écoulée de
  l’événement initial est conservée pour éviter une durée négative.
- Formats français centralisés (`fr-BE`), avec mention Bruxelles pour les horaires.

La distinction dates civiles/instants et les options de désambiguïsation suivent la
[documentation Temporal](https://tc39.es/proposal-temporal/docs/timezone.html).

## Séries et occurrences

Une ligne `events` suffit pour une série, sans génération de 52 lignes indépendantes.
Règle structurée versionnable par migration :

- fréquence NONE / WEEKLY / MONTHLY ;
- intervalle 1–52 ;
- jours ISO 1–7 pour la semaine, incluant le jour du départ ;
- date limite incluse, nombre maximal d’occurrences 1–10 000, ou les deux (première limite atteinte).

La semaine commence lundi. Les mois sont calculés depuis le mois initial ; une règle
mensuelle le 31 ignore les mois sans 31. Les dates ignorées ne consomment pas le compteur.
Les occurrences annulées, elles, comptent dans la série. Le moteur ne renvoie que les
occurrences recouvrant la fenêtre demandée, tout en comptant les précédentes pour COUNT.
Il inclut aussi les exceptions déplacées depuis une date située hors de la fenêtre.

Une exception est un instantané explicite de ses champs éditables : modifier la série
ne l’écrase pas. Les participants restent ceux de la série dans cette version.
Modifier une série conserve les exceptions ; un changement de cadence/départ/fin qui
rendrait leur date d’origine invalide est **refusé**, sans suppression silencieuse.
Transformer en événement simple une série ayant des exceptions est également refusé.

La fiche propose « Cette occurrence uniquement » ou « Toute la série » avant modification
ou annulation. L’annulation est un statut CANCELLED, visible avec le filtre dédié.
L’annulation de série prévaut sur toutes ses exceptions. Pas de restauration dans l’UI actuelle.

« Cette occurrence et les suivantes » est reporté : une future RPC pourra scinder la
définition en deux événements et transférer les exceptions futures dans une transaction.
Les identités `events.id` + date d’origine et les associations séparées rendent ce travail
possible sans matérialiser toutes les occurrences. Le découpage n’est pas implémenté ici.

## Participants

ALL représente toute la Chiro et impose une liste d’associations vide ; SELECTED exige
au moins un membre. Les doublons et UUID inexistants sont refusés côté DB.
Un nouveau participant doit être actif. Un membre déjà associé peut rester après archivage,
et demeure affiché avec la mention « archivé ». Après retrait enregistré, il ne peut être
réintroduit tant qu’il est archivé. La création ne propose que les membres actifs.

L’audience décrit qui est concerné ; elle ne restreint pas la visibilité de l’événement
et n’accorde aucun droit d’édition. Tous les lecteurs Agenda peuvent lire les événements.

## Permissions et sécurité

| Rôle APP | Lire | Créer | Modifier | Annuler |
| --- | --- | --- | --- | --- |
| APP_ADMIN | oui | oui | oui | oui |
| RESPONSIBLE | oui | oui | oui | oui |
| TREASURER | oui | non | non | non |
| MEMBER | oui | non | non | non |

Permissions : `events.read/create/update/delete`, toujours avec `app.access`.
Aucun droit SITE ajouté. Un administrateur SITE sans rôle APP reste exclu.

RLS activée sur les cinq tables. Les policies SELECT exigent `events.read` et `app.access`.
Aucun INSERT/UPDATE/DELETE direct n’est accordé à `authenticated`, même APP_ADMIN.
Les catalogues sont administrés par migrations ; les trois RPC constituent la seule
interface d’écriture client :

- `save_agenda_event` : création avec `events.create`, modification avec `events.update` ;
  valide et enregistre événement + participants (+ rappels initiaux) dans la même transaction.
- `save_agenda_occurrence` : `events.update`, vérifie la date d’origine, puis enregistre
  une exception ciblée et actualise la révision du parent.
- `cancel_agenda_event` : `events.delete`, annule l’événement/série ou une seule occurrence.

Modifier un payload `status` ou `created_by` ne contourne rien : les RPC ignorent ces champs
d’audit/autorisation. `auth.uid()` définit les acteurs. Les fonctions SECURITY DEFINER ont
un `search_path` vide, des références qualifiées et EXECUTE révoqué au PUBLIC/anon.
Les aides internes ne sont pas exécutables par les clients.

Les mutations verrouillent l’événement et comparent `expected_revision`. Chaque modification,
y compris une exception, incrémente la version : un formulaire périmé reçoit une erreur
de conflit (40001) et conserve les champs saisis. Aucun retry automatique qui écraserait
un autre changement. Les erreurs de validation annulent intégralement la transaction.

## Rappels : données uniquement

Modes préparés : OFFSET (minutes avant), LOCAL_TIME (jours civils avant et heure locale),
ABSOLUTE (`scheduled_at` en timestamptz). Contraintes empêchant de mélanger les modes.
Les séries pourront appliquer les rappels relatifs à chaque occurrence effective.

À la création, des lignes LOCAL_TIME à **19:00 Bruxelles** sont enregistrées :

- activité : J−1 ;
- weekend : J−7 et J−1 ;
- camp : J−14, J−7 et J−1.

19:00 est aussi le choix initial pour weekends/camps, ajustable dans une phase ultérieure.
Ces valeurs ne sont pas recalculées lors d’un changement de catégorie et n’ont pas encore
d’éditeur. Aucun worker, cron, notification_jobs, VAPID ou Web Push. Le futur moteur devra
respecter les annulations et les déplacements d’occurrences avant de planifier un envoi.

## Interface et dépendances

`AgendaPage` orchestre uniquement le domaine ; formulaires, fiche, vues, données,
validation, récurrence et dates restent séparés. Le shell existant est réutilisé.
La logique Agenda et Temporal sont chargés par import dynamique à l’ouverture de l’onglet.
Mesure du build avec configuration Auth factice locale : chunk Agenda (UI + Temporal)
198 767 octets brut, 54 200 octets gzip. Le projet conserve sa configuration existante
sans minification ; ce poids n’est pas ajouté au chargement initial de l’administration.

Pas de bibliothèque calendrier : une table mensuelle et une liste couvrent le besoin
sans dépendance React. La vue semaine est reportée ; les vues consomment déjà des occurrences
développées sur une fenêtre civile, réutilisables pour une fenêtre de sept jours.

La seule nouvelle dépendance de production est
[`@js-temporal/polyfill`](https://github.com/js-temporal/temporal-polyfill), pour les dates
civiles, instants, fuseaux IANA et politiques DST explicites. Aucun React ajouté.
`playwright-core` est une dépendance de développement ; il pilote le navigateur déjà installé.

Les listes DB sont lues par pages de 500, avec ordre stable. Cette version charge les
définitions et exceptions puis développe la fenêtre côté client. Pour une forte volumétrie,
une API de fenêtre/snapshot côté serveur sera préférable ; ce n’est pas une matérialisation
de toutes les occurrences.

## Migration et mise en service

Nouvelle migration : `20260923000100_app_agenda.sql`, additive, après :

1. `20260922000100_neutral_site_role.sql` ;
2. `20260922000200_app_members_rbac.sql`.

Elle ne crée aucun événement réel et ne promeut aucun compte : seules les permissions
des rôles APP système existants sont étendues. Bootstrap `schema.sql` synchronisé ; tests
vérifiant la correspondance exacte de chaque section avec sa migration versionnée.

**Aucune migration distante exécutée.** Les trois migrations sont testées dans PostgreSQL
embarqué éphémère (PGlite). L’état distant doit être contrôlé avant une application autorisée.
Ne pas rejouer `schema.sql` ou le seed historique sur une installation existante.

## Vérification et données de démonstration

- `npm test` : dates civiles/UTC, DST été/hiver, récurrences, limites, exceptions, annulations,
  tests RLS des rôles et permissions séparées, acteurs, participants archivés/inexistants/
  doublons, atomicité et révisions périmées ; protections historiques SITE/APP conservées.
- `npm run check`, `npm run build`, `npm run test:smoke`, `git diff --check`.
- `npm run test:agenda:browser` : Chromium/Edge headless, desktop et smartphone 390 px,
  vrai composant Agenda branché sur les RPC SQL dans PGlite via un transport loopback de test.
  Création, participants, déplacement/annulation d’occurrence, édition de série, mode lecture
  seule et absence de débordement horizontal en liste. Captures dans `.test-artifacts/` (ignoré Git).
  Définir `AGENDA_BROWSER_PATH` si le navigateur n’est pas trouvé automatiquement.

La fixture navigateur crée uniquement des identités `example.test` et des exemples éphémères
(activité dimanche, réunion, weekend, camp, série). Ces données sont hors routes de production
et disparaissent à l’arrêt. Aucun compte réel, email ou endpoint Supabase distant utilisé.
Le harnais simule Auth/Storage et le transport ; il ne teste pas GoTrue/PostgREST en staging.

Résultats exécutés le 23 septembre 2026 : 30 tests réussis ; `check` sur 92 fichiers sans
erreur ni avertissement ; build Netlify réussi ; 14 contrôles HTTP réussis ; parcours
navigateur desktop/mobile réussi ; `git diff --check` sans erreur. Commandes npm exécutées
via `npm.cmd` sous Windows (le wrapper PowerShell est bloqué par la politique d’exécution).
Le build a aussi été exécuté avec URL Supabase factice `http://127.0.0.1:9` et clé de test,
afin de compiler les écrans authentifiés qui peuvent être éliminés quand la configuration
Supabase manque. Aucun secret réel utilisé ; ce build de validation n’est pas un déploiement.

## Suite possible

Les futures tâches pourront référencer `events.id` et `members.id` par FK. Pour une tâche
liée à une occurrence précise, conserver aussi sa date d’origine plutôt qu’un instant
susceptible de changer. Aucun schéma Tasks ni lien financier n’a été ajouté.

Avant la prochaine phase : appliquer et valider l’Agenda en staging avec les vrais JWT,
PostgREST et profils ; décider ensuite de la priorité entre Tasks et les améliorations
Agenda reportées (scission de série, restauration, vue semaine, rappels configurables).
