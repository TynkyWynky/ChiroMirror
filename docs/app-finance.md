# Phase 4 — APP Comptes

> Phase 5 : [Notifications](app-notifications.md) ajoute le moteur Agenda/Tâches et Web Push.
> Le présent rapport décrit la Phase 4. Finance ne produit toujours aucune notification.

## Périmètre et séparation SITE

Suivi interne en EUR : dettes directes, dépenses partagées, obligations et remboursements.
Le moteur est indépendant de `finance_transactions` et de l’interface comptable SITE,
qui conservent leurs données, policies et parcours. Aucune copie ou migration de leurs opérations.
Pas de banque, transfert d’argent, justificatif, upload, document, Push, PWA ou messagerie.

## Tables

| Table | Responsabilité |
| --- | --- |
| `app_financial_entities` | MEMBER → `members.id`, ou CHIRO sans membre |
| `app_finance_transactions` | origine EXPENSE / DIRECT_DEBT, montant, motif, date, visibilité, révision |
| `app_expense_shares` | part de chaque entité, clé unique transaction + entité |
| `app_finance_obligations` | débiteur, créancier, montant original strictement positif |
| `app_finance_payments` | paiement déclaré séparé, acteurs, date, montant, état et éventuelle annulation |
| `app_payment_allocations` | montant d’un paiement affecté à une obligation |
| `app_finance_activity` | audit append-only pour les utilisateurs APP |

Une seule entité CHIRO est créée par migration, protégée par un index unique partiel.
Chaque membre existant obtient une entité MEMBER unique ; un trigger contrôlé en crée une
pour chaque nouveau membre. Aucun faux membre Chiro et aucune architecture multi-organisation.
Les utilisateurs n’ont aucun droit d’écriture directe sur ces tables. Les FK métier utilisent
RESTRICT : les opérations et identités financières ne disparaissent pas lors d’un archivage.
Supprimer un compte Auth conserve les membres, les opérations et met ses références d’audit à NULL.

Une DIRECT_DEBT possède un débiteur et un créancier distincts, sans parts ni payeur.
Une EXPENSE possède un payeur et un mode EQUAL/CUSTOM_AMOUNT. Chaque part positive d’une
autre entité devient une obligation envers le payeur. Sa propre part ne génère jamais de dette
envers lui-même. Une part à zéro conserve la participation, sans obligation de zéro centime.

## Exactitude monétaire

La DB utilise **bigint en centimes**, bornés à 999 999 999 999 par montant individuel
(9 999 999 999,99 €). Cela reste exactement représentable dans le JSON numérique de PostgREST.
Les valeurs reçues sont validées puis converties en `bigint` JavaScript ; tous les calculs de
montants, parts, paiements et soldes utilisent exclusivement `bigint`. Les totaux peuvent
dépasser la limite d’un nombre JavaScript sans perdre de précision. Les payloads RPC envoient
des **chaînes de centimes entiers**, jamais un bigint non sérialisable ou un montant flottant.

`money.ts` centralise saisie, contrôle des bornes et formatage français/belge. `0,10 + 0,20`
donne exactement 30 centimes. Les négatifs, exposants, décimales au-delà du centime et valeurs
non finies sont refusés. Le SQL vérifie les textes avant conversion bigint, évitant tout arrondi
implicite d’un JSON fractionnaire. Seules les parts personnalisées peuvent valoir zéro.

EQUAL trie les UUID d’entités en ordre croissant, attribue le quotient entier, puis un centime
aux premières entités jusqu’à épuisement du reste. L’ordre de sélection dans l’UI n’intervient pas.
14782 / 4 donne 3696, 3696, 3695, 3695 ; 1 / 2 donne 1, 0. Le client prévisualise et la DB recalcule.
CUSTOM_AMOUNT exige une somme exactement égale au total, sans doublon ou part négative.
PERCENTAGE n’est pas implémenté ; un futur mode pourra compléter le même moteur de parts.

## Soldes et instantané

`balances.ts` calcule, par obligation : original − allocations de paiements ACTIVE.
Une origine CANCELLED ne contribue plus aux soldes. Aucun champ `members.balance` ni compteur
de solde n’est stocké. Deux directions entre les mêmes membres restent deux créances distinctes.
« À payer » et « À recevoir » sont toujours séparés, y compris par contrepartie ; le net
est calculable mais n’occulte pas ces deux totaux dans l’interface.

`get_app_finance_snapshot` lit entités, membres, opérations, parts, obligations, paiements et
allocations dans une seule instruction SQL stable. Cet instantané MVCC empêche de mélanger
des données antérieures et postérieures à un paiement. La fonction est SECURITY INVOKER :
les RLS des tables s’appliquent intégralement. Le snapshot contient uniquement les opérations
autorisées. L’interface demande explicitement une actualisation en cas de conflit.

## Confidentialité et matrice

Toutes les opérations nécessitent `app.access` **et** `finance.access`.

| Rôle | Ses opérations privées | Trésorerie dont il est partie | Toute la trésorerie |
| --- | --- | --- | --- |
| MEMBER | oui | lecture | non |
| RESPONSIBLE | oui, mêmes règles que MEMBER | lecture | non |
| APP_ADMIN | oui, mêmes règles que MEMBER | lecture | non par défaut |
| TREASURER | oui, mêmes règles que MEMBER | lecture/gestion | lecture/gestion |
| SITE admin sans APP | non | non | non |

Permissions : `finance.access` pour les quatre rôles APP standards ;
`finance.treasury.read` et `finance.treasury.manage` pour TREASURER seulement.
Un administrateur peut attribuer explicitement un rôle de trésorier via le RBAC existant,
mais **APP_ADMIN ne donne aucun accès automatique aux finances privées ou à la trésorerie**.
Aucune permission `finance.private.read_all`.

PRIVATE exclut CHIRO. Une dette directe est lisible uniquement par ses deux parties.
Une dépense privée est lisible par le payeur et tous les participants sélectionnés, qui voient
le détail partagé, ses remboursements et son audit. Un participant d’une dépense ne peut pas
déclarer le paiement d’une autre personne : il doit être débiteur ou créancier de l’obligation.
Le créateur doit être l’une des parties d’une dette directe, ou le payeur d’une dépense privée.
Lui seul peut corriger/annuler l’origine privée, tant qu’il y a accès et que les règles ci-dessous
le permettent. Un rôle technique ou trésorier n’apporte aucun contournement privé.

TREASURY doit impliquer CHIRO comme débiteur, créancier, payeur ou participant.
Les personnes impliquées et les titulaires de `finance.treasury.read/manage` peuvent lire.
**Seul `finance.treasury.manage` peut créer, modifier, annuler ou enregistrer/annuler un paiement
de trésorerie**, même lorsque le membre standard est personnellement concerné.
GROUP est reporté ; les contraintes pourront être étendues dans une migration dédiée.

Toutes les tables sensibles, allocations et audit compris, suivent la visibilité de l’origine.
Les aides de lecture et les RPC vérifient l’autorisation avant de renvoyer des informations de
révision. SECURITY DEFINER : `search_path` vide, références qualifiées, EXECUTE PUBLIC/anon révoqué.
Les fonctions internes d’identité et le trigger ne sont pas exécutables par les clients.
Les opérateurs DB/service-role privilégiés restent hors de la frontière RLS applicative.

## Membres sans compte et archivage

Les obligations pointent vers une entité liée à **members.id**, pas vers auth.users.
Un membre sans compte peut participer ; la liaison ultérieure de son compte lui donne accès
à son historique. Contrairement au Todo PERSONAL lié à un compte précis, ce transfert est
intentionnel ici : le lien compte↔membre administré dans Membres fait autorité. Son attribution
est donc une opération de confiance, contrôlée par les permissions existantes.

L’archivage conserve les dettes, parts et soldes. Les personnes archivées sont exclues des
nouvelles opérations ; une personne déjà impliquée peut rester dans une correction de
l’opération avant paiement. Les remboursements historiques restent possibles. Comme dans
Membres, archiver ne révoque pas les rôles Auth : cette révocation reste une action distincte.

## Paiements et corrections

V1 : un paiement est affecté à **une obligation précise**, avec directions déduites côté DB,
montant positif, date civile et commentaire facultatif. `app_payment_allocations` prépare
les futures allocations multiples, sans automatisme FIFO ou compensation aujourd’hui.

Le débiteur ou le créancier peut déclarer un paiement privé déjà effectué, sans validation
mutuelle. L’UI affiche « Enregistré par … ». Cela ne constitue pas un transfert d’argent.
Une future validation mutuelle devra ajouter un workflow explicite avant impact sur les soldes.
Le dépassement du restant dû est refusé en DB ; l’UI indique le montant restant.
L’origine et `original_amount_cents` ne sont jamais réduits par un paiement.

- Avant tout paiement : le créateur privé ou le gestionnaire de trésorerie peut modifier
  motif, description, date, montant et distribution. Kind et visibilité restent immuables.
  La distribution précédente est journalisée avant remplacement des parts/obligations.
- Dès qu’un paiement existe, **même annulé** : toute édition de l’origine est bloquée.
  Les identifiants et montants historiques des obligations restent alors figés.
- Annuler un paiement exige un motif, les mêmes droits que son enregistrement et une
  révision valide. Le paiement et ses allocations sont conservés ; l’état CANCELLED les
  exclut du calcul. Le restant dû augmente. Un nouveau paiement corrigé peut être enregistré.
- Annuler l’origine exige un motif et **aucun paiement ACTIVE**. Les paiements erronés
  doivent donc être annulés explicitement auparavant. Les obligations et l’historique restent
  présents, sans contribution au solde. Un remplacement est une nouvelle opération explicite.
- Aucun bouton DELETE, restauration automatique ou réécriture d’un paiement.

Ces annulations corrigent des saisies ; elles ne doivent pas servir à effacer un paiement réel
sans motif. Un paiement réel en sens inverse se représente par une nouvelle dette explicite
dans l’autre direction, suivie de son remboursement, sans compensation implicite.
Une origine privée dont le créateur Auth a été supprimé n’a plus de créateur pouvant l’éditer ;
les parties conservent les droits de lecture et paiement. Une correction exceptionnelle nécessite
une procédure administrative DB séparée, pas une permission de lecture privée globale.

## Atomicité, concurrence et audit

RPC : `save_app_finance`, `record_app_finance_payment`, `cancel_app_finance_payment`,
`cancel_app_finance_transaction`. Origine + parts + obligations + audit sont atomiques.
Paiement + allocation + contrôle du restant + audit sont atomiques également.
Un échec tardif annule tout, y compris le changement de révision.

Chaque mutation verrouille d’abord l’origine, compare `expected_revision` puis recalcule les
valeurs depuis la DB. Les remboursements concurrents se sérialisent sur ce verrou ; un client
périmé reçoit 40001 et doit recharger. Même avec la nouvelle révision, un paiement supérieur
au restant recalculé est refusé. Une ancienne obligation remplacée avant paiement ne peut
pas être utilisée pour enregistrer un remboursement.

Audit : EXPENSE_CREATED, DIRECT_DEBT_CREATED, TRANSACTION_UPDATED, PAYMENT_RECORDED,
PAYMENT_CANCELLED, TRANSACTION_CANCELLED. Acteur dérivé de `auth.uid()`, jamais choisi par
le payload. Les corrections enregistrent notamment ancien/nouveau total et ancienne répartition ;
les annulations leur motif. L’UI affiche les 100 dernières actions ; les lignes restent conservées.

## Interface et Accueil

APP : Accueil / Agenda / Tâches / Comptes / Membres. Comptes dépend de `finance.access`.
Mes comptes, Historique et Trésorerie selon permission ; soldes séparés, détail par contrepartie,
actions rapides, recherche et filtres Restant à régler / Toutes / À payer / À recevoir /
Soldées / Chiro / Privées / Annulées. Une dépense sans obligation envers autrui est déjà soldée.
Une dette soldée reste consultable dans l’historique.

Fiche simple avec parts, obligations originales, remboursé, restant, paiements, déclarants et
audit. Formulaires sans tableau comptable lourd, contrôles de 44 px, labels, focus visible,
montants explicites et états textuels. La date financière reste une date civile 2000–2100.

L’Accueil affiche trois événements à venir/en cours sur 30 jours, jusqu’à cinq tâches actives
et les deux totaux personnels de Comptes. La trésorerie globale n’est pas présentée comme
le solde personnel d’un trésorier. Les trois résumés disposent d’un accès à leur module.

## Migration et tests

Migration additive **`20260923000300_app_finance.sql`**, après Tasks, avec bootstrap `schema.sql`
synchronisé. Aucune migration distante ni modification de données SITE exécutée.
Sur une installation existante, appliquer seulement les migrations manquantes dans l’ordre,
après inspection de l’historique et recette autorisée. Ne pas rejouer le bootstrap ou le seed.

`npm test` couvre notamment montants exacts et bornes, répartitions, sens des créances,
Chiro, paiements partiels/complets, annulations, permissions et bootstrap. Les tests SQL
PGlite exécutent réellement les RLS, les RPC, les refus de surpaiement et deux soumissions
simultanées avec la même révision. Des triggers de test provoquent des échecs après les parts
ou après un paiement pour vérifier le rollback intégral. PGlite sérialise l’exécution embarquée :
un stress test PostgreSQL multi-connexions et une recette GoTrue/PostgREST restent à faire en staging.

`npm run test:finance:browser` utilise Edge/Chromium installé (`FINANCE_BROWSER_PATH` facultatif),
les vrais composants, une API loopback de test et les mêmes RPC SQL. Desktop/mobile 390 px :
création de dette, partage égal/personnalisé, remboursements, correction de paiement, conflit,
annulation, soldes, historique, confidentialité admin et droits de trésorerie. Captures dans
`.test-artifacts/`, ignorées Git. Aucune identité réelle ni connexion Supabase distante.

Commandes complémentaires : `npm run check`, `npm run build`, `npm run test:smoke`, tests
navigateur Agenda/Tasks, `git diff --check`. Aucune nouvelle dépendance ; BigInt est natif.

Résultats exécutés le 23 septembre 2026 : **45 tests réussis** ; `check` sur 123 fichiers
sans erreur, avertissement ou hint ; build standard et build avec Auth activé par configuration
locale factice réussis ; 14 contrôles HTTP smoke réussis ; navigateurs Comptes, Agenda et Tasks
réussis ; `git diff --check` sans erreur. Après passage de l’environnement en bac à sable,
le build complet et le smoke ont nécessité une relance autorisée hors bac à sable. Aucune
configuration factice n’a été écrite dans les fichiers d’environnement, aucune migration distante
ni aucun déploiement n’ont été effectués.

## Limites et prochaine étape

Le snapshot lit toutes les opérations autorisées pour préserver la cohérence ; il n’est pas
paginé. Avant une forte volumétrie, prévoir une API serveur paginée avec agrégats exacts et
snapshot cohérent, sans stocker de solde mutable comme vérité. Pas de mise à jour temps réel.
Pour l’Accueil, les agrégats seuls pourront ensuite limiter le volume transféré.

Prochaine étape : recette multi-comptes sur un staging Supabase autorisé, puis vérification
des verrous avec plusieurs connexions PostgreSQL réelles. Rien n’est déployé dans cette phase.

## Préparation Notifications

Agenda et Tasks possèdent déjà leurs tables de rappels et des révisions. Un futur moteur pourra
calculer les instants depuis les dates Europe/Brussels, revalider annulations/échéances/droits,
puis dédupliquer par objet, occurrence, destinataire et version avant un envoi. Les opérations
Comptes ne déclenchent aucune notification ici. Pas de worker, queue, cron, Push ou PWA ajouté.
