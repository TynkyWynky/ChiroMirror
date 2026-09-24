# Hydratation AdminApp : import dynamique invalide

Incident observé sur le déploiement `6ab451ba1488fb00085b70ba`.
Le module d'entrée `AdminApp.lcrTngkg.js` est valide, mais réexporte
`AdminApp.D8ozOfTL.js`, dont la ligne 2176 contient :

```js
import('./AgendaPage.ClfFn5W7.js'?dpl=6ab451ba1488fb00085b70ba)
```

Le téléchargement du fichier réellement servi puis `node --check` reproduisent
l'erreur de syntaxe. L'hydratation échoue avant que l'interface de connexion puisse
être initialisée. Cela est distinct de l'incident SSR documenté dans
[netlify-404.md](netlify-404.md).

## Cause

Astro **6.1.6**, dans `plugin-chunk-imports.js`, ajoute les paramètres de déploiement
Netlify aux imports relatifs. Le lexer inclut le guillemet fermant dans la plage
d'un import dynamique, mais pas dans celle d'un import statique. Astro insère
le paramètre à `imp.e` dans les deux cas, donc après le guillemet d'un import
dynamique. Le `DEPLOY_ID` réel commençant par un chiffre explique le message
Firefox « identifier starts immediately after numeric literal ».

Un build local sans `DEPLOY_ID` n'exécute pas cette transformation. Vérifier
uniquement le SSR ne détecte pas non plus une erreur syntaxique des modules client.

## Correction et garde-fous

- `scripts/patch-astro-chunk-imports.mjs` corrige uniquement le point d'insertion :
  `imp.e - 1` pour les imports dynamiques, `imp.e` pour les imports statiques.
  Le paramètre reste ainsi dans la chaîne :
  `import('./AgendaPage….js?dpl=6ab…')`.
- Le correctif est appliqué par `postinstall`, avant chaque build et avant les tests.
  Il est idempotent, vérifie la version **6.1.6** et le texte d'origine exact.
  Il échoue explicitement si Astro change : lors d'une mise à jour, vérifier le
  correctif upstream, supprimer ce patch si le défaut est corrigé, puis rejouer
  le test de régression et un build avec `DEPLOY_ID`.
- `tests/chunk-imports.test.ts` teste le vrai plugin Astro : imports statiques,
  réexports, imports dynamiques entre apostrophes et guillemets, identifiants de
  déploiement numériques et textuels. Il vérifie aussi les URLs absolues, les
  paramètres préexistants et les imports calculés. Ce test échoue avant le patch.
- `scripts/check-client-syntax.mjs` vérifie **tous** les fichiers JavaScript générés
  dans `dist/_astro` avec `node --check`. Ce contrôle fait partie de
  `npm run test:netlify`, donc de `npm run build`, en plus du smoke SSR existant.

La protection de cohérence des déploiements `?dpl=…`, les imports différés,
la minification configurée, le correctif SSR et les versions des dépendances
sont conservés. Aucun changement Netlify distant, aucune donnée modifiée.

## Recette

Exécuter `npm run check`, `npm test`, puis `npm run build` avec un `DEPLOY_ID`
hexadécimal et une configuration Supabase locale fictive pour inclure toute l'APP
dans le bundle. Vérifier ensuite dans un navigateur local l'hydratation de
l'`astro-island`, les champs de connexion et le chargement des modules APP différés.
Ne pas utiliser de credentials de production pour cette recette.

Après le push et le redéploiement par le propriétaire, contrôler
`/leiding-login/` dans une nouvelle fenêtre : formulaire visible et aucune erreur
de syntaxe/hydratation dans la console. Aucun déploiement n'est effectué par ces tests.
