# SQL versionné

La Phase 5 ajoute `20260923000400_app_notifications.sql` **après Finance** : centre privé,
préférences, appareils Push, jobs/deliveries et reconstruction transactionnelle. Bootstrap
synchronisé, RLS sans exception APP_ADMIN, RPC serveur réservées au worker. Exécutée
uniquement en PostgreSQL éphémère local. Voir [architecture et recette Notifications](../docs/app-notifications.md).

La Phase 4 ajoute `20260923000300_app_finance.sql` **après Tasks** : moteur Comptes indépendant
de `finance_transactions`, entités financières, parts, obligations, paiements, audit et RLS.
Seul TREASURER reçoit les droits de trésorerie ; aucun rôle n’obtient de lecture privée globale.
Voir [modèle, confidentialité et règles Comptes](../docs/app-finance.md). Bootstrap synchronisé ;
migration exécutée uniquement dans les bases éphémères de test, jamais à distance.

La Phase 3 ajoute `20260923000200_app_tasks.sql` **après Agenda** : tâches personnelles
privées, équipes, progression, audit, rappels préparés et RLS. Bootstrap synchronisé.
Voir [modèle et permissions Tâches](../docs/app-tasks.md). Testée uniquement en PGlite local ;
aucune exécution distante. Appliquer les migrations manquantes dans leur ordre versionné.

La Phase 2 ajoute `20260923000100_app_agenda.sql`, **après les deux migrations Phase 0/1**.
Elle crée l’Agenda et étend uniquement les rôles APP existants. Bootstrap synchronisé.
Voir [modèle Agenda, récurrence, RLS et limites](../docs/app-agenda.md).
Cette migration a uniquement été exécutée en base éphémère de test, jamais à distance.

La Phase 1 ajoute `20260922000200_app_members_rbac.sql` après la migration neutre Phase 0.
Elle crée membres, catalogues RBAC, associations, contraintes, RLS et RPC sans attribuer
aucun rôle ni créer de membre. Voir [architecture et bootstrap APP](../docs/app-members.md).
Les deux migrations sont testées en PostgreSQL embarqué éphémère ; leur état distant reste
non vérifié. Aucune base distante n'a été modifiée. Pour une base existante, appliquer les
migrations manquantes dans l'ordre après inspection de l'historique et validation de l'environnement.

`schema.sql` décrit l'installation complète d'une **nouvelle base vide**.
Il ne doit plus être rejoué pour mettre une base existante à jour.
`scripts/seed-supabase.mjs` supprime des contenus et messages : ce n'est ni une migration ni une sauvegarde.

## Convention

- `migrations/YYYYMMDDHHMMSS_description.sql` : évolution incrémentale, ordonnée et relue.
- Ne jamais modifier une migration déjà appliquée ; ajouter un nouveau fichier.
- Garder le bootstrap cohérent pour les nouvelles installations.
- Aucune commande de migration n'est intégrée au build, au démarrage ou à npm install.
- Les données réelles, l'historique distant des migrations et les privilèges doivent être inspectés avant la première adoption.

## Migration de cette phase

`20260922000100_neutral_site_role.sql` :

1. transaction SQL ; vérifie la présence de la contrainte attendue ;
2. étend les rôles SITE à `none`, `editor`, `admin` ;
3. change le défaut en `none` et impose ce rôle dans le trigger de création Auth ;
4. conserve les rôles des profils déjà présents ; ignore les rôles dans les métadonnées utilisateur ;
5. exige le rôle `editor` en plus du groupe affecté pour la finance existante (ou `admin`).

Aucun UPDATE/DELETE de données existantes, aucune migration de Storage, aucune table métier APP.
La contrainte sera validée sur les lignes existantes : une valeur de rôle inconnue provoque un rollback.
Un ancien profil `admin`/`editor` garde les mêmes autorisations.

## Procédure pour une base existante

1. Exporter/sauvegarder la base et relever les paramètres Auth, policies, grants, triggers et définitions des fonctions concernées. Vérifier que le schéma correspond au repository, notamment `profiles_role_check`, `on_auth_user_created`, `is_site_editor` et `is_site_admin`.
2. Comparer la migration avec toute modification distante. Elle remplace deux fonctions : ne pas écraser une logique personnalisée inconnue.
3. Tester sur une copie isolée. Le contrôle de contrainte prend un verrou ; choisir une fenêtre appropriée.
4. Appliquer uniquement cette migration, dans une transaction, avec le rôle d'administration DB. Ne pas exécuter le seed ou le bootstrap.
5. Vérifier qu'un nouveau compte obtient `none`, qu'il peut lire son seul profil, et qu'il ne peut ni modifier le contenu ni lire les messages/finances. Tester admin et éditeur avec/sans groupes. Tester une création Auth contenant une métadonnée `role: admin` : le profil doit rester `none`.
6. Déployer le frontend/API compatible avec `none` immédiatement après la migration. Avant celle-ci, les invitations neutres ne fonctionneront pas sur l'ancienne contrainte. Pendant la transition, suspendre les invitations.
7. Relever le fichier/version, date, opérateur, environnement et résultat dans le journal de déploiement.

Les fichiers suivent le format Supabase CLI. Si la CLI est adoptée, inspecter d'abord son historique distant et établir le baseline ; prévisualiser les migrations en attente avant application. Ne pas marquer arbitrairement des versions comme appliquées. Une application manuelle devra être réconciliée avec cet historique avant un futur push CLI.

## Nouvelle base

Exécuter le bootstrap actuel uniquement sur une base vide. Les changements de cette migration y sont déjà inclus. Pour démarrer un suivi CLI, vérifier la correspondance du bootstrap puis enregistrer le baseline avec la procédure de l'équipe ; ne pas rejouer l'ancien seed en production.

## Retour arrière

Ne pas reconvertir les profils `none` en `editor` et ne pas rétablir le défaut permissif.
Préférer une correction incrémentale. Un retour applicatif doit continuer à comprendre les comptes sans droits SITE.

## État de livraison

Migration préparée, **non exécutée sur une base distante**. Les tests TypeScript ne prouvent pas son application ni les policies réellement actives. Les inscriptions publiques Supabase doivent rester désactivées tant qu'une politique d'admission APP n'est pas définie ; aucun écran d'inscription n'a été ajouté.
