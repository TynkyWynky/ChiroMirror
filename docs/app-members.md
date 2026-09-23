# Phase 1 — Membres et permissions APP

> La [Phase 2 Agenda](app-agenda.md) ajoute l’Agenda et traduit les écrans APP en français.
> Les libellés néerlandais cités ci-dessous correspondent à la livraison Phase 1.

## Modèle et accès

`auth.users` représente le compte de connexion ; `profiles.role` reste exclusivement SITE.
`members.id` identifie une personne Chiro, même sans compte. Le lien facultatif
`members.user_id` est unique et pointe vers Auth ; supprimer un compte conserve le
membre et retire son lien. Aucun compte ou membre n'est créé et aucun rôle APP n'est attribué par migration.

Les noms sont obligatoires, sans espaces de début/fin, limités à 100 caractères.
Les dates sont générées par PostgreSQL ; les clients ne peuvent pas les écrire.
L'index `(active, last_name, first_name, id)` accompagne le filtre et le tri.
Les listes sont paginées lors du chargement pour dépasser la limite PostgREST usuelle.
L'archivage conserve l'identité métier et **ne révoque pas les rôles du compte**.
Retirer les rôles est une opération administrative distincte.

| Rôle | Permissions initiales |
| --- | --- |
| APP_ADMIN | app.access, members.read, members.manage, roles.read, roles.manage |
| RESPONSIBLE | app.access, members.read |
| TREASURER | app.access, members.read |
| MEMBER | app.access, members.read |

`app_user_roles` rattache plusieurs rôles à un compte, même sans membre. Les permissions
effectives sont l'union distincte de `app_role_permissions`. Les catalogues sont système :
pas d'éditeur de rôles ou de permissions arbitraires dans cette phase.

## RLS et API

- Toutes les tables APP ont RLS activée et des grants explicites.
- `members` : SELECT exige `app.access` et `members.read` ; INSERT/UPDATE exigent
  `app.access` et `members.manage`. Aucun grant/policy DELETE.
- `app_user_roles` : chacun lit ses associations ; `roles.read` permet les autres.
- `app_roles` et `app_role_permissions` : chacun lit ses propres rôles/matrice ;
  `roles.read` donne la vue complète. `app_permissions` est un catalogue lisible avec accès APP.
- Aucune écriture directe des catalogues ou des associations n'est accordée au client.
- `set_app_user_roles` contrôle `app.access` et `roles.manage`, valide les clés et le compte,
  puis remplace les associations dans une transaction. Un verrou sérialise ces mutations ;
  les droits sont revérifiés après le verrou. La RPC refuse le retrait du dernier gestionnaire.
- `get_my_app_access` retourne uniquement les droits et le membre de l'appelant.
- `complete_app_member_invitation` exige les permissions de gestion des membres et rôles,
  verrouille le membre, refuse une liaison déjà présente et enregistre lien/rôles atomiquement.
  Une double liaison ou une attribution invalide annule les deux opérations.
- `list_app_accounts` exige `members.manage` ou `roles.manage`, ainsi que `app.access`.
  Elle lit l'email Auth, jamais un email de profil librement saisi. Elle retourne les comptes
  dotés d'un profil et leur lien éventuel pour exclure du sélecteur ceux déjà liés ailleurs.
- Les fonctions privilégiées ont un `search_path` vide, des références qualifiées et
  des droits EXECUTE limités à `authenticated`. Elles n'acceptent pas d'identité d'acteur fournie par le client.
- Le service role reste côté serveur, uniquement pour vérifier Auth et envoyer l'invitation.
  La vérification des permissions de cette API utilise le JWT de l'appelant.

Le filtrage de navigation améliore l'UX ; les règles PostgreSQL sont la frontière d'autorisation.
Une migration absente ou un échec de lecture ferme l'accès APP et affiche une erreur ; le SITE
continue son chargement séparément. Le bouton de rafraîchissement recharge les permissions.

## Interface

APP contient Accueil et Leden (Membres). Recherche prénom/nom, filtre actif/inactif/tous,
création, édition, liaison facultative, confirmation d'archivage et réactivation.
Les comptes autorisés voient les rôles des membres et peuvent gérer les rôles de tous les
comptes, y compris sans membre. États de chargement, absence de résultats, erreur et succès inclus.
Le shell existant est conservé ; les formulaires, données et contrôles d'accès sont séparés.

## Invitations : liaison exacte et reprise manuelle

1. Créer le membre, puis le sélectionner dans le formulaire d'invitation avec son email et
   ses rôles APP. L'API exige `members.manage` et `roles.manage`, valide la sélection et
   vérifie que le membre n'a pas encore de compte avant tout envoi.
2. Supabase invite le compte ; l'API récupère son UUID exact puis appelle
   `complete_app_member_invitation` avec le JWT de l'administrateur. La liaison et les rôles
   sont enregistrés ensemble. Tout rôle SITE autre que `none` est refusé par l'API.

La création Auth et l'envoi d'email sont externes à la transaction métier. Si la dernière
étape échoue, l'API répond 409 avec l'UUID exact du compte créé et un message de reprise ;
aucune attribution partielle ne subsiste. L'interface recharge les comptes et demande une
liaison via « Lid bewerken » puis une attribution via « APP-rollen van accounts », après
vérification administrative de l'identité. Ne pas renvoyer l'invitation. Si le compte existe
déjà ou si une réponse est perdue, vérifier également la liste avant une nouvelle action.
Aucun rapprochement par nom/email n'est exécuté. L'unicité DB protège les doubles liaisons,
y compris concurrentes. L'invitation ne donne jamais de droits SITE ; un nouveau compte
dont la finalisation échoue reste sans droits APP.

Les templates email et URL de redirection Auth existants sont réutilisés. Aucun email réel
n'a été envoyé pendant les tests. Le parcours complet d'activation reste à vérifier en staging.

## Migrations et bootstrap

Voir [la procédure SQL](../supabase/README.md). Ordre impératif :

1. `20260922000100_neutral_site_role.sql` ;
2. `20260922000200_app_members_rbac.sql`.

La seconde migration vérifie le défaut neutre de `profiles.role` avant de créer les tables.
Cette vérification n'est pas une preuve de concordance complète du schéma distant : inspecter
l'historique et les fonctions actives avant application. `schema.sql` inclut la même fondation
pour une base vide ; un test empêche la divergence de sa section APP avec la migration.

État au 23 septembre 2026 : les deux migrations ont été exécutées dans les tests PGlite
éphémères. **État distant non vérifiable dans cet environnement, aucune modification distante.**
Aucun fichier de configuration locale de connexion ni outil Supabase dédié n'est disponible.
L'ancien rapport indiquait Phase 0 non appliquée : ne pas présumer qu'elle l'est devenue.

Le premier APP_ADMIN doit être attribué par un opérateur DB autorisé à un UUID vérifié,
après migration et validation explicite. Le rôle SITE de ce compte est sans incidence.
Exemple à adapter, à exécuter manuellement dans l'environnement validé :

```sql
begin;
-- Remplacer l'UUID exemple après vérification indépendante de l'identité Auth.
insert into public.app_user_roles (user_id, role_key)
values ('00000000-0000-0000-0000-000000000000', 'APP_ADMIN')
on conflict (user_id, role_key) do nothing;
commit;
```

La FK empêche un UUID inexistant. Aucun éditeur ou admin SITE n'est promu automatiquement.
Le bootstrap n'ajoute aucun membre. Ensuite l'APP_ADMIN gère les attributions via l'interface.

## Validation et limites

`npm test` inclut des tests de navigation/validation/API ainsi qu'une vraie exécution SQL
dans PostgreSQL embarqué PGlite, sans réseau. Le harnais reproduit `auth.uid()`, les rôles
anon/authenticated et les tables Auth/Storage minimales. Il exécute le schéma SITE et les
deux migrations. Il ne reproduit pas GoTrue, PostgREST, SMTP ou les transactions concurrentes
multi-connexions. `gen_random_uuid` est fourni par PostgreSQL ; seule la déclaration de
l'extension pgcrypto est omise dans ce harnais.

Les tests couvrent les quatre rôles, les comptes sans rôle, SITE admin seul, APP admin neutre,
les refus anonymes, création/édition/archivage/réactivation, double liaison, validation DB,
écriture directe interdite, rôles multiples, union, retrait et dernier gestionnaire,
ainsi que finalisation d'invitation et rollback des rôles en cas de conflit de liaison.
`npm run test:smoke` contrôle les routes HTTP existantes sans Supabase ; ce n'est pas un test
d'interactions navigateur. Vérifier en staging le rendu mobile, l'activation email et le parcours complet.

Le garde-fou du dernier gestionnaire s'applique à la RPC APP. Une suppression Auth par un
opérateur privilégié ou le mécanisme historique SITE de suppression d'un compte peut retirer
ses associations par cascade. Ce flux historique reste à revoir avant une séparation complète
de l'administration du cycle de vie des comptes ; les permissions métier SITE/APP sont distinctes.

Validation exécutée le 23 septembre 2026 : `npm test` (22 tests réussis), `npm run check`
(78 fichiers, aucune erreur/avertissement), `npm run build` (bundle Netlify réussi),
`npm run test:smoke` (14 contrôles HTTP réussis). Sous PowerShell, utilisation de `npm.cmd`
car la politique d'exécution bloque le wrapper `npm.ps1`.

## Modules futurs

Agenda et tâches pourront référencer `members.id` par FK. Les rôles LEAD/CONTRIBUTOR seront
propres à l'association tâche/membre, avec plusieurs responsables possibles. Les finances
devront définir leurs propres règles de confidentialité ; ni APP_ADMIN ni TREASURER ne
reçoivent aujourd'hui de permission financière APP. Aucun de ces modules n'est implémenté.
