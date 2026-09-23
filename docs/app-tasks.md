# Phase 3 — Tâches et Todo personnel

> Phase 5 : rappels éditables, planner serveur et Web Push ajoutés dans [Notifications](app-notifications.md).
> Les mentions « sans moteur d’envoi » ci-dessous restent le bilan historique de Phase 3.

> Rapport historique de Phase 3. La [Phase 4 Comptes](app-finance.md) ajoute le suivi financier
> APP indépendant ; les limites de périmètre ci-dessous décrivent la livraison Tasks.

## Périmètre

Navigation APP : Accueil / Agenda / Tâches / Membres. Domaine indépendant dans
`src/features/app/tasks`, chargé dynamiquement depuis le shell Preact existant.
Cette phase ne modifie pas la finance historique et ne crée pas de nouveau module financier,
de Push, PWA, messagerie, documents, sous-tâches ou récurrence de tâches.

## Modèle et identités

- `tasks` : scope PERSONAL/TEAM, titre, description facultative, statut
  TODO/IN_PROGRESS/DONE/CANCELLED, priorité LOW/NORMAL/HIGH/URGENT, échéance typée,
  éventuel lien Agenda, acteurs Auth, horodatages et `revision`.
- `task_members` : clé unique `(task_id, member_id)`, rôle LEAD/CONTRIBUTOR,
  état individuel TODO/DONE, horodatages. Les associations métier utilisent `members.id`.
- `task_activity` : action, acteur authentifié, date et métadonnées minimales.
- `task_reminders` : données de rappels, sans moteur d’envoi.

Une tâche TEAM nécessite au moins un LEAD. Le rôle est exclusif : promouvoir un contributeur
modifie son association et conserve son état individuel. Les responsables comptent eux aussi
dans la progression calculée, jamais stockée. Aucun privilège APP global ne découle d’un rôle
LEAD. Un MEMBER peut donc gérer une tâche qu’il dirige sans devenir RESPONSIBLE.

Les FK métier utilisent RESTRICT. Pas de suppression physique dans l’interface ou les RPC.
Les membres archivés déjà affectés restent visibles et peuvent être conservés ; une nouvelle
affectation ou leur réintroduction après retrait est refusée. L’archivage n’annule pas les
droits de leur compte : convention héritée de Membres, les rôles se révoquent séparément.

## Confidentialité et permissions

Toutes les opérations nécessitent `app.access`. Aucun droit SITE n’est accordé.

| Identité APP | PERSONAL | Lecture TEAM | Création TEAM | Gestion TEAM |
| --- | --- | --- | --- | --- |
| APP_ADMIN | ses propres tâches | toutes | oui | toutes |
| RESPONSIBLE | ses propres tâches | toutes | oui | créées par lui ou dirigées |
| MEMBER / TREASURER | ses propres tâches | affectations | non | seulement comme LEAD |

Une tâche PERSONAL appartient à `owner_member_id` **et** au compte authentifié
`owner_user_id` à sa création. Lire/modifier exige les deux correspondances ; même un
APP_ADMIN qui relie le membre à son propre compte ne récupère pas ses tâches privées.
Un membre actif lié au compte est nécessaire à la création. Le scope est immuable,
sans association de collaborateurs ni lien Agenda pour PERSONAL. Une suppression de compte
laisse les tâches privées orphelines, inaccessibles par les clients : aucun transfert automatique.
Cette confidentialité concerne les rôles applicatifs ; les opérateurs DB privilégiés restent
hors de la frontière RLS, comme pour toutes les données Supabase.

Trois permissions ajoutées : `tasks.create_team`, `tasks.read_all`, `tasks.manage_all`.
RESPONSIBLE obtient les deux premières, APP_ADMIN les trois. Un créateur ayant conservé
`tasks.create_team` peut modifier sa tâche, mais la clôture TEAM exige **LEAD ou manage_all**.
Un contributeur ne modifie que son propre état ; un gestionnaire global non affecté ne
peut pas marquer la partie d’un autre membre terminée.

SELECT sous RLS pour les quatre tables, avec la même visibilité que leur tâche parente.
Pas de droits INSERT/UPDATE/DELETE directs, y compris pour APP_ADMIN.
`can_read_task` et `can_manage_task` sont des aides sans fuite sur les tâches privées.
Les fonctions SECURITY DEFINER ont un `search_path` vide, les droits PUBLIC/anon révoqués
et des références SQL qualifiées. Le calcul interne du membre n’est pas exposé aux clients.

## Écritures, progression et audit

`save_task` valide et écrit atomiquement tâche, associations, rappels initiaux et audit.
`set_my_task_work_status` déduit le membre depuis `auth.uid()`, modifie sa seule association,
journalise l’action et incrémente la révision du parent. Le statut global reste inchangé,
même lorsque tous les participants ont terminé. Une tâche annulée refuse les actions individuelles.
Une tâche globalement terminée peut encore recevoir une correction d’état individuel.

Les deux RPC verrouillent la tâche et comparent `expected_revision`. Une version périmée
produit le conflit 40001 ; le formulaire garde la saisie et demande de fermer, actualiser puis
reprendre la modification. Pas d’écrasement automatique. Acteurs et propriétaires viennent
de l’identité authentifiée, jamais des valeurs envoyées par le navigateur.

Actions : TASK_CREATED, TASK_UPDATED (noms des champs), STATUS_CHANGED, TASK_CANCELLED,
MEMBER_ADDED, MEMBER_REMOVED, MEMBER_ROLE_CHANGED, MEMBER_WORK_COMPLETED,
MEMBER_WORK_REOPENED. Métadonnées : membre concerné, anciens/nouveaux codes lorsque pertinent.
Pas de copie intégrale du contenu. Historique append-only pour tous les utilisateurs APP,
avec les 100 dernières actions affichées. Retirer un membre ne supprime pas son historique.

## Échéances et Agenda

- Aucune échéance : deux colonnes NULL.
- Date seule : `deadline_date` en `date`, journée de Bruxelles entièrement incluse.
- Date et heure : `deadline_at` en `timestamptz`, saisie/affichage Europe/Brussels.

Les colonnes sont mutuellement exclusives et les dates bornées à 2000–2100, comme Agenda.
Les helpers Temporal d’Agenda sont réutilisés. Une heure locale ambiguë/inexistante lors du
changement d’heure est refusée ; les instants explicites API sont non ambigus.
Le retard concerne seulement les tâches actives après leur échéance, avec un libellé textuel.

Le lien facultatif utilise `events.id` et la **date locale d’origine** d’une occurrence.
Pas de FK vers une occurrence virtuelle. Un nouveau lien est validé côté DB et client.
Un lien inchangé reste conservé après annulation de l’événement ou évolution de sa série.
Il n’est pas déplacé automatiquement ; l’interface montre l’origine et les annulations.

## Interface et Accueil

Mes tâches regroupe PERSONAL et affectations TEAM ; Je supervise filtre les LEAD ;
Toutes présente les TEAM avec permission globale. Une vue terminées/annulées conserve
l’accès à l’historique. Recherche, statut, priorité, échéance et événement sont filtrables.
Les filtres sont initialement repliés sur mobile. Tri : actives en retard, échéances proches,
priorité à échéance égale, sans échéance, puis tâches closes.

Fiche, création, édition, action rapide « J’ai terminé » / retour à faire, annulation et
confirmation de clôture si des parties restent ouvertes. Libellés français, labels de champs,
focus visible, cibles de 44 px et information textuelle complémentaire aux couleurs.
L’Accueil affiche au maximum cinq tâches actives du membre courant, avec leurs échéances
et le retard, puis un accès à Mes tâches. Les autres TEAM lisibles globalement n’y figurent pas.

## Rappels préparés

Modes OFFSET (minutes avant), LOCAL_TIME (jours civils avant et heure Bruxelles), ABSOLUTE
(instant personnalisé), protégés par contraintes. À la création/changement d’échéance :
date seule → J−1 à 19:00 Bruxelles ; date et heure → 1440 minutes avant ; aucune → aucune ligne.
Ces valeurs sont uniquement des données, sans éditeur pour l’instant. Les defaults sont remplacés
si l’échéance change. Avant d’ajouter des préférences personnalisées, adapter cette synchronisation.
Aucune notification, queue, cron, Web Push ou configuration VAPID.

## Migration et vérification

Migration additive `20260923000200_app_tasks.sql`, après les migrations neutral_site_role,
app_members_rbac et app_agenda. `schema.sql` contient la même section pour une base vide.
Aucune attribution de rôle à un compte ni création de données réelles. **Aucune exécution distante.**

- `npm test` : tests TypeScript et PostgreSQL réel PGlite ; confidentialité, droits,
  mutations, associations, révisions, audit, liens Agenda, échéances et DST.
- `npm run check`, `npm run build`, `npm run test:smoke`, `git diff --check`.
- `npm run test:tasks:browser` : vrai composant Preact, transport loopback, SQL/RLS PGlite,
  Edge/Chromium installé (`TASKS_BROWSER_PATH` facultatif). Desktop et mobile 390 px,
  multi-responsables, état individuel, confidentialité admin, conflit, audit, clôture et dashboard.
  Captures dans `.test-artifacts/`, ignorées Git.

Le harnais simule Auth et le transport HTTP : il ne remplace pas une recette GoTrue/PostgREST
sur un environnement Supabase de staging. Aucun serveur distant n’est utilisé. Aucune nouvelle
dépendance : Temporal, PGlite et Playwright déjà présents sont réutilisés.

Résultats exécutés le 23 septembre 2026 : **37 tests réussis**, `check` sur 106 fichiers
sans erreur, avertissement ou hint ; build standard et build avec Auth activé par configuration
locale factice réussis ; 14 contrôles HTTP smoke réussis ; tests navigateur Tâches et Agenda
réussis ; `git diff --check` sans erreur. La configuration factice reste limitée au processus
de build ; aucun fichier d’environnement ni paramètre distant n’a été modifié.

## Limites et suite

Les lectures utilisent des pages stables de 500 puis filtrent côté client. Une forte volumétrie
nécessitera un filtrage/pagination serveur, notamment pour l’Accueil. Le retard est recalculé
au rendu/actualisation ; pas d’abonnement temps réel ni de minuterie de minuit.

Prochaine étape : recette multi-comptes sur staging après application autorisée de la migration.
Pour une future Finance, `members.id` pourra identifier le membre d’une opération sans
dépendre de l’existence d’un compte Auth. Aucun modèle ou écran Finance n’est ajouté ici.
