# Fondation SITE / APP

> Rapport historique de Phase 0. La Phase 1 remplace l'accès provisoire `app.home.view`
> par un RBAC explicite et ajoute les membres : voir [Membres et accès APP](app-members.md).

## Périmètre et comportements conservés

Astro, Preact, Supabase et Netlify sont conservés. Les routes publiques et le chemin configurable de l'admin restent identiques. Connexion, récupération, session mémorisée, contenu, posts, inbox, finance historique et gestion d'équipe restent en place.

La navigation conserve les 13 sections existantes dans SITE. APP contient uniquement un écran d'accueil. Aucun agenda, tâche, dette individuelle, notification, PWA ou système documentaire n'est implémenté.

## Frontières

- `components/admin/AdminShell.tsx` : sidebar, topbar, messages de statut et zone principale.
- `components/admin/navigation.ts` : assemblage typé des domaines et filtrage par permissions.
- `features/site/navigation.ts` : inventaire de navigation SITE ; `InboxPanel.tsx` : affichage de la boîte de réception, avec actions injectées.
- `features/app/` : accueil vide et déclaration de navigation APP.
- `lib/auth/access.ts` : identité/profil, rôle SITE et règles d'accès pures.
- `lib/auth/invite.ts` : validation d'une entrée inconnue avant une opération privilégiée.
- `server/supabase.ts` : client service role, importable seulement par des routes/services serveur. Ne jamais l'importer dans un composant client.
- `server/booklet.ts` : validation et téléchargement du PDF ; la route Astro ne fait que charger sa configuration.

`AdminApp.tsx` reste l'orchestrateur existant ; le métier SITE/finance n'a pas été déplacé artificiellement. Ses autres extractions seront progressives. Pas de routeur React ni de framework supplémentaire. Les onglets restent en mémoire et ne sont pas encore des URLs partageables.

## Identité et accès

`auth.users` identifie le compte. `profiles.role` décrit ses droits SITE : `none`, `editor`, `admin`.
Le défaut et le trigger deviennent `none` après application de la migration. Les invitations demandent explicitement le rôle SITE et choisissent `none` par défaut. Les anciennes personnes ne sont pas rétrogradées.

`app.home.view` permet seulement l'écran d'accueil aux profils authentifiés. Ce droit ne prouve pas une adhésion Chiro et ne donne aucune permission métier future. Ni le statut de membre, ni les responsables, ni la trésorerie APP ne sont dérivés du rôle SITE.

Les nouvelles fonctionnalités APP devront introduire leurs propres règles et contrôles serveur/RLS. Le filtrage de la navigation n'est pas une frontière de sécurité. La RLS SITE existante reste en vigueur ; la finance historique exige maintenant aussi un rôle SITE autorisé. Un ancien tableau de groupes affectés ne suffit pas pour un rôle `none`.

Les comptes neutres chargent uniquement leur profil ; ils ne lancent pas le chargement des messages, finances ou éditeurs SITE. Un renouvellement du JWT pour la même identité ne déclenche plus un rechargement complet qui écraserait les champs non enregistrés. La DB contrôle toujours les droits de chaque requête ; le bouton de rafraîchissement recharge les droits du profil.

## Sécurité

### Markdown

Le rendu général utilise `sanitize-html` après Marked, côté serveur et à chaque rendu, y compris pour les contenus déjà enregistrés. Les formats éditoriaux usuels et le HTML inoffensif sont conservés ; scripts, attributs d'événements, styles, iframes et protocoles exécutables sont exclus. Les tâches GFM restent des cases désactivées.

Le renderer des posts garde son chemin sécurisé existant et ses tests. Aucun contenu DB n'est réécrit. Vérifier les éventuels HTML/styles/embeds personnalisés de production : les éléments actifs ou hors liste ne seront plus rendus.

### Livret

Le propriétaire a confirmé Supabase Storage. Le proxy accepte uniquement HTTPS, l'origine exacte `PUBLIC_SUPABASE_URL` sur un domaine de projet hébergé `*.supabase.co`, et les objets publics du bucket `site-media`. Il refuse les identifiants URL, ports alternatifs, chemins sortant du bucket et redirections. Délai de 10 secondes ; statut 200 et MIME PDF exigés. Nom de téléchargement normalisé et réponse `no-store`/`nosniff`.

Les domaines Supabase personnalisés, instances locales/self-hosted et URLs externes ne sont volontairement pas ajoutés à la liste autorisée sans conception dédiée. Les URLs signées ne sont pas requises pour le livret public. Un PDF historique mal étiqueté côté Storage devra être remis avec `application/pdf`.

### Justificatifs financiers : problème encore ouvert

`site-media` reste public, et les justificatifs existants le restent. Une note est affichée au champ d'upload. Aucun objet ni URL n'a été déplacé, supprimé ou rendu privé : cela casserait des liens existants.

Correction ultérieure ciblée (sans créer de gestion documentaire) : bucket privé réservé aux justificatifs, policies liées aux transactions/groupes, accès authentifié ou URLs signées courtes, copie contrôlée des objets existants, vérification des références puis retrait des anciennes copies publiques. Une URL difficile à deviner ne suffit pas. Avant cette transition, identifier les reçus réellement sensibles et éviter de nouvelles données confidentielles.

### Points non traités par cette phase

Versions Astro/Netlify et patch Preact, rate limiting, CSP, validation des autres API, invariant SQL du dernier admin, audit financier, précision et concurrence de la comptabilité historique restent à traiter séparément. L'ajout du rôle neutre ne révoque pas les droits d'éditeurs précédemment créés ; leur légitimité doit être revue par le propriétaire.

## Contrats à respecter lors des phases suivantes

- Agenda : Europe/Brussels, distinguer date civile, journée entière et instant ; récurrence et exceptions d'occurrence/série à modéliser avant implémentation.
- Tâches : association plusieurs-à-plusieurs tâche/membre, rôles `LEAD` et `CONTRIBUTOR`, plusieurs leads permis ; pas de simple `assigned_to` unique.
- Finances APP : moteur distinct de `finance_transactions` ; montants exacts (unités mineures entières ou décimaux exacts), remboursements partiels, historique et opérations atomiques. Pas de calcul métier en flottants JS.
- Pas de système de gestion documentaire.

## Vérification

`npm test` couvre permissions/navigation, validation des invitations, Markdown général, contenu public par défaut, téléchargement du livret et posts existants. Les appels réseau du livret sont remplacés par des réponses contrôlées ; ils ne contactent pas la production.

`npm run check` vérifie TypeScript/Astro ; `npm run build` vérifie le packaging Netlify. Ces commandes appliquent toujours le patch Preact existant dans node_modules.

`npm run test:smoke` lance temporairement Astro sur une interface locale avec Supabase désactivé, vérifie les dix pages publiques, les deux routes Auth/admin et deux réponses 404 attendues, puis arrête le serveur. Ce test HTTP ne simule pas une session utilisateur ni des interactions dans un navigateur.

Avant déploiement, suivre `supabase/README.md`, puis vérifier en environnement isolé : login/reset/invitation, admin/éditeur/neutre, chaque section SITE, navigation mobile, ouverture du livret et réception de contact. Les tests unitaires ne remplacent pas une vérification RLS sur une base réelle.
