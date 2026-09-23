# Incident Netlify : accueil 404 malgré un build réussi

Diagnostic du 24 septembre 2026. Déploiement observé :
`6ab443018603bca0590e4808`, commit `12b4f48851e8e7005cf228443b62e13947224787`.
Aucun déploiement ni changement de données effectué pendant cette investigation.

## Cause et reproduction

Le domaine public et le permalink Netlify renvoient le même HTML administratif
« Pagina niet gevonden » sur `/`. Il ne s'agit pas du document 404 générique Netlify.
Les six pages en échec (`/`, activités, contact, location, assurance, confidentialité)
utilisent toutes `RichText`. Les quatre autres pages publiques répondent 200.

`RichText` importe `sanitize-html@2.17.7`, un module CommonJS qui fait
`require('htmlparser2')`. Sa dépendance `htmlparser2@12` est uniquement ESM.
Node local accepte ce chargement, mais AWS Lambda désactive cette fonctionnalité
avec `--no-experimental-require-module`. L'import échoue donc avec `ERR_REQUIRE_ESM`
à l'exécution, après un build réussi.

Astro tente ensuite de rendre `/500`. Sans page dédiée, `[adminSlug]` capture ce
chemin et remplace l'erreur serveur par sa réponse 404. Ce second problème masque
la véritable erreur de rendu derrière un symptôme de routage.

Avant correction, le véritable artefact `.netlify/v1/functions/ssr/ssr.mjs`, lancé
avec Node **22.13.0** et le réglage Lambda, reproduit `ERR_REQUIRE_ESM` puis
`404 !== 200` sur `/`. Sans ce réglage, le même artefact répond 200.
Les logs privés de production n'ont pas été consultés : le diagnostic repose sur
les réponses publiques, les dépendances installées et cette reproduction locale.
Une copie isolée du commit déployé, avant les changements PWA, reproduit également
les **six mêmes 404 et quatre mêmes 200** sous ce réglage, avec six erreurs
`ERR_REQUIRE_ESM`.

Sources : [réglages Node de Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html),
[changement ESM du sanitizer](https://github.com/apostrophecms/apostrophe/issues/5525),
[correctifs de sécurité du sanitizer](https://github.com/apostrophecms/apostrophe/blob/main/packages/sanitize-html/CHANGELOG.md).

## Correction

- `astro.config.mjs` : `vite.ssr.noExternal` fait compiler `sanitize-html`,
  `htmlparser2` et les dépendances concernées dans le bundle SSR. La frontière
  CommonJS/ESM est résolue au build. `is-plain-object` est inclus pour conserver
  son interopérabilité et les dépendances DOM pour garder leurs versions imbriquées.
  Aucun downgrade du sanitizer ni suppression du nettoyage HTML.
- `src/pages/500.astro` : réponse 500 générique, sans CMS, sans Markdown, sans détail
  technique exposé, non mise en cache. Une erreur serveur ne devient plus un 404 admin.
- `scripts/smoke-netlify-build.mjs` : exécute la fonction **empaquetée** sous le
  réglage Lambda. `npm run build` appelle automatiquement ce test après Astro.
  Une régression de l'accueil bloque donc le build avant publication.

`output: "server"`, `adapter: netlify()`, `publish = "dist"` et la fonction SSR
générée avec `path: '/*', preferStatic: true` sont conservés. L'absence de
`dist/index.html` est normale : le contenu public Supabase reste rendu à la demande.
La seule redirection existante reste celle du domaine sans www vers www.
Aucun fallback SPA `/* /index.html 200` n'est ajouté.

L'administration, SITE/APP, Auth, Agenda, Tasks, Finance, Notifications, routes API,
la fonction planifiée `notifications-tick` et le document statique de détection
Netlify Forms restent en place. Pas de changement Supabase ou de dépendance npm.

## Vérification

```sh
npm run check
npm run build
npm run test:netlify
npm test
```

Le smoke vérifie les dix pages publiques et leurs titres, Admin/Auth et les sept
liens APP, les routes API sans authentification, le formulaire statique et la
configuration SSR. Les appels externes sont simulés : aucune écriture, invitation,
notification Push ni connexion à Supabase de production. Avec une configuration
Supabase présente au build, du contenu CMS simulé vérifie aussi le nettoyage XSS
dans le bundle et une vraie exception de rendu retournant 500.

Ce contrôle teste le code généré localement, pas le CDN ni un déploiement réel.
Résultats après correction : `npm run check` passe sur 158 fichiers sans erreur,
avertissement ou hint ; `npm run build` passe avec son smoke Lambda ; les 60 tests
de `npm test` passent. Le build a aussi été exécuté avec Node 22.13.0,
`NETLIFY=true`, un `DEPLOY_ID` local et une configuration Supabase fictive :
les dix pages publiques, le nettoyage HTML et le cas 500 passent. La fonction
`notifications-tick` compile séparément sans être invoquée. `git diff --check` passe.

Après le push et le redéploiement par le propriétaire, vérifier `/`,
`/contact.html` et `/activiteiten.html` en HTTP 200, puis l'accès admin et les logs
de la fonction SSR. Le site en production n'est pas modifié par cette correction locale.
